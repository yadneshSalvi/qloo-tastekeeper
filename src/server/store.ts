import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import { transaction, type Db } from './db.ts';
import { bodyDigest, decrypt, digest, encrypt, randomToken } from './crypto.ts';
import {
  CLIENTS,
  REFERENCE_CHOICES,
  availabilityNotice,
  initialSignals,
  publicCatalogItem,
  type CatalogItem,
  type ClientId,
  type Signal,
} from '../domain/catalog.ts';
import { PUBLIC_FIELDS, type InvitationInput, type CorrectionInput } from '../domain/contracts.ts';
import { DomainError, denied } from './errors.ts';
import type { AuthorizationRecords, PublicField } from '../domain/authorization.ts';
import {
  executionCapabilities,
  mappedCatalog,
  mapSignals,
  readMappings,
  reviewedReferences,
} from './mappings.ts';

export type Owner = { tenantId: string; ownerId: string };
export type Principal = {
  tenantId: string;
  clientId: ClientId;
  delegateId: string;
  tokenHash: string;
  grantId: string;
  browserSessionHash?: string;
};
export type ContextRow = {
  tenant_id: string;
  id: string;
  owner_id: string;
  name: string;
  purpose: 'gift' | 'personal';
  revision: number;
  deleted: boolean;
};
export type GrantRow = {
  tenant_id: string;
  id: string;
  owner_id: string;
  delegate_id: string;
  delegate_name: string;
  client_id: ClientId;
  context_id: string;
  version: number;
  status: string;
  expires_at: Date;
  request_limit: number;
  reserved_count: number;
  created_at: Date;
};
export type Scope = Pick<
  AuthorizationRecords['grant'],
  | 'signalIds'
  | 'catalogIds'
  | 'snapshotMode'
  | 'snapshotIds'
  | 'operations'
  | 'purposes'
  | 'types'
  | 'fields'
