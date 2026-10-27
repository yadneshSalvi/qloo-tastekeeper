import { z } from 'zod';
import type { ClientId } from '../domain/catalog.ts';
import { authorizeDecision } from '../domain/authorization.ts';
import { decrypt, digest, encrypt, randomToken } from './crypto.ts';
import { transaction } from './db.ts';
import { denied } from './errors.ts';
import {
  claimInvitation,
  issueCredential,
  loadBundle,
  one,
  principalFromToken,
  type Principal,
} from './store.ts';

type SessionRow = {
  token_hash: string;
  tenant_id: string;
  client_id: ClientId;
  delegate_id: string;
  grant_id: string;
  grant_version: number;
  client_epoch: number;
  encrypted_credential: string;
  credential_hash: string;
  expires_at: Date;
  latest_run_id: string | null;
  last_brief: unknown;
};
export async function claimBrowserSession(clientId: ClientId, invitation: string) {
  const claimed = await claimInvitation(clientId, invitation);
  const principal = await principalFromToken(clientId, claimed.credential);
  const sessionToken = randomToken();
  await transaction(principal.tenantId, async (db) => {
    const bundle = await loadBundle(db, principal, principal.grantId);
    await db.query(
      `INSERT INTO client_sessions(token_hash,tenant_id,client_id,delegate_id,grant_id,grant_version,client_epoch,encrypted_credential,credential_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        digest(sessionToken),
        principal.tenantId,
        clientId,
        principal.delegateId,
        principal.grantId,
        bundle.grant.version,
        bundle.client.epoch,
        encrypt(claimed.credential),
        principal.tokenHash,
        bundle.grant.expires_at,
      ],
    );
  });
  // The credential remains encrypted at the gateway. The client backend receives only its opaque handle.
  const { credential: _credential, ...view } = claimed;
  void _credential;
  return { ...view, sessionToken };
}

/** Durable opaque browser handle + authenticated client are both required. */
export async function principalFromBrowserSession(
  clientId: ClientId,
  token: string,
): Promise<Principal> {
  if (
    !z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .safeParse(token).success
  )
    throw denied('TOKEN_EXPIRED', 401);
  const hash = digest(token);
  const lookup = await transaction(
    null,
    (db) =>
      one<Pick<SessionRow, 'tenant_id' | 'client_id'>>(
        db,
        'SELECT tenant_id,client_id FROM client_sessions WHERE token_hash=$1',
        [hash],
      ),
    hash,
  );
  if (lookup.client_id !== clientId) throw denied('PRINCIPAL_DENIED');
  return transaction(lookup.tenant_id, async (db) => {
    // Load authority before locking the session, preserving client → context → grant order.
    const hint = await one<SessionRow>(
      db,
      'SELECT * FROM client_sessions WHERE tenant_id=$1 AND token_hash=$2',
      [lookup.tenant_id, hash],
    );
    const principal: Principal = {
      tenantId: hint.tenant_id,
      clientId,
      delegateId: hint.delegate_id,
      grantId: hint.grant_id,
      tokenHash: hint.credential_hash,
      browserSessionHash: hash,
    };
    const bundle = await loadBundle(db, principal, hint.grant_id);
    const session = await one<SessionRow>(
      db,
      'SELECT * FROM client_sessions WHERE tenant_id=$1 AND token_hash=$2 FOR UPDATE',
      [lookup.tenant_id, hash],
    );
    if (session.expires_at.getTime() <= Date.now()) throw denied('TOKEN_EXPIRED', 401);
    if (!bundle.client.active) throw denied('CLIENT_DISABLED');
    if (bundle.grant.status === 'revoked') throw denied('GRANT_REVOKED');
    if (
      bundle.grant.version !== session.grant_version ||
      bundle.client.epoch !== session.client_epoch
    )
      throw denied('REVISION_CHANGED');
    // Session authority can renew a five-minute credential; it can never broaden its grant.
    const check = authorizeDecision(
      {
        ...bundle.records,
        token: { ...bundle.records.token, expiresAt: session.expires_at.getTime() },
        grant: {
          ...bundle.records.grant,
          remainingRequests: Math.max(1, bundle.records.grant.remainingRequests),
        },
      },
      {
        grantId: bundle.grant.id,
        contextId: bundle.context.id,
        purpose: bundle.scope.purposes[0],
        operation: 'rank',
        targetType: bundle.snapshot.target_type,
        snapshotId: bundle.snapshot.id,
        candidateIds: bundle.snapshot.payload.map((i) => i.id),
        fields: bundle.scope.fields,
      },
      Date.now(),
    );
    if (!check.allowed) throw denied(check.code, check.code === 'TOKEN_EXPIRED' ? 401 : 403);
    if (bundle.credential.expires_at.getTime() - Date.now() < 60_000) {
      const next = await issueCredential(db, principal.tenantId, bundle.client, bundle.grant);
      principal.tokenHash = digest(next.credential);
      await db.query(
        'UPDATE client_sessions SET encrypted_credential=$3,credential_hash=$4 WHERE tenant_id=$1 AND token_hash=$2',
        [principal.tenantId, hash, encrypt(next.credential), principal.tokenHash],
      );
    } else {
      // Authenticate the stored ciphertext as well as its indexed hash, detecting corruption safely.
      if (digest(decrypt<string>(session.encrypted_credential)) !== session.credential_hash)
        throw denied('PRINCIPAL_DENIED');
      principal.tokenHash = session.credential_hash;
    }
    return principal;
  });
}

export async function browserSessionMetadata(principal: Principal) {
  if (!principal.browserSessionHash) return {};
  return transaction(principal.tenantId, async (db) => {
    const row = await one<SessionRow>(
      db,
      'SELECT * FROM client_sessions WHERE tenant_id=$1 AND token_hash=$2 AND client_id=$3',
      [principal.tenantId, principal.browserSessionHash, principal.clientId],
    );
    return {
      ...(row.latest_run_id ? { latestRunId: row.latest_run_id } : {}),
      ...(row.last_brief ? { brief: row.last_brief } : {}),
    };
  });
}
export async function disconnectBrowserSession(principal: Principal) {
  if (!principal.browserSessionHash) throw denied('PRINCIPAL_DENIED');
  await transaction(principal.tenantId, (db) =>
    db.query('DELETE FROM client_sessions WHERE tenant_id=$1 AND token_hash=$2', [
      principal.tenantId,
      principal.browserSessionHash,
    ]),
  );
  return { disconnected: true };
}
