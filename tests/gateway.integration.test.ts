import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool, transaction, shutdownDb } from '../src/server/db.ts';
import {
  applyCorrection,
  claimInvitation,
  createDemo,
  createInvitation,
  disableClient,
  eraseContext,
  eraseWorkspace,
  loadBundle,
  ownerWorkspace,
  principalFromToken,
  revokeGrant,
  ownerFromToken,
  type Owner,
} from '../src/server/store.ts';
import {
  clientSession,
  prepareDecision,
  processOutbox,
  queueDecision,
  releaseDecision,
  workerTick,
} from '../src/server/gateway.ts';
import { PUBLIC_FIELDS, type DecisionInput } from '../src/domain/contracts.ts';
import { DomainError } from '../src/server/errors.ts';
import { applyMigrations } from '../src/server/migrate.ts';
import { claimBrowserSession, principalFromBrowserSession } from '../src/server/client-sessions.ts';
import { reserveProviderRequest } from '../src/server/provider-budget.ts';

const base = new URL(
  process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgresql://qloo:qloo_local_dev@127.0.0.1:55432/tastekeeper_test',
);
base.pathname = '/tastekeeper_test';
if (!base.pathname.endsWith('_test'))
  throw new Error('Integration tests require an isolated _test database.');
process.env.DATABASE_URL = base.toString();
process.env.DEMO_ENABLED = 'true';
before(async () => {
  await applyMigrations(pool());
  await pool().query('TRUNCATE tenants, worker_heartbeats, request_limits CASCADE');
});
after(async () => {
  await shutdownDb();
});
async function fixture(
  options: {
    clientId?: 'books' | 'media' | 'places';
    purpose?: 'gift' | 'personal';
    limit?: number;
    snapshotMode?: 'pinned' | 'follow_current';
    owner?: Owner;
  } = {},
) {
  const owner = options.owner ?? (await createDemo());
  const workspace = await ownerWorkspace(owner);
  const purpose = options.purpose ?? 'gift';
  const context = workspace.contexts.find((c) => c.purpose === purpose)!;
  const clientId = options.clientId ?? 'books';
  const invite = await createInvitation(owner, {
    contextId: context.id,
    clientId,
    purpose,
    signalIds: context.signals.filter((s) => s.active).map((s) => s.id),
    expiresInHours: 24,
    requestLimit: options.limit ?? 10,
    snapshotMode: options.snapshotMode ?? 'pinned',
    delegateName: 'Alex',
    acknowledged: true,
  });
  const token = new URL(invite.claimUrl).hash.slice('#token='.length);
  const claimed = await claimInvitation(clientId, token);
  const principal = await principalFromToken(clientId, claimed.credential);
  const input: DecisionInput = {
    grantId: claimed.grant.id,
    contextId: claimed.grant.contextId,
    purpose,
    operation: 'rank',
    targetType: claimed.catalog.type,
    snapshotId: claimed.catalog.snapshotId,
    candidateIds: claimed.catalog.items.map((i) => i.id),
    fields: [...PUBLIC_FIELDS],
    hardConstraints: {},
    mode: 'sample',
    idempotencyKey: randomUUID(),
  };
  return { owner, context, invite, token, claimed, principal, input };
}
async function completed(f: Awaited<ReturnType<typeof fixture>>) {
  const run = await queueDecision(f.principal, f.input);
  await prepareDecision(f.principal.tenantId, run.id);
  return { run, result: await releaseDecision(f.principal, run.id) };
}
const code = (expected: string) => (e: unknown) => e instanceof DomainError && e.code === expected;
function barrier() {
  let done!: () => void;
  const wait = new Promise<void>((r) => {
    done = r;
  });
  return { wait, done };
}