>;
export type ClientRow = { tenant_id: string; id: ClientId; active: boolean; epoch: number };
export type CredentialRow = {
  tenant_id: string;
  client_id: ClientId;
  delegate_id: string;
  grant_id: string;
  grant_version: number;
  client_epoch: number;
  expires_at: Date;
  token_hash: string;
};
export type SnapshotRow = {
  tenant_id: string;
  id: string;
  client_id: ClientId;
  catalog_id: string;
  target_type: 'book' | 'movie' | 'place';
  payload: CatalogItem[];
  checksum: string;
  retrieved_at: Date;
};
export async function one<T extends QueryResultRow>(
  db: Db,
  sql: string,
  args: unknown[] = [],
): Promise<T> {
  const rows = await db.query<T>(sql, args);
  if (!rows.rows[0]) throw denied('PRINCIPAL_DENIED', 404);
  return rows.rows[0];
}
export async function audit(
  db: Db,
  tenantId: string,
  action: string,
  subject: string,
  detail: Record<string, unknown> = {},
) {
  await db.query(
    'INSERT INTO audit_events(tenant_id,id,action,subject_id,detail) VALUES($1,$2,$3,$4,$5)',
    [tenantId, randomUUID(), action, subject, detail],
  );
}
export async function assertTenant(db: Db, tenantId: string) {
  const row = await one<{ expires_at: Date }>(
    db,
    'SELECT expires_at FROM tenants WHERE tenant_id=$1',
    [tenantId],
  );
  if (row.expires_at.getTime() <= Date.now())
    throw new DomainError(
      'DEMO_EXPIRED',
      'This isolated sample workspace has expired. Start a new one.',
      410,
    );
}
export async function createDemo(): Promise<Owner & { token: string }> {
  if (process.env.DEMO_ENABLED !== 'true')
    throw new DomainError(
      'DEMO_DISABLED',
      'The sample workspace is not enabled on this server.',
      503,
    );
  const tenantId = randomUUID(),
    ownerId = randomUUID(),
    token = randomToken();
  const mappings = readMappings();
  await transaction(tenantId, async (db) => {
    await db.query(
      "INSERT INTO tenants(tenant_id,expires_at) VALUES($1,now()+interval '24 hours')",
      [tenantId],
    );
    await db.query(
      "INSERT INTO users(tenant_id,id,role,display_name) VALUES($1,$2,'owner','Mira')",
      [tenantId, ownerId],
    );
    await db.query(
      "INSERT INTO owner_sessions(token_hash,tenant_id,owner_id,expires_at) VALUES($1,$2,$3,now()+interval '24 hours')",
      [digest(token), tenantId, ownerId],
    );
    for (const clientId of Object.keys(CLIENTS) as ClientId[]) {
      const snapshotId = randomUUID();
      const info = CLIENTS[clientId];
      const catalog = mappedCatalog(clientId, mappings);
      await db.query('INSERT INTO clients(tenant_id,id) VALUES($1,$2)', [tenantId, clientId]);
      await db.query(
        'INSERT INTO catalog_snapshots(tenant_id,id,client_id,catalog_id,target_type,payload,checksum) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          tenantId,
          snapshotId,
          clientId,
          info.catalogId,
          info.type,
          JSON.stringify(catalog),
          bodyDigest(catalog),
        ],
      );
      await db.query(
        'INSERT INTO catalog_heads(tenant_id,client_id,catalog_id,snapshot_id) VALUES($1,$2,$3,$4)',
        [tenantId, clientId, info.catalogId, snapshotId],
      );
    }
    for (const purpose of ['personal', 'gift'] as const) {
      const id = randomUUID();
      await db.query(
        'INSERT INTO contexts(tenant_id,id,owner_id,name,purpose) VALUES($1,$2,$3,$4,$5)',
        [
          tenantId,
          id,
          ownerId,
          purpose === 'gift' ? 'Little things, well chosen' : 'My everyday favourites',
          purpose,
        ],
      );
      await db.query(
        'INSERT INTO context_revisions(tenant_id,context_id,revision,encrypted_signals,reason,author_id) VALUES($1,$2,1,$3,$4,$5)',
        [
          tenantId,
          id,
          encrypt(mapSignals(initialSignals(purpose), mappings)),
          'Authored example preferences. Cultural identities are reviewed separately from personal preference claims.',
          ownerId,
        ],
      );
    }
    await audit(db, tenantId, 'workspace.created', ownerId, { mode: 'isolated_demo' });
  });
  return { tenantId, ownerId, token };
}
export async function ownerFromToken(token?: string): Promise<Owner> {
  if (!token || token.length > 100)
    throw new DomainError(
      'SESSION_REQUIRED',
      'Start an isolated sample workspace to continue.',
      401,
    );
  const hash = digest(token);
  const session = await transaction(
    null,
    (db) =>
      one<{ tenant_id: string; owner_id: string; expires_at: Date }>(
        db,
        'SELECT tenant_id,owner_id,expires_at FROM owner_sessions WHERE token_hash=$1',
        [hash],
      ),
    hash,
  );
  if (session.expires_at.getTime() <= Date.now())
    throw new DomainError('SESSION_EXPIRED', 'Your sample workspace has expired.', 401);
  return { tenantId: session.tenant_id, ownerId: session.owner_id };
}
export async function principalFromToken(clientId: ClientId, token?: string): Promise<Principal> {
  if (!token || token.length > 100) throw denied('TOKEN_EXPIRED', 401);
  const hash = digest(token);
  const row = await transaction(
    null,
    (db) => one<CredentialRow>(db, 'SELECT * FROM credentials WHERE token_hash=$1', [hash]),
    hash,
  );
  if (row.client_id !== clientId) throw denied('PRINCIPAL_DENIED');
  if (row.expires_at.getTime() <= Date.now()) throw denied('TOKEN_EXPIRED', 401);
  return {
    tenantId: row.tenant_id,
    clientId,
    delegateId: row.delegate_id,
    tokenHash: hash,
    grantId: row.grant_id,
  };
}
export async function readSignals(db: Db, context: ContextRow): Promise<Signal[]> {
  const row = await one<{ encrypted_signals: string }>(
    db,
    'SELECT encrypted_signals FROM context_revisions WHERE tenant_id=$1 AND context_id=$2 AND revision=$3',
    [context.tenant_id, context.id, context.revision],
  );
  return decrypt<Signal[]>(row.encrypted_signals);
}
export async function loadBundle(db: Db, principal: Principal, grantId: string) {
  await assertTenant(db, principal.tenantId);
  const t = principal.tenantId;
  const hint = await one<Pick<GrantRow, 'context_id' | 'client_id'>>(
    db,
    'SELECT context_id,client_id FROM grants WHERE tenant_id=$1 AND id=$2',
    [t, grantId],
  );
  if (hint.client_id !== principal.clientId || grantId !== principal.grantId)
    throw denied('PRINCIPAL_DENIED');
  // Global lock order. Revocation/correction/disable use the same ordering.
  const client = await one<ClientRow>(
    db,
    'SELECT * FROM clients WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
    [t, principal.clientId],
  );
  const context = await one<ContextRow>(
    db,
    'SELECT * FROM contexts WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
    [t, hint.context_id],
  );
  const grant = await one<GrantRow>(
    db,
    'SELECT * FROM grants WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
    [t, grantId],
  );
  if (context.deleted) throw denied('CONTEXT_DELETED', 410);
  const credential = await one<CredentialRow>(
    db,
    'SELECT * FROM credentials WHERE tenant_id=$1 AND token_hash=$2',
    [t, principal.tokenHash],
  );
  const scope = (
    await one<{ scope: Scope }>(
      db,
      'SELECT scope FROM grant_revisions WHERE tenant_id=$1 AND grant_id=$2 AND version=$3',
      [t, grant.id, grant.version],
    )
  ).scope;
  const snapshotId =
    scope.snapshotMode === 'follow_current'
      ? (
          await one<{ snapshot_id: string }>(
            db,
            'SELECT snapshot_id FROM catalog_heads WHERE tenant_id=$1 AND client_id=$2 AND catalog_id=$3',
            [t, client.id, scope.catalogIds[0]],
          )
        ).snapshot_id
      : scope.snapshotIds[0];
  const snapshot = await one<SnapshotRow>(
    db,
    'SELECT * FROM catalog_snapshots WHERE tenant_id=$1 AND id=$2',
    [t, snapshotId],
  );
  const signals = await readSignals(db, context);
  const records: AuthorizationRecords = {
    principal: { tenantId: t, clientId: principal.clientId, delegateId: principal.delegateId },
    client: { id: client.id, tenantId: t, active: client.active, epoch: client.epoch },
    token: {
      tenantId: credential.tenant_id,
      clientId: credential.client_id,
      clientEpoch: credential.client_epoch,
      delegateId: credential.delegate_id,
      grantId: credential.grant_id,
      grantVersion: credential.grant_version,
      expiresAt: credential.expires_at.getTime(),
    },
    context: {
      id: context.id,
      tenantId: context.tenant_id,
      ownerId: context.owner_id,
      revision: context.revision,
      deleted: context.deleted,
      signals,
    },
    grant: {
      id: grant.id,
      tenantId: grant.tenant_id,
      ownerId: grant.owner_id,
      delegateId: grant.delegate_id,
      clientId: grant.client_id,
      contextId: grant.context_id,
      version: grant.version,
      active: grant.status === 'active',
      expiresAt: grant.expires_at.getTime(),
      remainingRequests: grant.request_limit - grant.reserved_count,
      ...scope,
    },
    snapshot: {
      id: snapshot.id,
      tenantId: snapshot.tenant_id,
      clientId: snapshot.client_id,
      catalogId: snapshot.catalog_id,
      type: snapshot.target_type,
      itemIds: snapshot.payload.map((item) => item.id),
    },
  };
  return { records, client, context, grant, credential, scope, snapshot, signals };
}
export type Bundle = Awaited<ReturnType<typeof loadBundle>>;
export function publicSession(bundle: Bundle) {
  const { grant, context, snapshot, scope } = bundle;
  return {
    grant: {
      id: grant.id,
      contextId: context.id,
      contextName: context.name,
      purpose: scope.purposes[0] as 'gift' | 'personal',
      expiresAt: grant.expires_at.toISOString(),
      remainingRequests: grant.request_limit - grant.reserved_count,
      snapshotId: snapshot.id,
      fields: scope.fields,
      version: grant.version,
    },
    catalog: {
      id: snapshot.catalog_id,
      snapshotId: snapshot.id,
      type: snapshot.target_type,
      source: 'Publisher and venue reference pages · curated demonstration inventory',
      retrievedAt: snapshot.retrieved_at.toISOString(),
      availabilityNotice,
      items: snapshot.payload.map(publicCatalogItem),
    },
    delegate: { displayName: grant.delegate_name },
    credentialExpiresAt: bundle.credential.expires_at.toISOString(),
    mode:
      executionCapabilities().defaultMode === 'qloo'
        ? ('qloo' as const)
        : ('authored_sample' as const),
    execution: executionCapabilities(),
  };
}
export async function issueCredential(
  db: Db,
  tenantId: string,
  client: ClientRow,
  grant: GrantRow,
) {
  const credential = randomToken();
  const expiresAt = new Date(Math.min(Date.now() + 5 * 60 * 1000, grant.expires_at.getTime()));
  await db.query(
    'INSERT INTO credentials(token_hash,tenant_id,client_id,delegate_id,grant_id,grant_version,client_epoch,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      digest(credential),
      tenantId,
      client.id,
      grant.delegate_id,
      grant.id,
      grant.version,
      client.epoch,
      expiresAt,
    ],
  );
  return { credential, credentialExpiresAt: expiresAt.toISOString() };
}
export async function createInvitation(owner: Owner, input: InvitationInput) {
  return transaction(owner.tenantId, async (db) => {
    await assertTenant(db, owner.tenantId);
    const t = owner.tenantId;
    const client = await one<ClientRow>(
      db,
      'SELECT * FROM clients WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
      [t, input.clientId],
    );
    if (!client.active) throw denied('CLIENT_DISABLED');
    const context = await one<ContextRow>(
      db,
      'SELECT * FROM contexts WHERE tenant_id=$1 AND id=$2 AND owner_id=$3 FOR UPDATE',
      [t, input.contextId, owner.ownerId],
    );
    if (
      context.deleted ||
      context.purpose !== input.purpose ||
      (input.purpose === 'gift' && input.clientId !== 'books')
    )
      throw denied('SCOPE_DENIED');
    if (input.purpose === 'gift' && input.snapshotMode !== 'pinned') throw denied('CATALOG_DENIED');
    const signals = await readSignals(db, context);
    if (!input.signalIds.every((id) => signals.some((s) => s.id === id && s.active)))
      throw denied('SIGNAL_SELECTION_REQUIRED');
    const snapshot = await one<{ snapshot_id: string }>(
      db,
      'SELECT snapshot_id FROM catalog_heads WHERE tenant_id=$1 AND client_id=$2 AND catalog_id=$3',
      [t, input.clientId, CLIENTS[input.clientId].catalogId],
    );
    const scope: Scope = {
      signalIds: input.signalIds,
      catalogIds: [CLIENTS[input.clientId].catalogId],
      snapshotMode: input.snapshotMode,
      snapshotIds: [snapshot.snapshot_id],
      operations: ['rank'],
      purposes: [input.purpose],
      types: [CLIENTS[input.clientId].type],
      fields: [...PUBLIC_FIELDS],
    };
    const id = randomUUID(),
      token = randomToken();
    const tenant = await one<{ expires_at: Date }>(
      db,
      'SELECT expires_at FROM tenants WHERE tenant_id=$1',
      [t],
    );
    const expiry = new Date(
      Math.min(Date.now() + input.expiresInHours * 3600000, tenant.expires_at.getTime()),
    );
    await db.query(
      "INSERT INTO grants(tenant_id,id,owner_id,delegate_name,client_id,context_id,status,expires_at,request_limit) VALUES($1,$2,$3,$4,$5,$6,'pending',$7,$8)",
      [
        t,
        id,
        owner.ownerId,
        input.delegateName,
        input.clientId,
        input.contextId,
        expiry,
        input.requestLimit,
      ],
    );
    await db.query(
      'INSERT INTO grant_revisions(tenant_id,grant_id,version,scope,reason) VALUES($1,$2,1,$3,$4)',
      [t, id, scope, 'Explicit consent reviewed by sample recipient.'],
    );
    await db.query(
      'INSERT INTO invitations(tenant_id,id,grant_id,token_hash,expires_at) VALUES($1,$2,$3,$4,$5)',
      [t, randomUUID(), id, digest(token), expiry],
    );
    await audit(db, t, 'invitation.created', id, {
      clientId: input.clientId,
      contextId: context.id,
      signalCount: scope.signalIds.length,
      snapshotMode: scope.snapshotMode,
    });
    const origin = clientOrigin(input.clientId);
    return {
      id,
      expiresAt: expiry.toISOString(),
      claimUrl: `${origin}/claim#token=${token}`,
      clientName: CLIENTS[input.clientId].name,
    };
  });
}
export async function claimInvitation(clientId: ClientId, token: string) {
  const hash = digest(token);
  const lookup = await transaction(
    null,
    (db) =>
      one<{ tenant_id: string; grant_id: string }>(
        db,
        'SELECT tenant_id,grant_id FROM invitations WHERE token_hash=$1',
        [hash],
      ),
    hash,
  );
  return transaction(lookup.tenant_id, async (db) => {
    const t = lookup.tenant_id;
    await assertTenant(db, t);
    const client = await one<ClientRow>(
      db,
      'SELECT * FROM clients WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
      [t, clientId],
    );
    const hint = await one<{ context_id: string }>(
      db,
      'SELECT context_id FROM grants WHERE tenant_id=$1 AND id=$2 AND client_id=$3',
      [t, lookup.grant_id, clientId],
    );
    const context = await one<ContextRow>(
      db,
      'SELECT * FROM contexts WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
      [t, hint.context_id],
    );
    const grant = await one<GrantRow>(
      db,
      'SELECT * FROM grants WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
      [t, lookup.grant_id],
    );
    const invitation = await one<{ claimed_at: Date | null; expires_at: Date }>(
      db,
      'SELECT claimed_at,expires_at FROM invitations WHERE tenant_id=$1 AND token_hash=$2 FOR UPDATE',
      [t, hash],
    );
    if (invitation.claimed_at) throw denied('INVITATION_CLAIMED', 409);
    if (!client.active) throw denied('CLIENT_DISABLED');
    if (grant.status === 'revoked') throw denied('GRANT_REVOKED');
    if (context.deleted) throw denied('PRINCIPAL_DENIED');
    if (invitation.expires_at.getTime() <= Date.now() || grant.expires_at.getTime() <= Date.now())
      throw denied('GRANT_EXPIRED', 410);
    const delegateId = randomUUID();
    await db.query(
      "INSERT INTO users(tenant_id,id,role,display_name) VALUES($1,$2,'delegate',$3)",
      [t, delegateId, grant.delegate_name],
    );
    await db.query(
      "UPDATE grants SET delegate_id=$3,status='active' WHERE tenant_id=$1 AND id=$2",
      [t, grant.id, delegateId],
    );
    await db.query(
      'UPDATE invitations SET claimed_at=now(),delegate_id=$3 WHERE tenant_id=$1 AND token_hash=$2',
      [t, hash, delegateId],
    );
    grant.delegate_id = delegateId;
    grant.status = 'active';
    const issued = await issueCredential(db, t, client, grant);
    const principal: Principal = {
      tenantId: t,
      clientId,
      delegateId,
      tokenHash: digest(issued.credential),
      grantId: grant.id,
    };
    const bundle = await loadBundle(db, principal, grant.id);
    await audit(db, t, 'invitation.claimed', grant.id, { clientId });
    return { ...publicSession(bundle), ...issued };
  });
}
export async function ownerWorkspace(owner: Owner) {
  return transaction(owner.tenantId, async (db) => {
    const t = owner.tenantId;
    await assertTenant(db, t);
    const contextRows = (
      await db.query<ContextRow>(
        'SELECT * FROM contexts WHERE tenant_id=$1 AND owner_id=$2 AND NOT deleted ORDER BY purpose DESC,created_at,id',
        [t, owner.ownerId],
      )
    ).rows;
    const contexts = await Promise.all(
      contextRows.map(async (context) => ({
        id: context.id,
        name: context.name,
        purpose: context.purpose,
        revision: context.revision,
        signals: await readSignals(db, context),
      })),
    );
    const grants = (
      await db.query<GrantRow & { context_name: string; scope: Scope }>(
        `SELECT g.*,c.name AS context_name,r.scope FROM grants g JOIN contexts c ON(c.tenant_id=g.tenant_id AND c.id=g.context_id) JOIN grant_revisions r ON(r.tenant_id=g.tenant_id AND r.grant_id=g.id AND r.version=g.version) WHERE g.tenant_id=$1 AND g.owner_id=$2 AND NOT c.deleted ORDER BY g.created_at DESC`,
        [t, owner.ownerId],
      )
    ).rows.map((g) => ({
      id: g.id,
      clientId: g.client_id,
      clientName: CLIENTS[g.client_id].name,
      contextId: g.context_id,
      contextName: g.context_name,
      delegateName: g.delegate_name,
      version: g.version,
      status: g.expires_at.getTime() <= Date.now() && g.status !== 'revoked' ? 'expired' : g.status,
      expiresAt: g.expires_at.toISOString(),
      remainingRequests: g.request_limit - g.reserved_count,
      scope: g.scope,
    }));
    const decisions = (
      await db.query<{
        id: string;
        state: string;
        client_id: ClientId;
        context_id: string;
        context_name: string;
        auth_snapshot: { revisions: { contextRevision: number } };
        result: {
          items: { id: string; title: string; creator: string }[];
          provenance: { label: string };
        } | null;
        revision: number;
        created_at: Date;
        error_code: string | null;
      }>(
        `SELECT r.id,r.state,r.client_id,r.context_id,c.name AS context_name,c.revision,r.auth_snapshot,r.result,r.created_at,r.error_code FROM decision_runs r JOIN contexts c ON(c.tenant_id=r.tenant_id AND c.id=r.context_id) WHERE r.tenant_id=$1 AND c.owner_id=$2 AND NOT c.deleted ORDER BY r.created_at DESC LIMIT 20`,
        [t, owner.ownerId],
      )
    ).rows.map((r) => ({
      id: r.id,
      state: r.state,
      clientId: r.client_id,
      contextId: r.context_id,
      contextName: r.context_name,
      contextRevision: r.auth_snapshot.revisions.contextRevision,
      stale: r.auth_snapshot.revisions.contextRevision !== r.revision,
      items: r.result?.items ?? [],
      provenance: r.result?.provenance,
      createdAt: r.created_at.toISOString(),
      errorCode: r.error_code,
    }));
    const selections = (
      await db.query<{ run_id: string; item_id: string; title: string; saved_at: Date }>(
        'SELECT run_id,item_id,title,saved_at FROM selections WHERE tenant_id=$1 ORDER BY saved_at DESC',
        [t],
      )
    ).rows.map((s) => ({
      runId: s.run_id,
      itemId: s.item_id,
      title: s.title,
      savedAt: s.saved_at.toISOString(),
    }));
    const events = (
      await db.query<{
        id: string;
        action: string;
        detail: Record<string, unknown>;
        created_at: Date;
      }>(
        'SELECT id,action,detail,created_at FROM audit_events WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 15',
        [t],
      )
    ).rows.map((e) => ({ ...e, createdAt: e.created_at.toISOString() }));
    const tenant = await one<{ expires_at: Date }>(
      db,
      'SELECT expires_at FROM tenants WHERE tenant_id=$1',
      [t],
    );
    const execution = executionCapabilities();
    return {
      owner: {
        name: 'Mira',
        mode: 'isolated_demo',
        expiresAt: tenant.expires_at.toISOString(),
        retentionNotice:
          'This guest workspace expires after 24 hours. Expired workspaces are erased by scheduled maintenance. You can erase it now; results already shared and provider-side records cannot be recalled.',
      },
      contexts,
      grants,
      decisions,
      selections,
      events,
      execution,
      references: reviewedReferences(),
      clientOrigins: Object.fromEntries(
        (Object.keys(CLIENTS) as ClientId[]).map((id) => [id, clientOrigin(id)]),
      ) as Record<ClientId, string>,
      qloo: {
        available: execution.qlooAvailable,
        reason: execution.qlooAvailable
          ? 'Reviewed identities and a separately configured live worker.'
          : 'Live ranking needs reviewed identity mappings and an enabled worker.',
      },
    };
  });
}
export type Workspace = Awaited<ReturnType<typeof ownerWorkspace>>;
export async function revokeGrant(owner: Owner, grantId: string) {
  return transaction(owner.tenantId, async (db) => {
    const t = owner.tenantId;
    await assertTenant(db, t);
    const hint = await one<GrantRow>(
      db,
      'SELECT * FROM grants WHERE tenant_id=$1 AND id=$2 AND owner_id=$3',
      [t, grantId, owner.ownerId],
    );
    await db.query('SELECT id FROM clients WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [
      t,
      hint.client_id,
    ]);
    await db.query('SELECT id FROM contexts WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [
      t,
      hint.context_id,
    ]);
    const grant = await one<GrantRow>(
      db,
      'SELECT * FROM grants WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
      [t, grantId],
    );
    if (grant.status === 'revoked') return { status: 'revoked', version: grant.version };
    const scope = (
      await one<{ scope: Scope }>(
        db,
        'SELECT scope FROM grant_revisions WHERE tenant_id=$1 AND grant_id=$2 AND version=$3',
        [t, grantId, grant.version],
      )
    ).scope;
    await db.query(
      'INSERT INTO grant_revisions(tenant_id,grant_id,version,scope,reason) VALUES($1,$2,$3,$4,$5)',
      [t, grantId, grant.version + 1, scope, 'Owner ended future access.'],
    );
    await db.query(
      "UPDATE grants SET status='revoked',version=version+1 WHERE tenant_id=$1 AND id=$2",
      [t, grantId],
    );
    await db.query(
      "INSERT INTO outbox(tenant_id,id,kind,subject_id) VALUES($1,$2,'grant.revoked',$3)",
      [t, randomUUID(), grantId],
    );
    await audit(db, t, 'grant.revoked', grantId, { version: grant.version + 1 });
    return { status: 'revoked', version: grant.version + 1 };
  });
}
export async function correctionPreview(owner: Owner, input: CorrectionInput) {
  return transaction(owner.tenantId, async (db) => {
    await assertTenant(db, owner.tenantId);
    const context = await one<ContextRow>(
      db,
      'SELECT * FROM contexts WHERE tenant_id=$1 AND id=$2 AND owner_id=$3',
      [owner.tenantId, input.contextId, owner.ownerId],
    );
    if (context.revision !== input.expectedRevision)
      throw new DomainError(
        'CORRECTION_CONFLICT',
        'This context changed. Review the latest revision before applying your correction.',
        409,
        { currentRevision: context.revision },
      );
    const signals = await readSignals(db, context);
    if (!input.removeSignalIds.every((id) => signals.some((s) => s.id === id && s.active)))
      throw denied('SIGNAL_SELECTION_REQUIRED');
    const removed = signals
      .filter((s) => input.removeSignalIds.includes(s.id) && s.active)
      .map((s) => ({ id: s.id, title: s.title }));
    const affected = (
      await db.query<{ id: string; client_id: ClientId }>(
        "SELECT id,client_id FROM grants WHERE tenant_id=$1 AND context_id=$2 AND status='active'",
        [owner.tenantId, context.id],
      )
    ).rows.map((g) => ({ id: g.id, clientName: CLIENTS[g.client_id].name }));
    return {
      contextId: context.id,
      contextName: context.name,
      currentRevision: context.revision,
      nextRevision: context.revision + 1,
      removed,
      remaining: signals.filter((s) => s.active && !input.removeSignalIds.includes(s.id)).length,
      affected,
      otherContextsUnchanged: true,
    };
  });
}
export async function applyCorrection(owner: Owner, input: CorrectionInput) {
  return transaction(owner.tenantId, async (db) => {
    const t = owner.tenantId;
    await assertTenant(db, t);
    // Corrections lock all relevant clients in sorted order before the context.
    await db.query('SELECT id FROM clients WHERE tenant_id=$1 ORDER BY id FOR UPDATE', [t]);
    const context = await one<ContextRow>(
      db,
      'SELECT * FROM contexts WHERE tenant_id=$1 AND id=$2 AND owner_id=$3 FOR UPDATE',
      [t, input.contextId, owner.ownerId],
    );
    if (context.revision !== input.expectedRevision)
      throw new DomainError(
        'CORRECTION_CONFLICT',
        'This context changed. Review the latest revision before applying your correction.',
        409,
        { currentRevision: context.revision },
      );
    const signals = await readSignals(db, context);
    if (!input.removeSignalIds.every((id) => signals.some((s) => s.id === id && s.active)))
      throw denied('SIGNAL_SELECTION_REQUIRED');
    const revised = signals.map((s) =>
      input.removeSignalIds.includes(s.id) ? { ...s, active: false } : s,
    );
    await db.query(
      'INSERT INTO context_revisions(tenant_id,context_id,revision,encrypted_signals,reason,author_id) VALUES($1,$2,$3,$4,$5,$6)',
      [t, context.id, context.revision + 1, encrypt(revised), input.reason, owner.ownerId],
    );
    await db.query('UPDATE contexts SET revision=revision+1 WHERE tenant_id=$1 AND id=$2', [
      t,
      context.id,
    ]);
    await db.query(
      "INSERT INTO outbox(tenant_id,id,kind,subject_id) VALUES($1,$2,'context.corrected',$3)",
      [t, randomUUID(), context.id],
    );
    await audit(db, t, 'context.corrected', context.id, {
      fromRevision: context.revision,
      toRevision: context.revision + 1,
      removedCount: input.removeSignalIds.length,
      otherContextsUnchanged: true,
    });
    return { contextId: context.id, revision: context.revision + 1, otherContextsUnchanged: true };
  });
}
export async function createContext(
  owner: Owner,
  input: { name: string; purpose: 'gift' | 'personal'; referenceIds: string[] },
) {
  const selected = REFERENCE_CHOICES.filter((r) => input.referenceIds.includes(r.id));
  if (selected.length !== input.referenceIds.length) throw denied('SIGNAL_SELECTION_REQUIRED');
  return transaction(owner.tenantId, async (db) => {
    await assertTenant(db, owner.tenantId);
    const id = randomUUID();
    await db.query(
      'INSERT INTO contexts(tenant_id,id,owner_id,name,purpose) VALUES($1,$2,$3,$4,$5)',
      [owner.tenantId, id, owner.ownerId, input.name, input.purpose],
    );
    const signals = mapSignals(
      selected.map((r) => ({
        ...r,
        tags: { ...r.tags },
        active: true,
        confirmedAt: new Date().toISOString(),
      })),
    );
    await db.query(
      'INSERT INTO context_revisions(tenant_id,context_id,revision,encrypted_signals,reason,author_id) VALUES($1,$2,1,$3,$4,$5)',
      [
        owner.tenantId,
        id,
        encrypt(signals),
        'Owner confirmed these exact reference identities. Mapping provenance is recorded separately.',
        owner.ownerId,
      ],
    );
    await audit(db, owner.tenantId, 'context.created', id, {
      signalCount: signals.length,
      purpose: input.purpose,
    });
    return { id };
  });
}
export async function disableClient(owner: Owner, clientId: ClientId) {
  return transaction(owner.tenantId, async (db) => {
    await assertTenant(db, owner.tenantId);
    await db.query('SELECT id FROM clients WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [
      owner.tenantId,
      clientId,
    ]);
    await db.query(
      'UPDATE clients SET active=false,epoch=epoch+1 WHERE tenant_id=$1 AND id=$2 AND active=true',
      [owner.tenantId, clientId],
    );
    await audit(db, owner.tenantId, 'client.disabled', clientId);
    return { disabled: true };
  });
}
export const fieldsForReceipt = (fields: PublicField[]) => [...fields];

