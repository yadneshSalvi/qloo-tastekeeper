import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectInsightsResponse, rankQloo } from '../src/integrations/qloo.ts';

// Synthetic contract IDs, deliberately not claimed as canonical Qloo entities.
const first = '00000000-0000-4000-8000-000000000001';
const second = '00000000-0000-4000-8000-000000000002';
const seed = '00000000-0000-4000-8000-000000000003';
const input = { type: 'book' as const, signalIds: [seed], candidateIds: [first, second] };
const env = { QLOO_API_KEY: 'test-key-never-used-live', QLOO_TRANSPORT: 'insights' };
const raw = () => ({
  success: true,
  results: { entities: [{ entity_id: second }, { entity_id: first }] },
});

test('Insights ranks the complete approved candidate pool in one authenticated bounded request', async () => {
  let authorized = 0;
  let called = 0;
  const result = await rankQloo(input, {
    env,
    beforeProviderCall: async () => {
      authorized += 1;
    },
    fetch: async (url, init) => {
      called += 1;
      assert.equal(authorized, 1);
      const parsed = new URL(String(url));
      assert.equal(parsed.origin, 'https://hackathon.api.qloo.com');
      assert.equal(parsed.pathname, '/v2/insights');
      assert.equal(parsed.searchParams.get('filter.type'), 'urn:entity:book');
      assert.equal(parsed.searchParams.get('filter.results.entities'), `${first},${second}`);
      assert.equal(parsed.searchParams.get('signal.interests.entities'), seed);
      assert.equal(parsed.searchParams.get('take'), '2');
      assert.equal(parsed.searchParams.size, 4);
      assert.equal(init?.method, 'GET');
      assert.equal(init.redirect, 'error');
      assert.equal(init.cache, 'no-store');
      assert.ok(init.signal);
      assert.equal(new Headers(init.headers).get('X-Api-Key'), env.QLOO_API_KEY);
      return new Response(JSON.stringify(raw()));
    },
  });
  assert.equal(called, 1);
  assert.equal(authorized, 1);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.rankedIds, [second, first]);
  assert.deepEqual(result.provenance, {
    mode: 'qloo',
    transport: 'insights',
    liveCallAttempted: true,
  });
});

test('the direct projector rejects unknown IDs, duplicates and malformed result shapes', () => {
  for (const invalid of [
    null,
    { ...raw(), success: false },
    { ...raw(), error: 'a private provider error' },
    { results: [{ entity_id: first }] },
    { results: { entities: 'invalid' } },
    { results: { entities: [{ id: first }] } },
    { results: { entities: [{ entity_id: seed }] } },
    { results: { entities: [{ entity_id: first }, { entity_id: first }] } },
    { results: { entities: [{ entity_id: first }, { entity_id: second }, { entity_id: seed }] } },
  ]) {
    const result = projectInsightsResponse(invalid, input.candidateIds);
    assert.equal(result.errorCode, 'INVALID_RESPONSE');
    assert.deepEqual(result.rankedIds, []);
  }
});

test('missing candidate evidence is partial, never stitched with a second ranking call', () => {
  const partial = projectInsightsResponse(
    { success: true, results: { entities: [{ entity_id: first }] } },
    input.candidateIds,
  );
  assert.equal(partial.status, 'partial');
  assert.deepEqual(partial.rankedIds, [first]);
  const empty = projectInsightsResponse(
    { success: true, results: { entities: [] } },
    input.candidateIds,
  );
  assert.equal(empty.status, 'empty');
  assert.deepEqual(empty.rankedIds, []);
});

test('private provider explanation, headers and warnings cannot escape direct projection', () => {
  const secret = 'PRIVATE_SEED_AND_PROVIDER_PROSE';
  const result = projectInsightsResponse(
    {
      ...raw(),
      warnings: [secret],
      request_id: secret,
      results: {
        entities: [{ entity_id: first, name: secret, query: { explainability: [seed, secret] } }],
      },
    },
    input.candidateIds,
  );
  assert.equal(result.status, 'partial');
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(result).includes(seed), false);
});

test('budget or authorization callback errors propagate with zero provider requests', async () => {
  let called = 0;
  const error = new Error('PROVIDER_BUDGET_EXHAUSTED');
  await assert.rejects(
    rankQloo(input, {
      env,
      beforeProviderCall: async () => {
        throw error;
      },
      fetch: async () => {
        called += 1;
        return new Response(JSON.stringify(raw()));
      },
    }),
    (caught) => caught === error,
  );
  assert.equal(called, 0);
});

test('HTTP failures are typed and redacted without retries or a harness fallback', async () => {
  const secret = 'PRIVATE_RESPONSE_BODY';
  for (const status of [401, 403, 429, 500]) {
    let called = 0;
    const result = await rankQloo(input, {
      env,
      fetch: async () => {
        called += 1;
        return new Response(secret, { status });
      },
    });
    assert.equal(called, 1);
    assert.equal(result.status, 'error');
    assert.equal(
      result.errorCode,
      status === 429 ? 'UPSTREAM_LIMIT' : status < 500 ? 'UPSTREAM_AUTH' : 'UPSTREAM_UNAVAILABLE',
    );
    assert.equal(result.provenance.transport, 'insights');
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
});

test('Insights validates endpoint, transport, UUIDs and cancellation before HTTP', async () => {
  let called = 0;
  const fetch: typeof globalThis.fetch = async () => {
    called += 1;
    return new Response(JSON.stringify(raw()));
  };
  for (const invalidEnv of [
    { ...env, QLOO_BASE_URL: 'https://untrusted.invalid' },
    { ...env, QLOO_TRANSPORT: 'invented-fallback' },
  ]) {
    const result = await rankQloo(input, { env: invalidEnv, fetch });
    assert.equal(result.errorCode, 'INVALID_INPUT');
    assert.equal(result.provenance.liveCallAttempted, false);
  }
  const unknown = await rankQloo({ ...input, candidateIds: ['unresolved-book'] }, { env, fetch });
  assert.equal(unknown.errorCode, 'INVALID_INPUT');
  const controller = new AbortController();
  controller.abort();
  const aborted = await rankQloo({ ...input, signal: controller.signal }, { env, fetch });
  assert.equal(aborted.errorCode, 'CANCELLED');
  assert.equal(called, 0);
});

test('the direct response body is size limited and a stalled transport hits its deadline', async () => {
  const oversized = await rankQloo(input, {
    env,
    fetch: async () => new Response('{}', { headers: { 'content-length': '1048577' } }),
  });
  assert.equal(oversized.errorCode, 'INVALID_RESPONSE');
  const timedOut = await rankQloo(input, {
    env,
    timeoutMs: 100,
    fetch: async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return new Response(JSON.stringify(raw()));
    },
  });
  assert.equal(timedOut.errorCode, 'TIMEOUT');
});