test('gift invitation → candidate-only result → saved selection, with no reference leakage', async () => {
  const f = await fixture();
  const { run, result } = await completed(f);
  assert.equal(result.state, 'released');
  assert.ok('items' in result);
  if (!('items' in result)) return;
  assert.equal(result.items.length, 3);
  for (const item of result.items) assert.ok(f.input.candidateIds.includes(item.id as string));
  const serialized = JSON.stringify(result);
  for (const signal of f.context.signals) {
    assert.ok(!serialized.includes(signal.title));
    assert.ok(!serialized.includes(signal.entityId));
  }
  for (const forbidden of [
    'selectedReferences',
    'encrypted_inputs',
    'signalIds',
    'tags',
    'tokenHash',
  ])
    assert.ok(!serialized.includes(forbidden));
  const selection = await releaseDecision(f.principal, run.id, result.items[0].id as string);
  assert.equal(selection.saved, true);
  assert.equal((await clientSession(f.principal)).selections.length, 1);
  const receipts = await transaction(f.owner.tenantId, (db) =>
    db.query('SELECT id FROM release_receipts WHERE tenant_id=$1 AND run_id=$2', [
      f.owner.tenantId,
      run.id,
    ]),
  );
  assert.equal(receipts.rowCount, 2);
});
test('single-use invitation has one winner under concurrent claims', async () => {
  const owner = await createDemo();
  const w = await ownerWorkspace(owner);
  const c = w.contexts.find((c) => c.purpose === 'gift')!;
  const invite = await createInvitation(owner, {
    contextId: c.id,
    clientId: 'books',
    purpose: 'gift',
    signalIds: c.signals.map((s) => s.id),
    expiresInHours: 1,
    requestLimit: 2,
    snapshotMode: 'pinned',
    delegateName: 'Alex',
    acknowledged: true,
  });
  const token = new URL(invite.claimUrl).hash.slice(7);
  const outcomes = await Promise.allSettled([
    claimInvitation('books', token),
    claimInvitation('books', token),
  ]);
  assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((o) => o.status === 'rejected').length, 1);
});
test('another client or tenant cannot use a delegated credential, grant, catalog, or result', async () => {
  const f = await fixture(),
    other = await fixture();
  await assert.rejects(principalFromToken('media', f.claimed.credential), code('PRINCIPAL_DENIED'));
  await assert.rejects(queueDecision(f.principal, { ...f.input, grantId: other.input.grantId }));
  await assert.rejects(
    queueDecision(f.principal, { ...f.input, snapshotId: other.input.snapshotId }),
    code('CATALOG_DENIED'),
  );
  const { run } = await completed(other);
  await assert.rejects(releaseDecision(f.principal, run.id));
  const rows = await transaction(f.owner.tenantId, (db) =>
    db.query('SELECT id FROM contexts WHERE tenant_id=$1', [other.owner.tenantId]),
  );
  assert.equal(rows.rowCount, 0);
  const effective = await transaction(f.owner.tenantId, (db) =>
    db.query('SELECT current_user,rolbypassrls,rolsuper FROM pg_roles WHERE rolname=current_user'),
  );
  assert.equal(effective.rows[0].current_user, 'tastekeeper_runtime');
  assert.equal(effective.rows[0].rolbypassrls, false);
  assert.equal(effective.rows[0].rolsuper, false);
});
test('idempotency reuses one reservation and rejects changed bodies', async () => {
  const f = await fixture();
  const [a, b] = await Promise.all([
    queueDecision(f.principal, f.input),
    queueDecision(f.principal, f.input),
  ]);
  assert.equal(a.id, b.id);
  assert.equal((await clientSession(f.principal)).grant.remainingRequests, 9);
  await assert.rejects(
    queueDecision(f.principal, { ...f.input, hardConstraints: { maxPrice: 1800 } }),
    code('IDEMPOTENCY_CONFLICT'),
  );
});
test('parallel requests cannot overspend a one-choice grant; its reserved result can still release', async () => {
  const f = await fixture({ limit: 1 });
  const outcomes = await Promise.allSettled([
    queueDecision(f.principal, f.input),
    queueDecision(f.principal, { ...f.input, idempotencyKey: randomUUID() }),
  ]);
  assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
  const success = outcomes.find((r) => r.status === 'fulfilled')!;
  if (success.status !== 'fulfilled') return;
  await prepareDecision(f.owner.tenantId, success.value.id);
  assert.equal((await releaseDecision(f.principal, success.value.id)).state, 'released');
});
test('committed revocation blocks stored results, retries, session reads and saves', async () => {
  const f = await fixture();
  const { run, result } = await completed(f);
  await revokeGrant(f.owner, f.input.grantId);
  await assert.rejects(releaseDecision(f.principal, run.id), code('GRANT_REVOKED'));
  await assert.rejects(clientSession(f.principal), code('GRANT_REVOKED'));
  await assert.rejects(queueDecision(f.principal, f.input), code('GRANT_REVOKED'));
  if ('items' in result)
    await assert.rejects(
      releaseDecision(f.principal, run.id, result.items[0].id as string),
      code('GRANT_REVOKED'),
    );
});
test('revocation while ranking discards the in-flight result', async () => {
  const f = await fixture();
  const run = await queueDecision(f.principal, f.input);
  const reached = barrier(),
    resume = barrier();
  const pending = prepareDecision(f.owner.tenantId, run.id, {
    afterRanking: async () => {
      reached.done();
      await resume.wait;
    },
  });
  await reached.wait;
  await revokeGrant(f.owner, f.input.grantId);
  resume.done();
  await pending;
  await assert.rejects(releaseDecision(f.principal, run.id), code('GRANT_REVOKED'));
  const receipts = await transaction(f.owner.tenantId, (db) =>
    db.query('SELECT id FROM release_receipts WHERE tenant_id=$1 AND run_id=$2', [
      f.owner.tenantId,
      run.id,
    ]),
  );
  assert.equal(receipts.rowCount, 0);
});
test('a release holding locks serializes before revocation; later reads are denied', async () => {
  const f = await fixture();
  const run = await queueDecision(f.principal, f.input);
  await prepareDecision(f.owner.tenantId, run.id);
  const reached = barrier(),
    resume = barrier();
  const release = releaseDecision(f.principal, run.id, undefined, {
    afterLocks: async () => {
      reached.done();
      await resume.wait;
    },
  });
  await reached.wait;
  const revocation = revokeGrant(f.owner, f.input.grantId);
  resume.done();
  assert.equal((await release).state, 'released');
  await revocation;
  await assert.rejects(releaseDecision(f.principal, run.id), code('GRANT_REVOKED'));
});
test('explicit correction changes future books and films while the gift context remains unchanged', async () => {
  const owner = await createDemo();
  const books = await fixture({ owner, purpose: 'personal' }),
    films = await fixture({ owner, purpose: 'personal', clientId: 'media' });
  const beforeBooks = await completed(books),
    beforeFilms = await completed(films);
  const workspace = await ownerWorkspace(owner);
  const gift = workspace.contexts.find((c) => c.purpose === 'gift')!;
  await applyCorrection(owner, {
    contextId: books.context.id,
    expectedRevision: 1,
    removeSignalIds: ['ref-forest'],
    reason: 'no_longer_interested',
  });
  books.input.idempotencyKey = randomUUID();
  films.input.idempotencyKey = randomUUID();
  const afterBooks = await completed(books),
    afterFilms = await completed(films);
  for (const [a, b] of [
    [beforeBooks, afterBooks],
    [beforeFilms, afterFilms],
  ]) {
    assert.ok('items' in a.result && 'items' in b.result);
    if ('items' in a.result && 'items' in b.result)
      assert.notEqual(a.result.items[0].id, b.result.items[0].id);
  }
  assert.deepEqual(
    (await ownerWorkspace(owner)).contexts.find((c) => c.id === gift.id),
    gift,
  );
  await assert.rejects(
    releaseDecision(books.principal, beforeBooks.run.id),
    code('REVISION_CHANGED'),
  );
  await assert.rejects(
    applyCorrection(owner, {
      contextId: books.context.id,
      expectedRevision: 1,
      removeSignalIds: ['ref-everyday'],
      reason: 'wrong_situation',
    }),
    code('CORRECTION_CONFLICT'),
  );
});
test('a delayed correction event invalidates old work while preserving a request queued at the new revision', async () => {
  const f = await fixture();
  const old = await queueDecision(f.principal, f.input);
  await applyCorrection(f.owner, {
    contextId: f.context.id,
    expectedRevision: 1,
    removeSignalIds: ['ref-forest'],
    reason: 'wrong_situation',
  });
  const fresh = await queueDecision(f.principal, { ...f.input, idempotencyKey: randomUUID() });
  assert.equal(await processOutbox(f.owner.tenantId), 1);
  const rows = await transaction(f.owner.tenantId, (db) =>
    db.query<{ id: string; state: string }>(
      'SELECT id,state FROM decision_runs WHERE tenant_id=$1 AND id=ANY($2::uuid[])',
      [f.owner.tenantId, [old.id, fresh.id]],
    ),
  );
  assert.equal(rows.rows.find((r) => r.id === old.id)?.state, 'stale');
  assert.equal(rows.rows.find((r) => r.id === fresh.id)?.state, 'queued');
  await prepareDecision(f.owner.tenantId, fresh.id);
  const released = await releaseDecision(f.principal, fresh.id);
  assert.equal(released.state, 'released');
  if ('receipt' in released) assert.equal(released.receipt.contextRevision, 2);
});
test('client disable and wall-clock expiry are checked at final release, not just versions', async () => {
  const f = await fixture();
  const run = await queueDecision(f.principal, f.input);
  await prepareDecision(f.owner.tenantId, run.id);
  await disableClient(f.owner, 'books');
  await assert.rejects(releaseDecision(f.principal, run.id), code('CLIENT_DISABLED'));
  const e = await fixture();
  const exp = await queueDecision(e.principal, e.input);
  await prepareDecision(e.owner.tenantId, exp.id);
  await transaction(e.owner.tenantId, (db) =>
    db.query(
      "UPDATE grants SET expires_at=now()-interval '1 second' WHERE tenant_id=$1 AND id=$2",
      [e.owner.tenantId, e.input.grantId],
    ),
  );
  await assert.rejects(releaseDecision(e.principal, exp.id), code('GRANT_EXPIRED'));
});
test('catalog snapshots and consent/context revisions are immutable', async () => {
  const f = await fixture();
  for (const query of [
    "UPDATE context_revisions SET reason='changed' WHERE tenant_id=$1",
    "UPDATE grant_revisions SET reason='changed' WHERE tenant_id=$1",
    "UPDATE catalog_snapshots SET checksum='changed' WHERE tenant_id=$1",
  ])
    await assert.rejects(
      transaction(f.owner.tenantId, (db) => db.query(query, [f.owner.tenantId])),
      /immutable record/,
    );
});
test('follow-current mode uses the authoritative head and denies an old snapshot after replacement', async () => {
  const f = await fixture({ purpose: 'personal', snapshotMode: 'follow_current' });
  const run = await queueDecision(f.principal, f.input);
  await prepareDecision(f.owner.tenantId, run.id);
  await transaction(f.owner.tenantId, async (db) => {
    const bundle = await loadBundle(db, f.principal, f.input.grantId);
    const id = randomUUID();
    await db.query(
      'INSERT INTO catalog_snapshots(tenant_id,id,client_id,catalog_id,target_type,payload,checksum,version) SELECT tenant_id,$3,client_id,catalog_id,target_type,payload,checksum,version+1 FROM catalog_snapshots WHERE tenant_id=$1 AND id=$2',
      [f.owner.tenantId, bundle.snapshot.id, id],
    );
    await db.query('UPDATE catalog_heads SET snapshot_id=$3 WHERE tenant_id=$1 AND client_id=$2', [
      f.owner.tenantId,
      'books',
      id,
    ]);
  });
  await assert.rejects(releaseDecision(f.principal, run.id), code('CATALOG_DENIED'));
});
test('live mode without a key fails explicitly and never returns sample outcomes', async () => {
  const f = await fixture();
  const run = await queueDecision(f.principal, { ...f.input, mode: 'qloo' });
  await prepareDecision(f.owner.tenantId, run.id);
  await assert.rejects(
    releaseDecision(f.principal, run.id),
    code(process.env.QLOO_API_KEY ? 'UNMAPPED_CANDIDATES' : 'UPSTREAM_UNAVAILABLE'),
  );
  const record = await transaction(f.owner.tenantId, (db) =>
    db.query('SELECT result FROM decision_runs WHERE tenant_id=$1 AND id=$2', [
      f.owner.tenantId,
      run.id,
    ]),
  );
  assert.equal(record.rows[0].result, null);
});

