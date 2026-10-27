import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  preparePublicChoice,
  type PublicChoiceInput,
  type PublicChoiceSettings,
} from '../src/integrations/agent.ts';

const items = [
  {
    id: 'public-book-a',
    title: 'An Ordinary Day',
    creator: 'A. Writer',
    description: 'Short essays that notice the small pleasures of an ordinary day.',
    price: 2000,
    format: 'hardback' as const,
  },
  {
    id: 'public-book-b',
    title: 'Forest Notes',
    creator: 'B. Writer',
    description: 'An accessible exploration of forests and the relationships between trees.',
    price: 1800,
    format: 'hardback' as const,
  },
];
const input: PublicChoiceInput = {
  purpose: 'gift',
  targetType: 'book',
  hardConstraints: { maxPrice: 2200, format: 'hardback' },
  items,
  brief: 'A birthday gift for an unhurried afternoon.',
};
const env = { OPENAI_API_KEY: 'test-key-never-sent-to-a-real-provider', MODEL_ID: 'test-model' };
const inspection = {
  fields: ['title', 'description', 'format', 'price'],
  framing: 'thoughtful_gift',
};
const explanations = items.map((item) => ({
  itemId: item.id,
  facts: [{ field: 'description', quote: item.description }],
}));
function response(name: string, args: unknown, output?: unknown[]) {
  return new Response(
    JSON.stringify({
      status: 'completed',
      error: null,
      output: output ?? [
        {
          type: 'function_call',
          call_id: `call_${name}`,
          name,
          arguments: JSON.stringify(args),
          status: 'completed',
        },
      ],
    }),
    { headers: { 'content-type': 'application/json' } },
  );
}
function twoSteps(final: unknown = { explanations }, options: Partial<PublicChoiceSettings> = {}) {
  const requests: { url: string; init: RequestInit; body: Record<string, unknown> }[] = [];
  const fetch: typeof globalThis.fetch = async (url, init) => {
    assert.ok(init);
    requests.push({ url: String(url), init, body: JSON.parse(String(init.body)) });
    return requests.length === 1
      ? response('inspect_inventory', inspection)
      : response('prepare_choice', final);
  };
  return { requests, settings: { env, fetch, ...options } };
}

test('executes exactly two constrained tools over public facts and preserves Qloo order', async () => {
  let authorized = 0;
  const { requests, settings } = twoSteps(undefined, {
    beforeProviderCall: async () => {
      authorized += 1;
    },
  });
  const result = await preparePublicChoice(input, settings);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.explanations,
    items.map((item) => ({
      itemId: item.id,
      text: `A detail for a thoughtful gift: “${item.description}”`,
    })),
  );
  assert.equal(authorized, 2);
  assert.equal(requests.length, 2);
  assert.equal(result.receipt.requestCount, 2);
  assert.equal(result.receipt.toolSteps, 2);
  assert.equal(result.receipt.groundedFactCount, 2);
  assert.deepEqual(result.receipt.checkpoints, [
    'inspecting_inventory',
    'inventory_checked',
    'preparing_choice',
    'choice_prepared',
  ]);
  for (const [index, request] of requests.entries()) {
    assert.equal(request.url, 'https://api.openai.com/v1/responses');
    assert.equal(request.init.redirect, 'error');
    assert.equal(request.init.cache, 'no-store');
    assert.ok(request.init.signal);
    assert.equal(request.body.model, 'test-model');
    assert.equal(request.body.store, false);
    assert.equal(request.body.parallel_tool_calls, false);
    assert.deepEqual(request.body.tool_choice, {
      type: 'function',
      name: index === 0 ? 'inspect_inventory' : 'prepare_choice',
    });
    const tools = request.body.tools as Record<string, unknown>[];
    assert.equal(tools.length, 1);
    assert.equal(tools[0].strict, true);
    assert.equal(JSON.stringify(request.body).includes(env.OPENAI_API_KEY), false);
  }
  const secondInput = requests[1].body.input as Record<string, unknown>[];
  const toolOutput = secondInput.find((item) => item.type === 'function_call_output');
  assert.equal(toolOutput?.call_id, 'call_inspect_inventory');
  const inventory = JSON.parse(String(toolOutput?.output));
  assert.equal(inventory.constraintsChecked, true);
  assert.equal(inventory.orderMayChange, false);
  assert.deepEqual(
    inventory.rankedInventory.map((item: { itemId: string }) => item.itemId),
    items.map((item) => item.id),
  );
});

