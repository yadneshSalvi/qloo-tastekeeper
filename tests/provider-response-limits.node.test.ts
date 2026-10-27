import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rankQloo } from '../src/integrations/qloo.ts';
import { searchQlooReferences } from '../src/integrations/qloo-search.ts';
import { preparePublicChoice } from '../src/integrations/agent.ts';

// Synthetic IDs only. Every adapter receives an injected, local transport.
const movieIds: string[] = Array.from({ length: 10 }, () => randomUUID());
const seed = randomUUID();
const env = { QLOO_API_KEY: 'synthetic-qloo-key', QLOO_TRANSPORT: 'insights' };
const qlooLimit = 1024 * 1024;
const movieInput = {
  type: 'movie' as const,
  signalIds: [seed],
  candidateIds: movieIds.slice(0, 5),
};
const rankPayload = (ids = movieInput.candidateIds) => ({
  success: true,
  results: {
    entities: [...ids].reverse().map((entity_id) => ({
      entity_id,
      name: 'Synthetic movie',
      properties: { description: 'SYNTHETIC_METADATA_NOT_FOR_RELEASE' },
    })),
  },
});
function sizedJson(payload: Record<string, unknown>, bytes: number): Uint8Array {
  const bare = JSON.stringify({ ...payload, unused_metadata: '' });
  const padding = bytes - Buffer.byteLength(bare);
  assert.ok(padding >= 0);
  const encoded = Buffer.from(JSON.stringify({ ...payload, unused_metadata: 'x'.repeat(padding) }));
  assert.equal(encoded.byteLength, bytes);
  return encoded;
}
function streamed(bytes: Uint8Array, contentLength?: string) {
  const state = { producedBytes: 0, cancelled: false };
  const response = new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (state.producedBytes === bytes.byteLength) {
          controller.close();
          return;
        }
        const end = Math.min(state.producedBytes + 16384, bytes.byteLength);
        controller.enqueue(bytes.subarray(state.producedBytes, end));
        state.producedBytes = end;
      },
      cancel() {
        state.cancelled = true;
      },
    }),
    contentLength === undefined ? undefined : { headers: { 'content-length': contentLength } },
  );
  return { response, state };
}

test('a 188,066-byte streamed five-movie response ranks only the supplied IDs without leaking metadata', async () => {
  const body = streamed(sizedJson(rankPayload(), 188066));
  assert.equal(body.response.headers.has('content-length'), false);
  let calls = 0;
  const result = await rankQloo(movieInput, {
    env,
    fetch: async () => {
      calls += 1;
      return body.response;
    },
  });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.rankedIds, [...movieInput.candidateIds].reverse());
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_METADATA_NOT_FOR_RELEASE'), false);
  assert.equal(body.state.producedBytes, 188066);
  assert.equal(calls, 1);
});

test('the full 1 MiB boundary still accepts at most ten supplied ranking entities', async () => {
  const body = streamed(sizedJson(rankPayload(movieIds), qlooLimit));
  const ranked = await rankQloo(
    { ...movieInput, candidateIds: movieIds },
    {
      env,
      fetch: async () => body.response,
    },
  );
  assert.equal(ranked.status, 'ok');
  assert.deepEqual(ranked.rankedIds, [...movieIds].reverse());
  const tooMany = await rankQloo(
    { ...movieInput, candidateIds: movieIds },
    {
      env,
      fetch: async () =>
        streamed(sizedJson(rankPayload([...movieIds, randomUUID()]), 188066)).response,
    },
  );
  assert.equal(tooMany.errorCode, 'INVALID_RESPONSE');
  assert.deepEqual(tooMany.rankedIds, []);
});

test('rich streamed search metadata fits the Qloo boundary while its five-result whitelist stays narrow', async () => {
  const payload = {
    success: true,
    results: movieInput.candidateIds.map((entity_id, index) => ({
      entity_id,
      name: `Synthetic movie ${index}`,
      types: ['urn:entity:movie'],
      properties: {
        release_year: 2020 + index,
        description: 'SYNTHETIC_METADATA_NOT_FOR_RELEASE',
      },
    })),
  };
  const body = streamed(sizedJson(payload, qlooLimit));
  const result = await searchQlooReferences(
    { query: 'Synthetic movie', type: 'movie' },
    {
      env,
      fetch: async () => body.response,
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.candidates.length, 5);
  assert.deepEqual(
    result.candidates.map((item) => item.entityId),
    movieInput.candidateIds,
  );
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_METADATA_NOT_FOR_RELEASE'), false);
  assert.equal(JSON.stringify(result).includes('unused_metadata'), false);
});

test('Qloo cancels oversized streams despite absent or misleading Content-Length and never retries', async () => {
  for (const contentLength of [undefined, '32']) {
    for (const operation of ['rank', 'search'] as const) {
      // Valid JSON if fully consumed, so cancellation before EOF proves the
      // actual byte counter rejected the stream rather than JSON parsing.
      const body = streamed(sizedJson(rankPayload(), 2 * qlooLimit), contentLength);
      let calls = 0;
      const fetch: typeof globalThis.fetch = async () => {
        calls += 1;
        return body.response;
      };
      const result =
        operation === 'rank'
          ? await rankQloo(movieInput, { env, fetch })
          : await searchQlooReferences({ query: 'Synthetic movie', type: 'movie' }, { env, fetch });
      assert.ok('errorCode' in result);
      assert.equal(result.errorCode, 'INVALID_RESPONSE');
      assert.equal(body.state.cancelled, true);
      assert.ok(body.state.producedBytes < 2 * qlooLimit);
      assert.equal(calls, 1);
    }
  }
});

test('a rich Qloo response that stalls mid-body still hits the original total deadline', async () => {
  let cancelled = false;
  let closeTimer: ReturnType<typeof setTimeout>;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(sizedJson(rankPayload(), 188066).subarray(0, 150000));
        closeTimer = setTimeout(() => controller.close(), 200);
      },
      cancel() {
        cancelled = true;
        clearTimeout(closeTimer);
      },
    }),
  );
  const result = await rankQloo(movieInput, { env, timeoutMs: 100, fetch: async () => response });
  assert.equal(result.errorCode, 'TIMEOUT');
  assert.deepEqual(result.rankedIds, []);
  assert.equal(cancelled, true);
});

test('OpenAI retains its separate 128 KiB streamed-body limit', async () => {
  const body = streamed(
    sizedJson(
      {
        status: 'completed',
        error: null,
        output: [
          {
            type: 'function_call',
            call_id: 'call_inspect',
            name: 'inspect_inventory',
            arguments: JSON.stringify({
              fields: ['title', 'description'],
              framing: 'thoughtful_gift',
            }),
          },
        ],
      },
      2 * 131072,
    ),
    '32',
  );
  let calls = 0;
  const result = await preparePublicChoice(
    {
      purpose: 'gift',
      targetType: 'book',
      hardConstraints: {},
      items: [
        {
          id: 'public-synthetic-book',
          title: 'A Synthetic Book',
          description: 'A public catalog description.',
        },
      ],
    },
    {
      env: { OPENAI_API_KEY: 'synthetic-openai-key', MODEL_ID: 'synthetic-model' },
      fetch: async () => {
        calls += 1;
        return body.response;
      },
    },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorCode, 'INVALID_RESPONSE');
  assert.equal(result.receipt.requestCount, 1);
  assert.equal(body.state.cancelled, true);
  assert.equal(calls, 1);
});