test('expired worker attempts are fenced out after a successor prepares and releases', async () => {
  const f = await fixture();
  const run = await queueDecision(f.principal, f.input);
  const reached = barrier(),
    resume = barrier();
  const oldWorker = prepareDecision(f.owner.tenantId, run.id, {
    afterRanking: async () => {
      reached.done();
      await resume.wait;
    },
  });
  await reached.wait;
  await transaction(f.owner.tenantId, (db) =>
    db.query(
      "UPDATE decision_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE tenant_id=$1 AND id=$2",
      [f.owner.tenantId, run.id],
    ),
  );
  await prepareDecision(f.owner.tenantId, run.id);
  const released = await releaseDecision(f.principal, run.id);
  assert.equal(released.state, 'released');
  resume.done();
  await oldWorker;
  const row = await transaction(f.owner.tenantId, (db) =>
    db.query('SELECT state,attempts,error_code FROM decision_runs WHERE tenant_id=$1 AND id=$2', [
      f.owner.tenantId,
      run.id,
    ]),
  );
  assert.equal(row.rows[0].state, 'released');
  assert.equal(row.rows[0].attempts, 2);
  assert.equal(row.rows[0].error_code, null);
});

test('durable browser sessions renew after inactivity, remain client-bound, and obey revocation', async () => {
  const f = await fixture();
  const invite = await createInvitation(f.owner, {
    contextId: f.context.id,
    clientId: 'books',
    purpose: 'gift',
    signalIds: f.context.signals.map((s) => s.id),
    expiresInHours: 24,
    requestLimit: 4,
    snapshotMode: 'pinned',
    delegateName: 'Alex',
    acknowledged: true,
  });
  const claimed = await claimBrowserSession('books', new URL(invite.claimUrl).hash.slice(7));
  assert.equal('credential' in claimed, false);
  const original = await principalFromBrowserSession('books', claimed.sessionToken);
  const input = {
    ...f.input,
    grantId: claimed.grant.id,
    idempotencyKey: randomUUID(),
    brief: { occasion: 'birthday' as const, note: 'A small thoughtful gift' },
  };
  const queued = await queueDecision(original, input);
  await prepareDecision(original.tenantId, queued.id);
  await transaction(original.tenantId, (db) =>
    db.query(
      "UPDATE credentials SET expires_at=now()-interval '1 minute' WHERE tenant_id=$1 AND token_hash=$2",
      [original.tenantId, original.tokenHash],
    ),
  );
  const resumed = await principalFromBrowserSession('books', claimed.sessionToken);
  assert.notEqual(resumed.tokenHash, original.tokenHash);
  const session = await clientSession(resumed);
  assert.equal(session.latestRunId, queued.id);
  assert.deepEqual(session.brief, { hardConstraints: {}, mode: 'sample', brief: input.brief });
  assert.equal((await releaseDecision(resumed, queued.id)).state, 'released');
  const stored = await transaction(original.tenantId, (db) =>
    db.query('SELECT * FROM client_sessions WHERE tenant_id=$1', [original.tenantId]),
  );
  assert.ok(!JSON.stringify(stored.rows).includes(claimed.sessionToken));
  await assert.rejects(
    principalFromBrowserSession('media', claimed.sessionToken),
    code('PRINCIPAL_DENIED'),
  );
  await revokeGrant(f.owner, claimed.grant.id);
  await assert.rejects(
    principalFromBrowserSession('books', claimed.sessionToken),
    code('GRANT_REVOKED'),
  );
});

