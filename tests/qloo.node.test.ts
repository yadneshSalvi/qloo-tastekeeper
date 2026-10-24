import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectRankEnvelope, rankQloo, validQlooIds } from '../src/integrations/qloo.ts';

const first = '00000000-0000-4000-8000-000000000001';
const second = '00000000-0000-4000-8000-000000000002';
const seed = '00000000-0000-4000-8000-000000000003';
const input = { type: 'book' as const, signalIds: [seed], candidateIds: [first, second] };
const envelope = (status = 'ok') => ({
  operation: 'rank',
  status,
  result_count: 2,
  results: [{ entity_id: second }, { entity_id: first }],
});

test('projects only exact supplied candidates in provider order', () => {
  const result = projectRankEnvelope(envelope(), input.candidateIds);
  assert.deepEqual(result.rankedIds, [second, first]);
  assert.equal(result.status, 'ok');
});
test('rejects unknown candidates, duplicate outputs and malformed counts', () => {
  for (const raw of [
    { ...envelope(), results: [{ entity_id: seed }, { entity_id: first }] },
    { ...envelope(), results: [{ entity_id: first }, { entity_id: first }] },
    { ...envelope(), result_count: 3 },
    { ...envelope(), results: [{ id: first }, { entity_id: second }] },
  ]) {
    assert.equal(projectRankEnvelope(raw, input.candidateIds).errorCode, 'INVALID_RESPONSE');
    assert.deepEqual(projectRankEnvelope(raw, input.candidateIds).rankedIds, []);
  }
});
test('preserves all six official statuses and releases no unresolved/error candidates', () => {
  for (const status of ['ok', 'partial', 'degraded', 'empty', 'needs_input', 'error']) {
    const result = projectRankEnvelope(
      {
        ...envelope(status),
        error: { code: 'QLOO_AUTH', layer: 'qloo', retryable: false, recovery: 'secret' },
      },
      input.candidateIds,
    );
    assert.equal(result.status, status);
    assert.equal(result.rankedIds.length, ['ok', 'partial', 'degraded'].includes(status) ? 2 : 0);
  }
});
test('private references and provider prose cannot escape projection', () => {
  const secret = 'PRIVATE_REFERENCE_DO_NOT_RELEASE';
  const result = projectRankEnvelope(
    {
      ...envelope('partial'),
      summary: secret,
      warnings: [secret],
      interpretation: { signals: [seed, secret] },
      provenance: { requestId: secret },
      results: [{ entity_id: first, explainability: secret, name: secret }],
      result_count: 1,
    },
    input.candidateIds,
  );
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes(seed), false);
  assert.ok(result.warnings.length > 0);
});
test('invalid operation, status and error contracts fail closed', () => {
  for (const raw of [
    null,
    { ...envelope(), operation: 'describe' },
    envelope('success'),
    { ...envelope('error'), error: {} },
  ])
    assert.equal(projectRankEnvelope(raw, input.candidateIds).errorCode, 'INVALID_RESPONSE');
});
test('one to ten confirmed unique UUIDs are required without truncation', () => {
  assert.equal(validQlooIds([first]), true);
  assert.equal(validQlooIds([]), false);
  assert.equal(validQlooIds([first, first.toUpperCase()]), false);
  assert.equal(validQlooIds(['an unresolved name']), false);
  assert.equal(
    validQlooIds(
      Array.from(
        { length: 11 },
        (_, n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      ),
    ),
    false,
  );
});
test('no explicit key means no subprocess or live call, even if a developer has saved credentials', async () => {
  const result = await rankQloo(input, { env: {} });
  assert.equal(result.errorCode, 'NOT_CONFIGURED');
  assert.equal(result.provenance.liveCallAttempted, false);
});
test('an aborted request never starts a provider call', async () => {
  const abort = new AbortController();
  abort.abort();
  const result = await rankQloo(
    { ...input, signal: abort.signal },
    { env: { QLOO_API_KEY: 'test-never-used' } },
  );
  assert.equal(result.errorCode, 'CANCELLED');
  assert.equal(result.provenance.liveCallAttempted, false);
});
test('invalid endpoint and timeout fail before a transport starts', async () => {
  const env = { QLOO_API_KEY: 'test-never-used' };
  for (const settings of [
    { env, timeoutMs: Infinity },
    { env, timeoutMs: 0 },
    { env: { ...env, QLOO_BASE_URL: 'https://untrusted.invalid' } },
  ]) {
    const result = await rankQloo(input, settings);
    assert.equal(result.errorCode, 'INVALID_INPUT');
    assert.equal(result.provenance.liveCallAttempted, false);
  }
});
