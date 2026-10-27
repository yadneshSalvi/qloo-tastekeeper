import { after, before, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { INVENTORIES, REFERENCE_CHOICES } from '../src/domain/catalog.ts';
import { PUBLIC_FIELDS, type DecisionInput } from '../src/domain/contracts.ts';
import { pool, shutdownDb, transaction } from '../src/server/db.ts';
import { DomainError } from '../src/server/errors.ts';
import {
  ownerEvidence,
  prepareDecision,
  queueDecision,
  releaseDecision,
} from '../src/server/gateway.ts';
import { applyMigrations } from '../src/server/migrate.ts';
import type { VerifiedMappings } from '../src/server/mappings.ts';
import {
  claimInvitation,
  createDemo,
  createInvitation,
  eraseWorkspace,
  ownerWorkspace,
  principalFromToken,
  revokeGrant,
  type Owner,
} from '../src/server/store.ts';

// Synthetic UUIDs and credentials make no canonical Qloo identity claim.
// The global fetch boundary below must intercept every provider request.
const verifiedAt = new Date().toISOString();
const mappings: VerifiedMappings = {
  version: 1,
  verifiedAt,
  references: Object.fromEntries(
    REFERENCE_CHOICES.map((reference) => [
      reference.id,
      {
        entityId: randomUUID(),
        type: reference.type,
        name: reference.title,
        verifiedAt,
        method: 'Synthetic mocked contract fixture; no external identity claim.',
      },
    ]),
  ),
  items: Object.fromEntries(
    INVENTORIES.books.map((item) => [
      item.id,
      {
        entityId: randomUUID(),
        type: 'book' as const,
        name: item.title,
        verifiedAt,
        method: 'Synthetic mocked contract fixture; no external identity claim.',
      },
    ]),
  ),
};
const providerSecret = 'PRIVATE_PROVIDER_EXPLANATION_MUST_STAY_AT_BOUNDARY';
const settings = {
  DEMO_ENABLED: 'true',
  QLOO_ENABLED: 'true',
  QLOO_TRANSPORT: 'insights',
  QLOO_BASE_URL: 'https://hackathon.api.qloo.com',
  QLOO_API_KEY: 'synthetic-qloo-key-never-used-live',
  OPENAI_API_KEY: 'synthetic-openai-key-never-used-live',
  MODEL_ID: 'synthetic-test-model',
  AGENT_ENABLED: 'true',
  QLOO_GLOBAL_DAILY_LIMIT: '100000',
  QLOO_TENANT_DAILY_LIMIT: '100000',
  OPENAI_GLOBAL_DAILY_LIMIT: '100000',
  OPENAI_TENANT_DAILY_LIMIT: '100000',
  QLOO_MAPPINGS_JSON: JSON.stringify(mappings),
  CONTEXT_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  CLOUD_TASKS_QUEUE: '',
} satisfies Record<string, string>;
const originalEnvironment = new Map(
  [...Object.keys(settings), 'DATABASE_URL'].map((key) => [key, process.env[key]]),
);
const originalFetch = globalThis.fetch;
const owners: Owner[] = [];
const unexpectedRequests: string[] = [];
const base = new URL(
  process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgresql://qloo:qloo_local_dev@127.0.0.1:55432/tastekeeper_test',
);
base.pathname = '/tastekeeper_test';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))
  throw new Error(
    'Mocked provider integration tests require the isolated local tastekeeper_test database.',
  );