test('provider HTTP reservations enforce per-run and per-tenant limits under concurrency', async () => {
  const f = await fixture();
  const run = await queueDecision(f.principal, f.input);
  const outcomes = await Promise.allSettled([
    reserveProviderRequest(f.owner.tenantId, run.id, 'qloo'),
    reserveProviderRequest(f.owner.tenantId, run.id, 'qloo'),
  ]);
  assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((r) => r.status === 'rejected').length, 1);
  await reserveProviderRequest(f.owner.tenantId, run.id, 'openai');
  await reserveProviderRequest(f.owner.tenantId, run.id, 'openai');
  await assert.rejects(
    reserveProviderRequest(f.owner.tenantId, run.id, 'openai'),
    code('PROVIDER_ATTEMPT_LIMIT'),
  );
  const beforeLimit = process.env.QLOO_TENANT_DAILY_LIMIT;
  process.env.QLOO_TENANT_DAILY_LIMIT = '1';
  try {
    const next = await queueDecision(f.principal, { ...f.input, idempotencyKey: randomUUID() });
    await assert.rejects(
      reserveProviderRequest(f.owner.tenantId, next.id, 'qloo'),
      code('UPSTREAM_LIMIT'),
    );
  } finally {
    if (beforeLimit === undefined) delete process.env.QLOO_TENANT_DAILY_LIMIT;
    else process.env.QLOO_TENANT_DAILY_LIMIT = beforeLimit;
  }
});