export function clientOrigin(clientId: ClientId) {
  const value =
    process.env[`CLIENT_${clientId.toUpperCase()}_ORIGIN`] ??
    `http://${clientId}.localhost:${CLIENTS[clientId].port}`;
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('INVALID_CLIENT_ORIGIN');
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')
    throw new Error('CLIENT_HTTPS_REQUIRED');
  return url.origin;
}
export async function eraseWorkspace(owner: Owner) {
  return transaction(owner.tenantId, async (db) => {
    const owned = await db.query(
      "SELECT id FROM users WHERE tenant_id=$1 AND id=$2 AND role='owner'",
      [owner.tenantId, owner.ownerId],
    );
    if (!owned.rowCount) throw denied('PRINCIPAL_DENIED');
    await db.query('SELECT erase_demo_workspace($1)', [owner.tenantId]);
    return { erased: true };
  });
}
export async function eraseContext(owner: Owner, contextId: string) {
  return transaction(owner.tenantId, async (db) => {
    await assertTenant(db, owner.tenantId);
    const result = await db.query<{ erased: boolean }>(
      'SELECT erase_context_payloads($1,$2,$3) AS erased',
      [owner.tenantId, contextId, owner.ownerId],
    );
    if (!result.rows[0].erased) throw denied('PRINCIPAL_DENIED', 404);
    await audit(db, owner.tenantId, 'context.erased', contextId);
    return { erased: true };
  });
}
export async function endOwnerSession(token: string | undefined) {
  if (!token) return;
  const owner = await ownerFromToken(token);
  await transaction(owner.tenantId, (db) =>
    db.query('DELETE FROM owner_sessions WHERE token_hash=$1 AND tenant_id=$2', [
      digest(token),
      owner.tenantId,
    ]),
  );
}
