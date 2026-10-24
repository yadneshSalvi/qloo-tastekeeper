import { randomUUID } from 'node:crypto';
import {
  authorizeDecision,
  projectPublicItem,
  releaseRevisionMatches,
  type AuthorizationResult,
  type DecisionRequest,
} from '../domain/authorization.ts';
import { decisionSchema, type DecisionInput } from '../domain/contracts.ts';
import { rankSample } from '../domain/sample.ts';
import type { CatalogItem, Signal } from '../domain/catalog.ts';
import { rankQloo } from '../integrations/qloo.ts';
import { transaction, type Db } from './db.ts';
import { bodyDigest, decrypt, encrypt } from './crypto.ts';
import { DomainError, denied } from './errors.ts';
import {
  audit,
  issueCredential,
  loadBundle,
  one,
  publicSession,
  type Bundle,
  type Principal,
} from './store.ts';

type Allowed = Extract<AuthorizationResult, { allowed: true }>;
export type RunRow = {
  tenant_id: string;
  id: string;
  client_id: Principal['clientId'];
  delegate_id: string;
  grant_id: string;
  context_id: string;
  token_hash: string;
  request: DecisionInput;
  body_digest: string;
  auth_snapshot: Allowed;
  encrypted_inputs: string;
  state: string;
  result: PreparedResult | null;
  error_code: string | null;
  attempts: number;
  created_at: Date;
  lease_until: Date | null;
};
type PreparedResult = {
  items: Partial<Record<'id' | 'title' | 'description' | 'creator' | 'url' | 'price', unknown>>[];
  provenance: {
    mode: 'authored_sample' | 'qloo';
    label: string;
    status: 'ok' | 'empty' | 'needs_input' | 'partial' | 'degraded' | 'error';
    candidateCount: number;
    selectedCount: number;
  };
};
function authorize(bundle: Bundle, request: DecisionRequest, reserved = false): Allowed {
  // A run already reserved one allowance atomically. A read must not reserve again.
  const records = reserved
    ? {
        ...bundle.records,
        grant: {
          ...bundle.records.grant,
          remainingRequests: Math.max(1, bundle.records.grant.remainingRequests),
        },
      }
    : bundle.records;
  const result = authorizeDecision(records, request, Date.now());
  if (!result.allowed) throw denied(result.code, result.code === 'TOKEN_EXPIRED' ? 401 : 403);
  return result;
}
function sessionRequest(bundle: Bundle): DecisionRequest {
  return {
    grantId: bundle.grant.id,
    contextId: bundle.context.id,
    purpose: bundle.scope.purposes[0],
    operation: 'rank',
    targetType: bundle.snapshot.target_type,
    snapshotId: bundle.snapshot.id,
    candidateIds: bundle.snapshot.payload.map((i) => i.id),
    fields: bundle.scope.fields,
  };
}
function assertClientConstraintTypes(input: DecisionInput) {
  const c = input.hardConstraints;
  if (
    (input.targetType !== 'book' && c.format !== undefined) ||
    (input.targetType !== 'movie' && c.maxMinutes !== undefined) ||
    (input.targetType !== 'place' && c.setting !== undefined)
  )
    throw denied('SCOPE_DENIED');
}
export async function clientSession(principal: Principal) {
  return transaction(principal.tenantId, async (db) => {
    const b = await loadBundle(db, principal, principal.grantId);
    authorize(b, sessionRequest(b), true);
    const selections = (
      await db.query<{ run_id: string; item_id: string; title: string; saved_at: Date }>(
        `SELECT s.run_id,s.item_id,s.title,s.saved_at FROM selections s JOIN decision_runs r ON(r.tenant_id=s.tenant_id AND r.id=s.run_id) WHERE s.tenant_id=$1 AND s.delegate_id=$2 AND r.grant_id=$3 ORDER BY s.saved_at DESC`,
        [principal.tenantId, principal.delegateId, principal.grantId],
      )
    ).rows.map((s) => ({
      runId: s.run_id,
      itemId: s.item_id,
      title: s.title,
      savedAt: s.saved_at.toISOString(),
    }));
    return { ...publicSession(b), selections };
  });
}
export async function renewCredential(principal: Principal) {
  return transaction(principal.tenantId, async (db) => {
    const b = await loadBundle(db, principal, principal.grantId);
    authorize(b, sessionRequest(b), true);
    return issueCredential(db, principal.tenantId, b.client, b.grant);
  });
}
export async function queueDecision(principal: Principal, inputValue: unknown) {
  const input = decisionSchema.parse(inputValue);
  assertClientConstraintTypes(input);
  return transaction(principal.tenantId, async (db) => {
    const b = await loadBundle(db, principal, input.grantId);
    const digest = bodyDigest(input);
    const old = (
      await db.query<RunRow>(
        'SELECT * FROM decision_runs WHERE tenant_id=$1 AND client_id=$2 AND idempotency_key=$3',
        [principal.tenantId, principal.clientId, input.idempotencyKey],
      )
    ).rows[0];
    if (old) {
      if (old.delegate_id !== principal.delegateId || old.grant_id !== input.grantId)
        throw denied('PRINCIPAL_DENIED');
      authorize(b, input, true);
      if (old.body_digest !== digest)
        throw new DomainError(
          'IDEMPOTENCY_CONFLICT',
          'This request key was already used with a different brief. Create a new request.',
          409,
        );
      return { id: old.id, state: old.state, replayed: true };
    }
    const authorized = authorize(b, input);
    const id = randomUUID();
    const signals = b.signals.filter((s) => s.active && authorized.signalIds.includes(s.id));
    const items = b.snapshot.payload.filter((item) => input.candidateIds.includes(item.id));
    await db.query(
      'UPDATE grants SET reserved_count=reserved_count+1 WHERE tenant_id=$1 AND id=$2',
      [principal.tenantId, b.grant.id],
    );
    await db.query(
      `INSERT INTO decision_runs(tenant_id,id,client_id,delegate_id,grant_id,context_id,token_hash,request,body_digest,idempotency_key,auth_snapshot,encrypted_inputs,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'queued')`,
      [
        principal.tenantId,
        id,
        principal.clientId,
        principal.delegateId,
        b.grant.id,
        b.context.id,
        principal.tokenHash,
        input,
        digest,
        input.idempotencyKey,
        authorized,
        encrypt({ signals, items }),
      ],
    );
    await audit(db, principal.tenantId, 'decision.queued', id, {
      clientId: principal.clientId,
      contextRevision: b.context.revision,
      grantVersion: b.grant.version,
      candidateCount: items.length,
      mode: input.mode,
    });
    return { id, state: 'queued', replayed: false };
  });
}
function principalForRun(run: RunRow): Principal {
  return {
    tenantId: run.tenant_id,
    clientId: run.client_id,
    delegateId: run.delegate_id,
    grantId: run.grant_id,
    tokenHash: run.token_hash,
  };
}
class LeaseLost extends Error {}
type FailureOwnership = { attempt: number; unclaimed: boolean };
async function advance(
  db: Db,
  tenantId: string,
  id: string,
  attempt: number,
  expected: string,
  next: string,
) {
  const result = await db.query(
    'UPDATE decision_runs SET state=$5,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND attempts=$3 AND state=$4 AND lease_until>clock_timestamp()',
    [tenantId, id, attempt, expected, next],
  );
  if (result.rowCount !== 1) throw new LeaseLost('Worker lease is no longer current.');
}
async function markFailed(
  tenantId: string,
  id: string,
  error: unknown,
  ownership: FailureOwnership | null,
) {
  if (!ownership || error instanceof LeaseLost) return;
  const code = error instanceof DomainError ? error.code : 'WORKER_FAILED';
  const state = ['REVISION_CHANGED', 'GRANT_REVOKED', 'CLIENT_DISABLED'].includes(code)
    ? 'stale'
    : code === 'NO_ELIGIBLE_OPTIONS' || code === 'SIGNAL_SELECTION_REQUIRED'
      ? 'needs_input'
      : 'failed';
  await transaction(tenantId, async (db) => {
    const condition = ownership.unclaimed
      ? "(state='queued' OR (lease_until<clock_timestamp() AND state IN ('authorizing','resolving','ranking','preparing')))"
      : "state IN ('authorizing','resolving','ranking','preparing') AND lease_until>clock_timestamp()";
    const updated = await db.query(
      `UPDATE decision_runs SET state=$3,error_code=$4,lease_until=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND attempts=$5 AND ${condition}`,
      [tenantId, id, state, code, ownership.attempt],
    );
    if (updated.rowCount === 1) await audit(db, tenantId, 'decision.stopped', id, { code });
  });
}
export type WorkerHooks = { afterRanking?: () => Promise<void> };
/** Durable worker stage; result is still private until releaseDecision. */
export async function prepareDecision(tenantId: string, id: string, hooks: WorkerHooks = {}) {
  let captured: RunRow | null = null;
  let failureOwnership: FailureOwnership | null = null;
  try {
    captured = await transaction(tenantId, async (db) => {
      const hint = await one<RunRow>(
        db,
        'SELECT * FROM decision_runs WHERE tenant_id=$1 AND id=$2',
        [tenantId, id],
      );
      if (
        [
          'released',
          'release_pending',
          'denied',
          'needs_input',
          'cancelled',
          'stale',
          'failed',
        ].includes(hint.state)
      )
        return null;
      if (
        hint.state !== 'queued' &&
        (!hint.lease_until || hint.lease_until.getTime() >= Date.now())
      )
        return null;
      failureOwnership = { attempt: hint.attempts, unclaimed: true };
      if (hint.attempts >= 3 && hint.lease_until && hint.lease_until.getTime() < Date.now())
        throw new DomainError(
          'RETRY_EXHAUSTED',
          'This request could not finish after three attempts. Start a new request.',
          503,
        );
      const bundle = await loadBundle(db, principalForRun(hint), hint.grant_id);
      authorize(bundle, hint.request, true);
      if (!releaseRevisionMatches(hint.auth_snapshot, bundle.records))
        throw denied('REVISION_CHANGED', 409);
      const updated = await db.query<RunRow>(
        `UPDATE decision_runs SET state='authorizing',lease_until=now()+interval '45 seconds',attempts=attempts+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND attempts=$3 AND (state='queued' OR (lease_until < clock_timestamp() AND attempts < 3)) RETURNING *`,
        [tenantId, id, hint.attempts],
      );
      return updated.rows[0] ?? null;
    });
    if (!captured) return;
    const run = captured;
    failureOwnership = { attempt: run.attempts, unclaimed: false };
    await transaction(tenantId, (db) =>
      advance(db, tenantId, id, run.attempts, 'authorizing', 'resolving'),
    );
    const { signals, items } = decrypt<{ signals: Signal[]; items: CatalogItem[] }>(
      run.encrypted_inputs,
    );
    // Recheck before any external call, under the same lock order.
    await transaction(tenantId, async (db) => {
      const b = await loadBundle(db, principalForRun(run), run.grant_id);
      authorize(b, run.request, true);
      if (!releaseRevisionMatches(run.auth_snapshot, b.records))
        throw denied('REVISION_CHANGED', 409);
      await advance(db, tenantId, id, run.attempts, 'resolving', 'ranking');
    });
    let ranked: CatalogItem[];
    let status: PreparedResult['provenance']['status'] = 'ok';
    if (run.request.mode === 'qloo') {
      if (!process.env.QLOO_API_KEY) throw denied('UPSTREAM_UNAVAILABLE', 503);
      const eligible = rankSample(items, signals, run.request.hardConstraints);
      if (eligible.some((i) => !i.qlooId) || signals.some((s) => s.entityId.startsWith('sample:')))
        throw denied('UNMAPPED_CANDIDATES', 422);
      const result = await rankQloo({
        type: run.request.targetType,
        signalIds: signals.map((s) => s.entityId),
        candidateIds: eligible.map((i) => i.qlooId!),
      });
      status = result.status;
      if (status === 'error') throw denied(result.errorCode ?? 'UPSTREAM_UNAVAILABLE', 503);
      if (status === 'needs_input') throw denied('SIGNAL_SELECTION_REQUIRED', 422);
      ranked = result.rankedIds.flatMap((entityId) =>
        eligible.filter((item) => item.qlooId === entityId),
      );
    } else ranked = rankSample(items, signals, run.request.hardConstraints);
    if (!ranked.length) throw denied('NO_ELIGIBLE_OPTIONS', 422);
    if (ranked.some((i) => !run.request.candidateIds.includes(i.id)))
      throw denied('CANDIDATE_DENIED');
    const top = ranked.slice(0, 3);
    const prepared: PreparedResult = {
      items: top.map((item) => projectPublicItem(item, run.request.fields)),
      provenance: {
        mode: run.request.mode === 'sample' ? 'authored_sample' : 'qloo',
        label:
          run.request.mode === 'sample'
            ? 'Authored sample rules · not Qloo'
            : 'Qloo · candidate-restricted ranking',
        status,
        candidateCount: items.length,
        selectedCount: top.length,
      },
    };
    await transaction(tenantId, (db) =>
      advance(db, tenantId, id, run.attempts, 'ranking', 'preparing'),
    );
    await hooks.afterRanking?.();
    await transaction(tenantId, async (db) => {
      const b = await loadBundle(db, principalForRun(run), run.grant_id);
      authorize(b, run.request, true);
      if (!releaseRevisionMatches(run.auth_snapshot, b.records))
        throw denied('REVISION_CHANGED', 409);
      const updated = await db.query(
        "UPDATE decision_runs SET state='release_pending',result=$3,lease_until=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state='preparing' AND attempts=$4 AND lease_until>clock_timestamp()",
        [tenantId, id, prepared, run.attempts],
      );
      if (updated.rowCount !== 1) throw new LeaseLost();
      await audit(db, tenantId, 'decision.prepared', id, {
        provenance: prepared.provenance.mode,
        status,
      });
    });
  } catch (error) {
    await markFailed(tenantId, id, error, failureOwnership);
  }
}
export type ReleaseHooks = { afterLocks?: () => Promise<void> };
export async function releaseDecision(
  principal: Principal,
  id: string,
  saveItemId?: string,
  hooks: ReleaseHooks = {},
) {
  return transaction(principal.tenantId, async (db) => {
    const t = principal.tenantId;
    const hint = await one<RunRow>(
      db,
      'SELECT * FROM decision_runs WHERE tenant_id=$1 AND id=$2 AND client_id=$3 AND delegate_id=$4',
      [t, id, principal.clientId, principal.delegateId],
    );
    const b = await loadBundle(db, principal, hint.grant_id);
    const run = await one<RunRow>(
      db,
      'SELECT * FROM decision_runs WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
      [t, id],
    );
    // This is full live authorization. Revision equality alone never permits release.
    authorize(b, run.request, true);
    if (!releaseRevisionMatches(run.auth_snapshot, b.records))
      throw denied('REVISION_CHANGED', 409);
    await hooks.afterLocks?.();
    // Expiry may pass while a test/transport waits; re-evaluate at authorization time.
    authorize(b, run.request, true);
    if (['failed', 'needs_input', 'denied', 'cancelled', 'stale'].includes(run.state))
      throw denied(
        run.error_code ?? 'REVISION_CHANGED',
        run.error_code === 'UPSTREAM_UNAVAILABLE' ? 503 : 409,
      );
    if (run.state !== 'release_pending' && run.state !== 'released')
      return { id, state: run.state };
    if (!run.result)
      throw new DomainError('RESULT_UNAVAILABLE', 'This choice is still being prepared.', 503);
    const currentItems = new Map(b.snapshot.payload.map((item) => [item.id, item]));
    const items = run.result.items.map((item) => {
      if (
        typeof item.id !== 'string' ||
        !run.request.candidateIds.includes(item.id) ||
        !currentItems.has(item.id)
      )
        throw denied('CANDIDATE_DENIED');
      // Reconstruct from authoritative public catalog fields; ignore stored provider objects.
      return projectPublicItem(currentItems.get(item.id)!, run.request.fields);
    });
    const payload = { items, provenance: run.result.provenance };
    const receiptId = randomUUID();
    const receipt = await one<{ authorized_at: Date }>(
      db,
      `INSERT INTO release_receipts(tenant_id,id,run_id,client_id,delegate_id,grant_version,context_revision,fields,payload_digest,authorized_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp()) RETURNING authorized_at`,
      [
        t,
        receiptId,
        id,
        principal.clientId,
        principal.delegateId,
        b.grant.version,
        b.context.revision,
        JSON.stringify(run.request.fields),
        bodyDigest(payload),
      ],
    );
    await db.query(
      "UPDATE decision_runs SET state='released',updated_at=now() WHERE tenant_id=$1 AND id=$2",
      [t, id],
    );
    if (saveItemId) {
      const item = items.find((i) => i.id === saveItemId);
      if (!item || typeof item.title !== 'string') throw denied('CANDIDATE_DENIED');
      const saved = await one<{ saved_at: Date }>(
        db,
        `INSERT INTO selections(tenant_id,run_id,delegate_id,item_id,title) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,run_id,delegate_id,item_id) DO UPDATE SET title=EXCLUDED.title RETURNING saved_at`,
        [t, id, principal.delegateId, saveItemId, item.title],
      );
      await audit(db, t, 'selection.saved', id, { itemId: saveItemId });
      return {
        saved: true,
        itemId: saveItemId,
        title: item.title,
        savedAt: saved.saved_at.toISOString(),
      };
    }
    await audit(db, t, 'decision.released', id, {
      grantVersion: b.grant.version,
      contextRevision: b.context.revision,
      receiptId,
      fieldCount: run.request.fields.length,
    });
    return {
      id,
      state: 'released',
      ...payload,
      receipt: {
        id: receiptId,
        grantVersion: b.grant.version,
        contextRevision: b.context.revision,
        authorizedAt: receipt.authorized_at.toISOString(),
        fields: run.request.fields,
      },
      stale: false,
    };
  });
}
export async function processOutbox(tenantId: string) {
  return transaction(tenantId, async (db) => {
    const rows = (
      await db.query<{ id: string; kind: string; subject_id: string }>(
        'SELECT id,kind,subject_id FROM outbox WHERE tenant_id=$1 AND processed_at IS NULL ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 30',
        [tenantId],
      )
    ).rows;
    for (const event of rows) {
      if (event.kind === 'grant.revoked') {
        await db.query(
          "UPDATE decision_runs SET state='stale',error_code='GRANT_REVOKED',updated_at=now() WHERE tenant_id=$1 AND grant_id=$2 AND state IN ('queued','authorizing','resolving','ranking','preparing','release_pending')",
          [tenantId, event.subject_id],
        );
      } else if (event.kind === 'context.corrected') {
        // Events can lag behind new requests. Invalidate only decisions that
        // captured an older revision, never work queued after the correction.
        await db.query(
          `UPDATE decision_runs r SET state='stale',error_code='REVISION_CHANGED',updated_at=now()
          FROM contexts c WHERE r.tenant_id=$1 AND r.context_id=$2 AND c.tenant_id=r.tenant_id AND c.id=r.context_id
          AND (r.auth_snapshot->'revisions'->>'contextRevision')::integer < c.revision
          AND r.state IN ('queued','authorizing','resolving','ranking','preparing','release_pending')`,
          [tenantId, event.subject_id],
        );
      }
      await db.query('UPDATE outbox SET processed_at=now() WHERE tenant_id=$1 AND id=$2', [
        tenantId,
        event.id,
      ]);
    }
    return rows.length;
  });
}
export async function workerTick() {
  const tenants = await transaction(null, async (db) => {
    await db.query(
      "INSERT INTO worker_heartbeats(id,last_seen) VALUES('main',now()) ON CONFLICT(id) DO UPDATE SET last_seen=now()",
    );
    return (await db.query<{ tenant_id: string }>('SELECT tenant_id FROM active_demo_tenants()'))
      .rows;
  });
  for (const { tenant_id: t } of tenants) {
    await processOutbox(t);
    const runs = await transaction(t, (db) =>
      db.query<{ id: string }>(
        "SELECT id FROM decision_runs WHERE tenant_id=$1 AND (state='queued' OR (lease_until<now() AND state IN ('authorizing','resolving','ranking','preparing'))) ORDER BY created_at LIMIT 3",
        [t],
      ),
    );
    for (const run of runs.rows) await prepareDecision(t, run.id);
  }
}
export async function ownerEvidence(tenantId: string, ownerId: string, id: string) {
  return transaction(tenantId, async (db) => {
    const run = await one<RunRow>(
      db,
      'SELECT r.* FROM decision_runs r JOIN contexts c ON(c.tenant_id=r.tenant_id AND c.id=r.context_id) WHERE r.tenant_id=$1 AND r.id=$2 AND c.owner_id=$3',
      [tenantId, id, ownerId],
    );
    const receipts = (
      await db.query<{
        id: string;
        grant_version: number;
        context_revision: number;
        fields: string[];
        payload_digest: string;
        authorized_at: Date;
      }>(
        'SELECT id,grant_version,context_revision,fields,payload_digest,authorized_at FROM release_receipts WHERE tenant_id=$1 AND run_id=$2 ORDER BY authorized_at DESC LIMIT 10',
        [tenantId, id],
      )
    ).rows.map((r) => ({ ...r, authorizedAt: r.authorized_at.toISOString() }));
    const inputs = decrypt<{ signals: Signal[]; items: CatalogItem[] }>(run.encrypted_inputs);
    return {
      id: run.id,
      state: run.state,
      clientId: run.client_id,
      contextRevision: run.auth_snapshot.revisions.contextRevision,
      grantVersion: run.auth_snapshot.revisions.grantVersion,
      clientEpoch: run.auth_snapshot.revisions.clientEpoch,
      selectedReferences: inputs.signals.map((s) => ({ id: s.id, title: s.title })),
      candidateIds: run.request.candidateIds,
      provenance: run.result?.provenance ?? { mode: run.request.mode },
      requestDigest: run.body_digest,
      receipts,
      errorCode: run.error_code,
    };
  });
}
export async function health() {
  return transaction(null, async (db) => {
    await db.query('SELECT 1');
    const worker = (
      await db.query<{ last_seen: Date }>("SELECT last_seen FROM worker_heartbeats WHERE id='main'")
    ).rows[0];
    return {
      database: 'ready',
      worker: worker && Date.now() - worker.last_seen.getTime() < 15000 ? 'ready' : 'offline',
      qloo: process.env.QLOO_API_KEY ? 'mapping_required' : 'unavailable',
      mode: 'isolated_demo',
    };
  });
}