test('context erasure immediately removes retained profile payloads and blocks prior delegated access', async () => {
  const f = await fixture();
  const { run } = await completed(f);
  await eraseContext(f.owner, f.context.id);
  assert.ok(
    !(await ownerWorkspace(f.owner)).contexts.some((context) => context.id === f.context.id),
  );
  const rows = await transaction(f.owner.tenantId, async (db) => ({
    revisions: (
      await db.query('SELECT * FROM context_revisions WHERE tenant_id=$1 AND context_id=$2', [
        f.owner.tenantId,
        f.context.id,
      ])
    ).rows,
    run: (
      await db.query(
        'SELECT encrypted_inputs,encrypted_checkpoint,result FROM decision_runs WHERE tenant_id=$1 AND id=$2',
        [f.owner.tenantId, run.id],
      )
    ).rows[0],
  }));
  assert.equal(rows.revisions.length, 0);
  assert.deepEqual(rows.run, { encrypted_inputs: '', encrypted_checkpoint: null, result: null });
  await assert.rejects(releaseDecision(f.principal, run.id), code('CONTEXT_DELETED'));
});

test('workspace deletion removes records and sessions without granting runtime an immutability bypass', async () => {
  const f = await fixture();
  await completed(f);
  await assert.rejects(
    transaction(f.owner.tenantId, async (db) => {
      await db.query("SELECT set_config('app.retention_delete','on',true)");
      await db.query('DELETE FROM context_revisions WHERE tenant_id=$1', [f.owner.tenantId]);
    }),
    /immutable record/,
  );
  await eraseWorkspace(f.owner);
  assert.equal(
    (await pool().query('SELECT tenant_id FROM tenants WHERE tenant_id=$1', [f.owner.tenantId]))
      .rowCount,
    0,
  );
  if ('token' in f.owner) await assert.rejects(ownerFromToken(String(f.owner.token)));
  await assert.rejects(clientSession(f.principal));
});

test('maintenance removes expired demo workspaces and does not call a provider for idle workspaces', async () => {
  const f = await fixture();
  await pool().query("UPDATE tenants SET expires_at=now()-interval '1 minute' WHERE tenant_id=$1", [
    f.owner.tenantId,
  ]);
  const before = Number(
    (await pool().query('SELECT count(*) FROM provider_attempts')).rows[0].count,
  );
  const result = await workerTick();
  assert.ok(Number(result.erased) >= 1);
  assert.equal(
    (await pool().query('SELECT tenant_id FROM tenants WHERE tenant_id=$1', [f.owner.tenantId]))
      .rowCount,
    0,
  );
  assert.equal(
    Number((await pool().query('SELECT count(*) FROM provider_attempts')).rows[0].count),
    before,
  );
});
