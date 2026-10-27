import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  projectReferenceSearch,
  searchQlooReferences,
  type QlooReferenceType,
} from '../src/integrations/qloo-search.ts';

// Synthetic IDs are used only inside mocked contracts, never as real mappings.
const entityId = randomUUID();
const env = { QLOO_API_KEY: 'synthetic-search-key-never-used-live' };
const input = { query: 'Example Novel', type: 'book' as const };
const entity = (type: QlooReferenceType = 'book') => ({
  entity_id: entityId,
  name: 'Example Novel',
  types: ['urn:entity', `urn:entity:${type}`],
});
const json = (value: unknown) => new Response(JSON.stringify(value));

test('search uses the installed harness parameter contract with one authorization and HTTP request', async () => {
  let checks = 0;
  let requests = 0;
  const result = await searchQlooReferences(input, {
    env,
    beforeProviderCall: async () => {
      checks += 1;
    },
    fetch: async (request, init) => {
      requests += 1;
      assert.equal(checks, 1);
      const url = new URL(String(request));
      assert.equal(url.origin, 'https://hackathon.api.qloo.com');
      assert.equal(url.pathname, '/search');
      assert.deepEqual(Object.fromEntries(url.searchParams), {
        query: input.query,
        types: 'urn:entity:book',
        take: '5',
      });
      assert.equal(init?.method, 'GET');
      assert.equal(init.redirect, 'error');
      assert.equal(init.cache, 'no-store');
      assert.ok(init.signal);
      assert.equal(new Headers(init.headers).get('x-api-key'), env.QLOO_API_KEY);
      return json({ success: true, results: [entity()] });
    },
  });
  assert.equal(requests, 1);
  assert.equal(checks, 1);
  assert.deepEqual(result, {
    ok: true,
    status: 'ok',
    candidates: [{ entityId, name: 'Example Novel', type: 'book', subtitle: '' }],
  });
});

test('only public identity differentiators and a clean HTTPS source leave the provider boundary', () => {
  const secret = 'PRIVATE_PROVIDER_METADATA_NEVER_PROJECT';
  const result = projectReferenceSearch(
    {
      success: true,
      warnings: [secret],
      query: { explainability: secret },
      results: {
        entities: [
          {
            ...entity(),
            properties: {
              authors: [{ name: 'A. Writer', profile: secret }, 'B. Writer'],
              publication_year: '2020',
              website: 'https://publisher.example/books/example',
              gender: secret,
              description: secret,
              phone: secret,
            },
            external: { isbn13: [{ id: '9781616207922', privateData: secret }], profile: secret },
          },
        ],
      },
    },
    'book',
  );
  assert.deepEqual(result, {
    ok: true,
    status: 'ok',
    candidates: [
      {
        entityId,
        name: 'Example Novel',
        type: 'book',
        subtitle: 'A. Writer, B. Writer · 2020 · ISBN 9781616207922',
        source: 'https://publisher.example/books/example',
      },
    ],
  });
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('movie, place and public-person metadata are projected from narrow, observed fields', () => {
  const examples: {
    type: QlooReferenceType;
    properties: Record<string, unknown>;
    subtitle: string;
  }[] = [
    {
      type: 'movie',
      properties: { directors: [{ name: 'A. Director' }], release_year: 2023 },
      subtitle: 'A. Director · 2023',
    },
    {
      type: 'place',
      properties: {
        address: {
          street_address: '83 High Street',
          city: 'London',
          postal_code: 'W1',
          phone: 'DO_NOT_EXPOSE',
        },
      },
      subtitle: '83 High Street, London, W1',
    },
    {
      type: 'person',
      properties: { date_of_birth: '1950-05-06', ethnicity: 'DO_NOT_EXPOSE' },
      subtitle: 'Born 1950-05-06',
    },
    {
      type: 'artist',
      properties: { date_of_birth: '1950-05-06', biography: 'DO_NOT_EXPOSE' },
      subtitle: 'Born 1950-05-06',
    },
  ];
  for (const example of examples) {
    const result = projectReferenceSearch(
      { results: [{ ...entity(example.type), properties: example.properties }] },
      example.type,
    );
    assert.equal(result.ok, true);
    if (!result.ok) continue;
    assert.equal(result.candidates[0].subtitle, example.subtitle);
    assert.equal(JSON.stringify(result).includes('DO_NOT_EXPOSE'), false);
  }
});

test('invalid ISBNs, dates, unsafe URLs and arbitrary metadata never become identity hints', () => {
  const book = projectReferenceSearch(
    {
      results: [
        {
          ...entity(),
          properties: {
            publication_year: 'not a year',
            website: 'https://source.example/path?token=private',
            description: 'Do not use a biography as an identity hint.',
          },
          external: { isbn13: [{ id: '9781616207923' }] },
        },
      ],
    },
    'book',
  );
  assert.equal(book.ok, true);
  if (book.ok)
    assert.deepEqual(book.candidates[0], {
      entityId,
      name: 'Example Novel',
      type: 'book',
      subtitle: '',
    });
  for (const birth of ['1950-02-30', '2999-01-01', 'not a date']) {
    const result = projectReferenceSearch(
      {
        results: [
          {
            ...entity('person'),
            properties: { date_of_birth: birth, website: 'javascript:alert(1)' },
          },
        ],
      },
      'person',
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.candidates[0].subtitle, '');
  }
});

test('canonical UUID and explicit matching taxonomy are mandatory, never inferred from the query', () => {
  const result = projectReferenceSearch(
    {
      results: [
        entity(),
        { ...entity(), entity_id: 'unresolved-name' },
        { ...entity('person'), entity_id: randomUUID() },
        { entity_id: randomUUID(), name: 'An untyped match' },
      ],
    },
    'book',
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.status, 'partial');
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].entityId, entityId);
  }
  const duplicate = projectReferenceSearch(
    { results: [entity(), { ...entity(), entity_id: entityId.toUpperCase() }] },
    'book',
  );
  assert.deepEqual(duplicate, { ok: false, errorCode: 'INVALID_RESPONSE' });
  const untyped = projectReferenceSearch(
    { results: [{ entity_id: entityId, name: 'A perfect name match' }] },
    'book',
  );
  assert.deepEqual(untyped, { ok: false, errorCode: 'INVALID_RESPONSE' });
});

