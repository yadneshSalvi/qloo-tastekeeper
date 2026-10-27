import { after, before, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PUBLIC_FIELDS } from '../src/domain/contracts.ts';
import type { Signal } from '../src/domain/catalog.ts';
import { decrypt } from '../src/server/crypto.ts';
import { pool, shutdownDb, transaction } from '../src/server/db.ts';
import { DomainError } from '../src/server/errors.ts';
import { queueDecision } from '../src/server/gateway.ts';
import { applyMigrations } from '../src/server/migrate.ts';
import {
  confirmReference,
  prepareReferenceSearch,
  queueReferenceSearch,
  referenceSearchView,
} from '../src/server/reference-search.ts';
import {
  claimInvitation,
  createDemo,
  createInvitation,
  eraseWorkspace,
  ownerWorkspace,
  principalFromToken,
  type Owner,
} from '../src/server/store.ts';

// All provider identities and credentials are synthetic. Never send these
// fixtures to Qloo; every HTTP request is intercepted below.
const identities: string[] = [randomUUID(), randomUUID()];
const query = { query: 'Alex Example', type: 'person' as const };
const privateMetadata = 'UNAPPROVED_PROVIDER_BIOGRAPHY_AND_CONTACT_INFORMATION';
const settings = {
  DEMO_ENABLED: 'true',
  QLOO_ENABLED: 'true',
  QLOO_TRANSPORT: 'insights',
  QLOO_BASE_URL: 'https://hackathon.api.qloo.com',
  QLOO_API_KEY: 'synthetic-reference-search-key-never-used-live',
  QLOO_MAPPINGS_JSON: '',
  QLOO_MAPPINGS_FILE: '',
  QLOO_GLOBAL_DAILY_LIMIT: '100000',
  QLOO_TENANT_DAILY_LIMIT: '100000',
  QLOO_SEARCH_TENANT_DAILY_LIMIT: '100000',
  CONTEXT_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  CLOUD_TASKS_QUEUE: '',
} satisfies Record<string, string>;
const priorEnvironment = new Map(
  [...Object.keys(settings), 'DATABASE_URL'].map((key) => [key, process.env[key]]),
);
const priorFetch = globalThis.fetch;
const owners: Owner[] = [];
const unexpected: string[] = [];
const base = new URL(
  process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgresql://qloo:qloo_local_dev@127.0.0.1:55432/tastekeeper_test',
);
base.pathname = '/tastekeeper_test';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))
  throw new Error('Reference-search tests require the isolated local tastekeeper_test database.');