test('a whitelist excludes private profile metadata and credentials from both prompts', async () => {
  const secret = 'PRIVATE_OWNER_REFERENCE_NEVER_SERIALIZE';
  const extended = {
    ...input,
    owner: secret,
    contextId: secret,
    signals: [{ entityId: secret, title: secret }],
    items: items.map((item) => ({
      ...item,
      tags: { [secret]: 10 },
      qlooId: secret,
      rawProviderResponse: secret,
    })),
  };
  const { requests, settings } = twoSteps();
  const result = await preparePublicChoice(extended, settings);
  assert.equal(result.ok, true);
  for (const request of requests)
    assert.equal(JSON.stringify(request.body).includes(secret), false);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('selected partial and complete fact spans render without a second free-prose contract', async () => {
  const { requests, settings } = twoSteps({
    explanations: [
      { itemId: items[0].id, facts: [{ field: 'description', quote: 'Short essays' }] },
      {
        itemId: items[1].id,
        facts: [
          { field: 'description', quote: items[1].description },
          { field: 'format', quote: 'hardback' },
        ],
      },
    ],
  });
  const result = await preparePublicChoice(input, settings);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.explanations.map((choice) => choice.itemId),
    items.map((item) => item.id),
  );
  assert.match(result.explanations[0].text, /“Short essays”/);
  assert.ok(result.explanations[1].text.includes(items[1].description));
  assert.match(result.explanations[1].text, /Format: hardback/);
  assert.equal(result.receipt.protocol, 'responses-function-tools-v2');
  const tool = (
    requests[1].body.tools as {
      parameters: { properties: { explanations: { items: { required: string[] } } } };
    }[]
  )[0];
  assert.deepEqual(tool.parameters.properties.explanations.items.required, ['itemId', 'facts']);
});

test('changed authorization before either request propagates its domain error with no extra fetch', async () => {
  for (const stopAt of [1, 2]) {
    let checks = 0;
    const denial = new Error('GRANT_REVOKED');
    const { requests, settings } = twoSteps(undefined, {
      beforeProviderCall: async () => {
        checks += 1;
        if (checks === stopAt) throw denial;
      },
    });
    await assert.rejects(preparePublicChoice(input, settings), (error) => error === denial);
    assert.equal(requests.length, stopAt - 1);
  }
});

test('hard constraints and inventory uniqueness fail before a model call', async () => {
  const { requests, settings } = twoSteps();
  for (const invalid of [
    { ...input, hardConstraints: { maxPrice: 1000 } },
    { ...input, hardConstraints: { format: 'paperback' as const } },
    { ...input, hardConstraints: { maxMinutes: 120 } },
    { ...input, items: input.items.map((item) => ({ ...item, price: undefined })) },
  ]) {
    const result = await preparePublicChoice(invalid, settings);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.errorCode, 'CONSTRAINT_MISMATCH');
  }
  const duplicate = await preparePublicChoice({ ...input, items: [items[0], items[0]] }, settings);
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.errorCode, 'INVALID_INPUT');
  assert.equal(requests.length, 0);
});

test('invented IDs, omitted choices, reordered choices and ungrounded prose fail closed', async () => {
  const invalid = [
    { explanations: [{ ...explanations[0], itemId: 'invented-book' }, explanations[1]] },
    { explanations: [explanations[0]] },
    { explanations: [explanations[1], explanations[0]] },
    {
      explanations: [
        { ...explanations[0], facts: [{ field: 'description', quote: 'A fabricated fact.' }] },
        explanations[1],
      ],
    },
    {
      explanations: [
        { ...explanations[0], text: 'This explanation contains none of its cited public facts.' },
        explanations[1],
      ],
    },
    {
      explanations: [
        {
          ...explanations[0],
          text: `${items[0].description} Your recipient will love it.`,
        },
        explanations[1],
      ],
    },
    {
      explanations: [
        {
          ...explanations[0],
          facts: [{ field: 'creator', quote: 'A. Writer' }],
        },
        explanations[1],
      ],
    },
    {
      explanations: [
        { ...explanations[0], facts: [{ field: 'price', quote: '20' }] },
        explanations[1],
      ],
    },
  ];
  for (const final of invalid) {
    const { requests, settings } = twoSteps(final);
    const result = await preparePublicChoice(input, settings);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.errorCode, 'INVALID_RESPONSE');
    assert.deepEqual(result.explanations, []);
    assert.equal(requests.length, 2);
    assert.equal(result.receipt.toolSteps, 1);
  }
});