test('at most five candidates are returned and malformed result containers fail closed', () => {
  const many = projectReferenceSearch(
    { results: Array.from({ length: 6 }, () => ({ ...entity(), entity_id: randomUUID() })) },
    'book',
  );
  assert.equal(many.ok, true);
  if (many.ok) {
    assert.equal(many.status, 'partial');
    assert.equal(many.candidates.length, 5);
  }
  assert.deepEqual(projectReferenceSearch({ results: [] }, 'book'), {
    ok: true,
    status: 'empty',
    candidates: [],
  });
  for (const raw of [
    null,
    {},
    { success: false, results: [] },
    { results: { entities: 'invalid' } },
    { error: 'private message', results: [] },
  ]) {
    assert.deepEqual(projectReferenceSearch(raw, 'book'), {
      ok: false,
      errorCode: 'INVALID_RESPONSE',
    });
  }
});

test('authorization and budget callback failures propagate without HTTP or retries', async () => {
  const denial = new Error('SEARCH_BUDGET_EXHAUSTED');
  let requests = 0;
  await assert.rejects(
    searchQlooReferences(input, {
      env,
      beforeProviderCall: async () => {
        throw denial;
      },
      fetch: async () => {
        requests += 1;
        return json({ results: [] });
      },
    }),
    (error) => error === denial,
  );
  assert.equal(requests, 0);
});

test('provider failures are redacted, 404 means no results, and no path retries a request', async () => {
  const secret = 'PRIVATE_PROVIDER_FAILURE';
  for (const status of [401, 403, 404, 429, 500]) {
    let requests = 0;
    const result = await searchQlooReferences(input, {
      env,
      fetch: async () => {
        requests += 1;
        return new Response(secret, { status });
      },
    });
    assert.equal(requests, 1);
    assert.equal(JSON.stringify(result).includes(secret), false);
    if (status === 404) assert.deepEqual(result, { ok: true, status: 'empty', candidates: [] });
    else
      assert.deepEqual(result, {
        ok: false,
        errorCode:
          status === 429
            ? 'UPSTREAM_LIMIT'
            : status === 500
              ? 'UPSTREAM_UNAVAILABLE'
              : 'UPSTREAM_AUTH',
      });
  }
});

test('invalid configuration, absent keys and pre-cancelled requests do not start HTTP', async () => {
  let requests = 0;
  const fetch: typeof globalThis.fetch = async () => {
    requests += 1;
    return json({ results: [] });
  };
  assert.deepEqual(await searchQlooReferences(input, { env: {}, fetch }), {
    ok: false,
    errorCode: 'NOT_CONFIGURED',
  });
  assert.deepEqual(
    await searchQlooReferences(input, {
      env: { ...env, QLOO_BASE_URL: 'https://untrusted.invalid' },
      fetch,
    }),
    { ok: false, errorCode: 'INVALID_INPUT' },
  );
  assert.deepEqual(await searchQlooReferences({ ...input, query: ' ' }, { env, fetch }), {
    ok: false,
    errorCode: 'INVALID_INPUT',
  });
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(
    await searchQlooReferences({ ...input, signal: controller.signal }, { env, fetch }),
    { ok: false, errorCode: 'CANCELLED' },
  );
  assert.equal(requests, 0);
});

test('search has one total deadline and rejects oversized response bodies', async () => {
  const oversized = await searchQlooReferences(input, {
    env,
    fetch: async () => new Response('{}', { headers: { 'content-length': '1048577' } }),
  });
  assert.deepEqual(oversized, { ok: false, errorCode: 'INVALID_RESPONSE' });
  const timeout = await searchQlooReferences(input, {
    env,
    timeoutMs: 100,
    fetch: async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return json({ results: [] });
    },
  });
  assert.deepEqual(timeout, { ok: false, errorCode: 'TIMEOUT' });
});