process.env.DATABASE_URL = base.toString();
Object.assign(process.env, settings);
const denyNetwork: typeof globalThis.fetch = async (request) => {
  unexpected.push(String(request));
  throw new Error('Network access is forbidden in mocked reference-search tests.');
};
globalThis.fetch = denyNetwork;
before(async () => {
  await applyMigrations(pool());
});
after(async () => {
  try {
    for (const owner of owners) await eraseWorkspace(owner);
    assert.deepEqual(unexpected, [], 'An unexpected outbound request was attempted.');
  } finally {
    await shutdownDb();
    globalThis.fetch = priorFetch;
    for (const [key, value] of priorEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

async function fixture(t: TestContext) {
  t.after(() => {
    globalThis.fetch = denyNetwork;
  });
  const owner = await createDemo();
  owners.push(owner);
  const context = (await ownerWorkspace(owner)).contexts.find((entry) => entry.purpose === 'gift')!;
  return { owner, context };
}
function installSearch(status = 200) {
  const requests: URL[] = [];
  globalThis.fetch = async (request, init) => {
    const url = new URL(String(request));
    if (url.origin !== 'https://hackathon.api.qloo.com' || url.pathname !== '/search')
      return denyNetwork(request, init);
    requests.push(url);
    assert.equal(init?.method, 'GET');
    assert.equal(new Headers(init.headers).get('x-api-key'), settings.QLOO_API_KEY);
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      query: query.query,
      types: 'urn:entity:person',
      take: '5',
    });
    assert.equal(init.redirect, 'error');
    const payload =
      status === 200
        ? {
            success: true,
            results: identities.map((entityId, index) => ({
              entity_id: entityId,
              name: query.query,
              types: ['urn:entity', 'urn:entity:person'],
              properties: {
                date_of_birth: index === 0 ? '1950-04-03' : '1980-04-03',
                biography: privateMetadata,
                phone: privateMetadata,
              },
            })),
          }
        : { error: privateMetadata };
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return requests;
}
const code = (expected: string) => (error: unknown) =>
  error instanceof DomainError && error.code === expected;
async function searchRow(owner: Owner, searchId: string) {
  return transaction(
    owner.tenantId,
    async (db) =>
      (
        await db.query<{
          state: string;
          http_reserved: boolean;
          encrypted_query: string;
          encrypted_results: string | null;
          error_code: string | null;
        }>(
          'SELECT state,http_reserved,encrypted_query,encrypted_results,error_code FROM reference_searches WHERE tenant_id=$1 AND id=$2',
          [owner.tenantId, searchId],
        )
      ).rows[0],
  );
}

test('concurrent duplicate searches share one durable job, one HTTP reservation and opaque alternatives', async (t) => {
  const f = await fixture(t);
  const requests = installSearch();
  const queued = await Promise.all([
    queueReferenceSearch(f.owner, query),
    queueReferenceSearch(f.owner, query),
    queueReferenceSearch(f.owner, query),
  ]);
  assert.equal(new Set(queued.map((item) => item.id)).size, 1);
  const id = queued[0].id;
  await Promise.all([
    prepareReferenceSearch(f.owner.tenantId, id),
    prepareReferenceSearch(f.owner.tenantId, id),
  ]);
  await prepareReferenceSearch(f.owner.tenantId, id);
  assert.equal(requests.length, 1);
  const repeated = await queueReferenceSearch(f.owner, query);
  assert.equal(repeated.id, id);
  assert.equal(repeated.state, 'complete');
  const view = await referenceSearchView(f.owner, id);
  assert.equal(view.state, 'complete');
  assert.equal(view.candidates.length, 2);
  assert.deepEqual(
    view.candidates.map((item) => item.title),
    [query.query, query.query],
  );
  assert.deepEqual(
    view.candidates.map((item) => item.subtitle),
    ['Born 1950-04-03', 'Born 1980-04-03'],
  );
  assert.notEqual(view.candidates[0].id, view.candidates[1].id);
  for (const candidate of view.candidates) assert.equal(identities.includes(candidate.id), false);
  const serialized = JSON.stringify(view);
  assert.equal(serialized.includes('entityId'), false);
  assert.equal(serialized.includes(privateMetadata), false);
  for (const entityId of identities) assert.equal(serialized.includes(entityId), false);
  const stored = await searchRow(f.owner, id);
  assert.equal(stored.http_reserved, true);
  assert.equal(stored.state, 'complete');
  assert.equal(stored.error_code, null);
  assert.equal(stored.encrypted_query.includes(query.query), false);
  assert.ok(stored.encrypted_results);
  for (const entityId of identities)
    assert.equal(stored.encrypted_results.includes(entityId), false);
  const rows = await transaction(f.owner.tenantId, (db) =>
    db.query('SELECT id FROM reference_searches WHERE tenant_id=$1', [f.owner.tenantId]),
  );
  assert.equal(rows.rowCount, 1);
});

test('only the search owner can view alternatives or confirm one into an owned context', async (t) => {
  const f = await fixture(t);
  const other = await fixture(t);
  const requests = installSearch();
  const queued = await queueReferenceSearch(f.owner, query);
  await prepareReferenceSearch(f.owner.tenantId, queued.id);
  const view = await referenceSearchView(f.owner, queued.id);
  const input = { searchId: queued.id, candidateId: view.candidates[0].id, expectedRevision: 1 };
  await assert.rejects(referenceSearchView(other.owner, queued.id), code('PRINCIPAL_DENIED'));
  await assert.rejects(
    confirmReference(other.owner, f.context.id, input),
    code('PRINCIPAL_DENIED'),
  );
  await assert.rejects(
    confirmReference(other.owner, other.context.id, input),
    code('PRINCIPAL_DENIED'),
  );
  const unchanged = (await ownerWorkspace(other.owner)).contexts.find(
    (entry) => entry.id === other.context.id,
  )!;
  assert.equal(unchanged.revision, 1);
  assert.equal(
    unchanged.signals.some((signal) => identities.includes(signal.entityId)),
    false,
  );
  assert.equal(requests.length, 1);
});

test('explicit confirmation adds one unique signal and revision without broadening an existing grant', async (t) => {
  const f = await fixture(t);
  const approvedSignalIds = f.context.signals
    .filter((signal) => signal.active)
    .map((signal) => signal.id);
  const invitation = await createInvitation(f.owner, {
    contextId: f.context.id,
    clientId: 'books',
    purpose: 'gift',
    signalIds: approvedSignalIds,
    expiresInHours: 1,
    requestLimit: 3,
    snapshotMode: 'pinned',
    delegateName: 'Alex',
    acknowledged: true,
  });
  const claimed = await claimInvitation(
    'books',
    new URL(invitation.claimUrl).hash.slice('#token='.length),
  );
  const principal = await principalFromToken('books', claimed.credential);
  const requests = installSearch();
  const queued = await queueReferenceSearch(f.owner, query);
  await prepareReferenceSearch(f.owner.tenantId, queued.id);
  const alternatives = await referenceSearchView(f.owner, queued.id);
  const confirmed = await confirmReference(f.owner, f.context.id, {
    searchId: queued.id,
    candidateId: alternatives.candidates[1].id,
    expectedRevision: 1,
  });
  assert.equal(confirmed.revision, 2);
  assert.equal(confirmed.existingGrantsUnchanged, true);
  assert.ok(confirmed.added.id.startsWith('sig-'));
  assert.equal(approvedSignalIds.includes(confirmed.added.id), false);
  for (const entityId of identities)
    assert.equal(JSON.stringify(confirmed).includes(entityId), false);
  const context = (await ownerWorkspace(f.owner)).contexts.find(
    (entry) => entry.id === f.context.id,
  )!;
  assert.equal(context.revision, 2);
  assert.equal(context.signals.length, f.context.signals.length + 1);
  const added = context.signals.find((signal) => signal.id === confirmed.added.id)!;
  assert.equal(added.entityId, identities[1]);
  assert.equal(added.subtitle, 'Born 1980-04-03');
  assert.equal(
    context.signals.some((signal) => signal.entityId === identities[0]),
    false,
  );
  const grant = await transaction(
    f.owner.tenantId,
    async (db) =>
      (
        await db.query<{ scope: { signalIds: string[] }; version: number }>(
          'SELECT scope,version FROM grant_revisions WHERE tenant_id=$1 AND grant_id=$2 ORDER BY version DESC LIMIT 1',
          [f.owner.tenantId, claimed.grant.id],
        )
      ).rows[0],
  );
  assert.equal(grant.version, 1);
  assert.deepEqual(grant.scope.signalIds, approvedSignalIds);
  assert.equal(grant.scope.signalIds.includes(added.id), false);

  const decision = await queueDecision(principal, {
    grantId: claimed.grant.id,
    contextId: f.context.id,
    purpose: 'gift',
    operation: 'rank',
    targetType: 'book',
    snapshotId: claimed.catalog.snapshotId,
    candidateIds: claimed.catalog.items.map((item) => item.id),
    fields: [...PUBLIC_FIELDS],
    hardConstraints: {},
    mode: 'sample',
    idempotencyKey: randomUUID(),
  });
  const captured = await transaction(
    f.owner.tenantId,
    async (db) =>
      (
        await db.query<{ encrypted_inputs: string }>(
          'SELECT encrypted_inputs FROM decision_runs WHERE tenant_id=$1 AND id=$2',
          [f.owner.tenantId, decision.id],
        )
      ).rows[0],
  );
  const signals = decrypt<{ signals: Signal[] }>(captured.encrypted_inputs).signals;
  assert.deepEqual(
    signals.map((signal) => signal.id),
    approvedSignalIds,
  );
  assert.equal(
    signals.some((signal) => signal.id === added.id),
    false,
  );
  await assert.rejects(
    confirmReference(f.owner, f.context.id, {
      searchId: queued.id,
      candidateId: alternatives.candidates[0].id,
      expectedRevision: 1,
    }),
    code('CORRECTION_CONFLICT'),
  );
  for (const unknown of [randomUUID(), identities[0]]) {
    await assert.rejects(
      confirmReference(f.owner, f.context.id, {
        searchId: queued.id,
        candidateId: unknown,
        expectedRevision: 2,
      }),
      code('PRINCIPAL_DENIED'),
    );
  }
  await assert.rejects(
    confirmReference(f.owner, f.context.id, {
      searchId: queued.id,
      candidateId: alternatives.candidates[1].id,
      expectedRevision: 2,
    }),
    code('REFERENCE_ALREADY_ADDED'),
  );
  assert.equal(
    (await ownerWorkspace(f.owner)).contexts.find((entry) => entry.id === f.context.id)!.revision,
    2,
  );
  assert.equal(requests.length, 1);
});

test('a failed provider attempt keeps its reservation and cannot be retried by the worker', async (t) => {
  const f = await fixture(t);
  const requests = installSearch(500);
  const queued = await queueReferenceSearch(f.owner, query);
  await prepareReferenceSearch(f.owner.tenantId, queued.id);
  await prepareReferenceSearch(f.owner.tenantId, queued.id);
  const view = await referenceSearchView(f.owner, queued.id);
  assert.equal(view.state, 'failed');
  assert.deepEqual(view.candidates, []);
  assert.equal(view.error?.code, 'UPSTREAM_UNAVAILABLE');
  assert.equal(JSON.stringify(view).includes(privateMetadata), false);
  assert.equal((await searchRow(f.owner, queued.id)).http_reserved, true);
  assert.equal(requests.length, 1);
});