test('a model cannot request extra tools or execute multiple tool steps at once', async () => {
  let called = 0;
  const fetch: typeof globalThis.fetch = async () => {
    called += 1;
    return response('inspect_inventory', inspection, [
      {
        type: 'function_call',
        call_id: 'call_allowed',
        name: 'inspect_inventory',
        arguments: JSON.stringify(inspection),
      },
      {
        type: 'function_call',
        call_id: 'call_forbidden',
        name: 'read_profile',
        arguments: '{}',
      },
    ]);
  };
  const result = await preparePublicChoice(input, { env, fetch });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorCode, 'INVALID_RESPONSE');
  assert.equal(called, 1);
  assert.equal(result.receipt.toolSteps, 0);
});

test('provider errors and oversized bodies are redacted, never retried', async () => {
  const secret = 'PRIVATE_PROVIDER_MESSAGE';
  for (const status of [401, 403, 429, 500]) {
    let called = 0;
    const result = await preparePublicChoice(input, {
      env,
      fetch: async () => {
        called += 1;
        return new Response(secret, { status });
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok)
      assert.equal(
        result.errorCode,
        status === 429 ? 'UPSTREAM_LIMIT' : status < 500 ? 'UPSTREAM_AUTH' : 'UPSTREAM_UNAVAILABLE',
      );
    assert.equal(called, 1);
    if (!result.ok) assert.equal(result.receipt.errorCode, result.errorCode);
    assert.equal(result.receipt.failureStage, 'inspection_response');
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
  const oversized = await preparePublicChoice(input, {
    env,
    fetch: async () => new Response(secret, { headers: { 'content-length': String(131073) } }),
  });
  assert.equal(oversized.ok, false);
  if (!oversized.ok) assert.equal(oversized.errorCode, 'INVALID_RESPONSE');
});

test('no configured provider or an already aborted signal never starts HTTP', async () => {
  let called = 0;
  const fetch: typeof globalThis.fetch = async () => {
    called += 1;
    throw new Error('A real provider must never be called by these tests.');
  };
  const missing = await preparePublicChoice(input, { env: {}, fetch });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.errorCode, 'NOT_CONFIGURED');
  const controller = new AbortController();
  controller.abort();
  const aborted = await preparePublicChoice(
    { ...input, signal: controller.signal },
    { env, fetch },
  );
  assert.equal(aborted.ok, false);
  if (!aborted.ok) assert.equal(aborted.errorCode, 'CANCELLED');
  assert.equal(called, 0);
});

test('one total deadline also bounds a transport that ignores its AbortSignal', async () => {
  let called = 0;
  const result = await preparePublicChoice(input, {
    env,
    timeoutMs: 100,
    fetch: async () => {
      called += 1;
      await new Promise((resolve) => setTimeout(resolve, 200));
      return response('inspect_inventory', inspection);
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorCode, 'TIMEOUT');
  assert.equal(called, 1);
  assert.equal(result.receipt.requestCount, 1);
});

test('encrypted reasoning is continued transiently without logging or returning model summaries', async () => {
  const summary = 'MODEL_REASONING_NEVER_RETAIN_IN_RECEIPT';
  const { requests, settings } = twoSteps();
  const baseFetch = settings.fetch;
  const result = await preparePublicChoice(input, {
    ...settings,
    fetch: async (url, init) => {
      const next = await baseFetch(url, init);
      if (requests.length !== 1) return next;
      const raw = await next.json();
      raw.output.unshift({
        id: 'rs_test',
        type: 'reasoning',
        encrypted_content: 'opaque-test-only-encrypted-reasoning',
        summary: [{ type: 'summary_text', text: summary }],
      });
      return new Response(JSON.stringify(raw));
    },
  });
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(requests[1].body).includes(summary), false);
  assert.equal(JSON.stringify(result).includes(summary), false);
  assert.equal(JSON.stringify(result).includes('opaque-test-only-encrypted-reasoning'), false);
});