process.env.DATABASE_URL = base.toString();
Object.assign(process.env, settings);
const denyNetwork: typeof globalThis.fetch = async (request) => {
  unexpectedRequests.push(String(request));
  throw new Error('Network access is forbidden in mocked provider integration tests.');
};
globalThis.fetch = denyNetwork;
before(async () => {
  // Keep other test files' data; each fixture owns and erases its own tenant.
  await applyMigrations(pool());
});
after(async () => {
  try {
    for (const owner of owners) await eraseWorkspace(owner);
    assert.deepEqual(unexpectedRequests, [], 'An unexpected outbound request was attempted.');
  } finally {
    await shutdownDb();
    globalThis.fetch = originalFetch;
    for (const [key, value] of originalEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

async function fixture(t: TestContext, options: { unmappedItemId?: string } = {}) {
  const configured = structuredClone(mappings);
  if (options.unmappedItemId) delete configured.items[options.unmappedItemId];
  process.env.QLOO_MAPPINGS_JSON = JSON.stringify(configured);
  t.after(() => {
    process.env.QLOO_MAPPINGS_JSON = settings.QLOO_MAPPINGS_JSON;
    globalThis.fetch = denyNetwork;
  });
  const owner = await createDemo();
  owners.push(owner);
  const context = (await ownerWorkspace(owner)).contexts.find((entry) => entry.purpose === 'gift')!;
  const invitation = await createInvitation(owner, {
    contextId: context.id,
    clientId: 'books',
    purpose: 'gift',
    signalIds: context.signals.filter((signal) => signal.active).map((signal) => signal.id),
    expiresInHours: 1,
    requestLimit: 4,
    snapshotMode: 'pinned',
    delegateName: 'Alex',
    acknowledged: true,
  });
  const claimed = await claimInvitation(
    'books',
    new URL(invitation.claimUrl).hash.slice('#token='.length),
  );
  const principal = await principalFromToken('books', claimed.credential);
  const input: DecisionInput = {
    grantId: claimed.grant.id,
    contextId: claimed.grant.contextId,
    purpose: 'gift',
    operation: 'rank',
    targetType: 'book',
    snapshotId: claimed.catalog.snapshotId,
    candidateIds: claimed.catalog.items.map((item) => item.id),
    fields: [...PUBLIC_FIELDS],
    hardConstraints: { maxPrice: 3000, format: 'any' },
    mode: 'qloo',
    idempotencyKey: randomUUID(),
    brief: { occasion: 'birthday', note: 'A small gift for an unhurried afternoon.' },
  };
  return { owner, context, principal, input, configured, claimed };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
type ProviderCall = { provider: 'qloo' | 'openai'; url: URL; body?: Record<string, unknown> };
function json(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
}
function tool(name: string, args: unknown) {
  return json({
    status: 'completed',
    error: null,
    output: [
      {
        type: 'function_call',
        call_id: `call_${name}`,
        name,
        arguments: JSON.stringify(args),
        status: 'completed',
      },
    ],
  });
}
function installProviderScript(
  f: Fixture,
  returnedItemIds: string[],
  options: { afterInspection?: () => Promise<void> } = {},
) {
  const calls: ProviderCall[] = [];
  const privateValues = [
    f.owner.tenantId,
    f.owner.ownerId,
    f.input.contextId,
    f.input.grantId,
    f.claimed.credential,
    f.context.name,
    providerSecret,
    settings.QLOO_API_KEY,
    settings.OPENAI_API_KEY,
    ...f.context.signals.flatMap((signal) => [signal.id, signal.title, signal.entityId]),
    ...Object.values(mappings.references).map((entry) => entry.entityId),
    ...Object.values(mappings.items).map((entry) => entry.entityId),
  ];
  globalThis.fetch = async (request, init) => {
    const url = new URL(String(request));
    if (url.origin === 'https://hackathon.api.qloo.com' && url.pathname === '/v2/insights') {
      calls.push({ provider: 'qloo', url });
      assert.equal(init?.method, 'GET');
      assert.equal(new Headers(init.headers).get('x-api-key'), settings.QLOO_API_KEY);
      assert.equal(url.searchParams.get('filter.type'), 'urn:entity:book');
      const sent = url.searchParams.get('filter.results.entities')!.split(',');
      assert.deepEqual(
        sent,
        f.input.candidateIds.flatMap((itemId) =>
          f.configured.items[itemId] ? [f.configured.items[itemId].entityId] : [],
        ),
      );
      assert.deepEqual(
        url.searchParams.get('signal.interests.entities')!.split(','),
        f.context.signals.filter((signal) => signal.active).map((signal) => signal.entityId),
      );
      assert.equal(url.searchParams.get('take'), String(sent.length));
      return json({
        success: true,
        results: {
          entities: returnedItemIds.map((itemId) => ({
            entity_id: f.configured.items[itemId].entityId,
            name: providerSecret,
            query: { explainability: { signals: f.context.signals, text: providerSecret } },
          })),
        },
        interpretation: { privateReferences: f.context.signals },
      });
    }
    if (url.href === 'https://api.openai.com/v1/responses') {
      assert.equal(init?.method, 'POST');
      assert.equal(
        new Headers(init.headers).get('authorization'),
        `Bearer ${settings.OPENAI_API_KEY}`,
      );
      assert.equal(typeof init.body, 'string');
      const serialized = String(init.body);
      for (const value of privateValues) assert.equal(serialized.includes(value), false);
      const body = JSON.parse(serialized) as Record<string, unknown>;
      calls.push({ provider: 'openai', url, body });
      assert.equal(body.model, settings.MODEL_ID);
      assert.equal(body.store, false);
      assert.equal(body.parallel_tool_calls, false);
      const tools = body.tools as { name: string; strict: boolean }[];
      assert.equal(tools.length, 1);
      assert.equal(tools[0].strict, true);
      if (tools[0].name === 'inspect_inventory') {
        const conversation = body.input as { role?: string; content?: string }[];
        const brief = JSON.parse(conversation.find((item) => item.role === 'user')!.content!);
        assert.deepEqual(
          brief.rankedInventory.map((item: { id: string }) => item.id),
          returnedItemIds.slice(0, 3),
        );
        await options.afterInspection?.();
        return tool('inspect_inventory', {
          fields: ['title', 'description', 'creator', 'price'],
          framing: 'thoughtful_gift',
        });
      }
      assert.equal(tools[0].name, 'prepare_choice');
      const conversation = body.input as { type?: string; call_id?: string; output?: string }[];
      const inspected = conversation.find((item) => item.type === 'function_call_output')!;
      assert.equal(inspected.call_id, 'call_inspect_inventory');
      const inventory = JSON.parse(inspected.output!) as {
        constraintsChecked: boolean;
        rankedInventory: { itemId: string; facts: { description: string } }[];
      };
      assert.equal(inventory.constraintsChecked, true);
      return tool('prepare_choice', {
        explanations: inventory.rankedInventory.map(({ itemId, facts }) => ({
          itemId,
          facts: [{ field: 'description', quote: facts.description }],
        })),
      });
    }
    return denyNetwork(request, init);
  };
  return calls;
}
async function providerAttempts(f: Fixture, runId: string) {
  const rows = await transaction(f.owner.tenantId, (db) =>
    db.query<{ provider: string; count: string }>(
      'SELECT provider,count(*) AS count FROM provider_attempts WHERE tenant_id=$1 AND run_id=$2 GROUP BY provider',
      [f.owner.tenantId, runId],
    ),
  );
  return Object.fromEntries(rows.rows.map((row) => [row.provider, Number(row.count)]));
}
const code = (expected: string) => (error: unknown) =>
  error instanceof DomainError && error.code === expected;

test('Qloo order survives both public AI tools with exact persisted HTTP reservations and no seed leakage', async (t) => {
  const f = await fixture(t);
  const returned = [...f.input.candidateIds].reverse();
  const calls = installProviderScript(f, returned);
  const queued = await queueDecision(f.principal, f.input);
  await prepareDecision(f.owner.tenantId, queued.id);
  await prepareDecision(f.owner.tenantId, queued.id); // Prepared runs do not call either provider again.
  const result = await releaseDecision(f.principal, queued.id);
  assert.equal(result.state, 'released');
  assert.ok('items' in result);
  if (!('items' in result)) return;
  assert.deepEqual(
    result.items.map((item) => item.id),
    returned.slice(0, 3),
  );
  assert.deepEqual(
    result.explanations?.map((item) => item.itemId),
    returned.slice(0, 3),
  );
  assert.equal(result.provenance.mode, 'qloo');
  assert.equal(result.provenance.status, 'ok');
  assert.equal(result.provenance.returnedCount, 5);
  assert.equal(result.provenance.selectedCount, 3);
  assert.equal(result.provenance.agent?.status, 'complete');
  assert.deepEqual(
    calls.map((call) => call.provider),
    ['qloo', 'openai', 'openai'],
  );
  assert.deepEqual(await providerAttempts(f, queued.id), { qloo: 1, openai: 2 });
  const evidence = await ownerEvidence(f.owner.tenantId, f.owner.ownerId, queued.id);
  assert.equal(evidence.agent?.requestCount, 2);
  assert.equal(evidence.agent?.toolSteps, 2);
  assert.equal(evidence.agent?.groundedFactCount, 3);
  assert.deepEqual(evidence.qloo, {
    transport: 'insights',
    returnedCount: 5,
    sentCandidateCount: 5,
    requestCount: 1,
  });
  const serialized = JSON.stringify(result);
  for (const signal of f.context.signals) {
    assert.equal(serialized.includes(signal.title), false);
    assert.equal(serialized.includes(signal.entityId), false);
  }
  assert.equal(serialized.includes(providerSecret), false);
  assert.equal(serialized.includes('agentReceipt'), false);
  assert.equal(serialized.includes('qlooEvidence'), false);
});

test('unmapped inventory and provider-omitted candidates stay omitted with disclosed partial coverage', async (t) => {
  const f = await fixture(t, { unmappedItemId: 'book-psalm' });
  const returned = ['book-gathering', 'book-trees'];
  const calls = installProviderScript(f, returned);
  const queued = await queueDecision(f.principal, f.input);
  await prepareDecision(f.owner.tenantId, queued.id);
  const result = await releaseDecision(f.principal, queued.id);
  assert.equal(result.state, 'released');
  assert.ok('items' in result);
  if (!('items' in result)) return;
  assert.deepEqual(
    result.items.map((item) => item.id),
    returned,
  );
  assert.deepEqual(
    result.explanations?.map((item) => item.itemId),
    returned,
  );
  assert.equal(result.provenance.status, 'partial');
  assert.equal(result.provenance.candidateCount, 5);
  assert.equal(result.provenance.mappedCount, 4);
  assert.equal(result.provenance.unmappedCount, 1);
  assert.equal(result.provenance.returnedCount, 2);
  assert.equal(result.provenance.selectedCount, 2);
  assert.equal(result.provenance.agent?.status, 'complete');
  // Runs prepared before the public coverage field recover it from their private count,
  // without exposing the rest of the provider evidence or repeating the provider call.
  await transaction(f.owner.tenantId, (db) =>
    db.query(
      "UPDATE decision_runs SET result=result #- '{provenance,returnedCount}' WHERE tenant_id=$1 AND id=$2",
      [f.owner.tenantId, queued.id],
    ),
  );
  const previousVersion = await releaseDecision(f.principal, queued.id);
  assert.ok('items' in previousVersion);
  if ('items' in previousVersion) {
    assert.equal(previousVersion.provenance.returnedCount, 2);
    assert.equal(JSON.stringify(previousVersion).includes('qlooEvidence'), false);
  }
  assert.deepEqual(
    calls.map((call) => call.provider),
    ['qloo', 'openai', 'openai'],
  );
  assert.deepEqual(await providerAttempts(f, queued.id), { qloo: 1, openai: 2 });
  const evidence = await ownerEvidence(f.owner.tenantId, f.owner.ownerId, queued.id);
  assert.ok('returnedCount' in evidence.provenance);
  if ('returnedCount' in evidence.provenance) assert.equal(evidence.provenance.returnedCount, 2);
  assert.equal(evidence.qloo?.returnedCount, 2);
  assert.equal(evidence.qloo?.sentCandidateCount, 4);
});

test('revocation during the first model step prevents the next model request and every final release', async (t) => {
  const f = await fixture(t);
  const calls = installProviderScript(f, [...f.input.candidateIds].reverse(), {
    afterInspection: async () => {
      await revokeGrant(f.owner, f.input.grantId);
    },
  });
  const queued = await queueDecision(f.principal, f.input);
  await prepareDecision(f.owner.tenantId, queued.id);
  assert.deepEqual(
    calls.map((call) => call.provider),
    ['qloo', 'openai'],
  );
  assert.deepEqual(await providerAttempts(f, queued.id), { qloo: 1, openai: 1 });
  await assert.rejects(releaseDecision(f.principal, queued.id), code('GRANT_REVOKED'));
  const proof = await transaction(f.owner.tenantId, async (db) => ({
    run: (
      await db.query<{ state: string; error_code: string | null; result: unknown }>(
        'SELECT state,error_code,result FROM decision_runs WHERE tenant_id=$1 AND id=$2',
        [f.owner.tenantId, queued.id],
      )
    ).rows[0],
    releases: (
      await db.query('SELECT id FROM release_receipts WHERE tenant_id=$1 AND run_id=$2', [
        f.owner.tenantId,
        queued.id,
      ])
    ).rowCount,
  }));
  assert.equal(proof.run.state, 'stale');
  assert.equal(proof.run.error_code, 'GRANT_REVOKED');
  assert.equal(proof.run.result, null);
  assert.equal(proof.releases, 0);
});
