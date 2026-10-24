import assert from 'node:assert/strict';
import { createServer, request, type Server, type IncomingHttpHeaders } from 'node:http';
import test, { type TestContext } from 'node:test';
import {
  createClientServer,
  readClientConfig,
  type ClientConfig,
  type ClientId,
} from '../clients/server.ts';

const credential = 'synthetic-gateway-credential-never-for-browser';
const renewedCredential = 'synthetic-renewed-credential-never-for-browser';
const invitation = 'synthetic-one-time-invitation-token';
const privateSentinel = 'PRIVATE_REFERENCE_SENTINEL';

function sampleView(clientId: ClientId, expiresAt = new Date(Date.now() + 300_000).toISOString()) {
  const type = { books: 'book', media: 'movie', places: 'place' }[clientId];
  return {
    credentialExpiresAt: expiresAt,
    grant: {
      id: 'grant-example',
      contextId: 'context-example',
      contextName: 'Gift',
      purpose: 'gift',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      remainingRequests: 12,
      snapshotId: 'snapshot-example',
      fields: ['id', 'title', 'description', 'creator', 'url', 'price'],
      version: 1,
    },
    catalog: {
      id: clientId + '-example',
      snapshotId: 'snapshot-example',
      type,
      source: 'Authored public source facts',
      retrievedAt: new Date().toISOString(),
      availabilityNotice: 'Illustrative prices. No availability is verified.',
      items: ['a', 'b', 'c'].map((id) => ({
        id: 'item-' + id,
        title: 'Public item ' + id,
        creator: 'Public creator',
        description: 'Public description',
        url: 'https://example.com/' + id,
        price: 2000,
        art: 'botanical',
        ...(type === 'book'
          ? { format: 'paperback' }
          : type === 'movie'
            ? { minutes: 110 }
            : { setting: 'outdoors' }),
      })),
    },
    delegate: { displayName: 'Alex (demo)' },
    mode: 'authored_sample',
    selections: [],
    privateReferences: [privateSentinel],
  };
}

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No TCP address');
  return address.port;
}
async function close(server: Server) {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

type BrowserResponse = {
  status: number;
  text: string;
  value: Record<string, unknown>;
  headers: IncomingHttpHeaders;
};
function browserRequest(
  port: number,
  publicOrigin: string,
  path: string,
  options: {
    method?: string;
    payload?: unknown;
    cookie?: string;
    origin?: string;
    host?: string;
  } = {},
): Promise<BrowserResponse> {
  const serialized = options.payload === undefined ? undefined : JSON.stringify(options.payload);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: options.method || 'GET',
        headers: {
          host: options.host || new URL(publicOrigin).host,
          ...(options.method === 'POST' ? { origin: options.origin || publicOrigin } : {}),
          ...(serialized
            ? {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(serialized),
              }
            : {}),
          ...(options.cookie ? { cookie: options.cookie } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let value: Record<string, unknown> = {};
          try {
            value = JSON.parse(text);
          } catch {
            /* HTML and static resources intentionally are not JSON. */
          }
          resolve({ status: res.statusCode!, text, value, headers: res.headers });
        });
      },
    );
    req.on('error', reject);
    req.end(serialized);
  });
}

async function fixture(
  t: TestContext,
  options: { clientId?: ClientId; earlyExpiry?: boolean } = {},
) {
  const clientId = options.clientId || 'books';
  const state = {
    revoked: false,
    qlooUnavailable: false,
    renewed: false,
    queueState: 'queued' as 'queued' | 'released',
    received: [] as { path: string; headers: IncomingHttpHeaders; body: Record<string, unknown> }[],
    selections: [] as { runId: string; itemId: string; title: string; savedAt: string }[],
  };
  const gateway = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const payload = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    const path = req.url || '/';
    state.received.push({ path, headers: req.headers, body: payload });
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (state.revoked && path !== '/v1/invitations/claim')
      return send(403, { error: { code: 'GRANT_REVOKED', message: 'This connection has ended.' } });
    const view = {
      ...sampleView(
        clientId,
        new Date(
          Date.now() + (options.earlyExpiry && !state.renewed ? 30_000 : 300_000),
        ).toISOString(),
      ),
      selections: state.selections,
    };
    if (path === '/v1/invitations/claim') return send(200, { ...view, credential });
    if (path === '/v1/credentials/renew') {
      state.renewed = true;
      return send(200, {
        credential: renewedCredential,
        credentialExpiresAt: new Date(Date.now() + 300_000).toISOString(),
      });
    }
    if (path === '/v1/session')
      return send(200, { ...view, credential: 'extra-field-must-be-stripped' });
    if (path === '/v1/decisions') {
      if (payload.mode === 'qloo' && state.qlooUnavailable)
        return send(503, {
          error: { code: 'UPSTREAM_UNAVAILABLE', message: 'No Qloo key is configured.' },
        });
      return send(202, {
        id: 'run-example',
        state: state.queueState,
        replayed: state.queueState === 'released',
        privateReferences: [privateSentinel],
      });
    }
    if (path === '/v1/decisions/run-example')
      return send(200, {
        id: 'run-example',
        state: 'released',
        items: [view.catalog.items[2], view.catalog.items[0]],
        provenance: {
          mode: 'authored_sample',
          label: 'Authored sample; no Qloo call.',
          status: 'ok',
          candidateCount: 3,
          selectedCount: 2,
          privateReferences: [privateSentinel],
        },
        receipt: {
          id: 'receipt-example',
          grantVersion: 1,
          contextRevision: 1,
          authorizedAt: new Date().toISOString(),
          fields: ['id', 'title', 'creator', 'description', 'url', 'price'],
        },
        stale: false,
        privateReferences: [privateSentinel],
      });
    if (path === '/v1/decisions/run-example/selection') {
      const selection = {
        runId: 'run-example',
        itemId: String(payload.itemId),
        title: 'Public item c',
        savedAt: new Date().toISOString(),
      };
      state.selections.push(selection);
      return send(200, { saved: true, ...selection });
    }
    return send(404, { error: { code: 'NOT_FOUND', message: 'Unknown route' } });
  });
  const gatewayPort = await listen(gateway);
  const config: ClientConfig = {
    clientId,
    port: 0,
    host: '127.0.0.1',
    clientSecret: 'synthetic-separate-client-secret',
    sessionSecret: 'synthetic-separate-cookie-secret-at-least-32',
    gatewayOrigin: `http://127.0.0.1:${gatewayPort}`,
    ownerOrigin: 'http://127.0.0.1:3104',
    publicOrigin: `http://${clientId}.localhost:3114`,
  };
  const client = createClientServer(config);
  const port = await listen(client);
  config.publicOrigin = `http://${clientId}.localhost:${port}`;
  t.after(async () => {
    await close(client);
    await close(gateway);
  });
  const call = (path: string, init?: Parameters<typeof browserRequest>[3]) =>
    browserRequest(port, config.publicOrigin, path, init);
  async function claim() {
    const response = await call('/api/claim', { method: 'POST', payload: { token: invitation } });
    assert.equal(response.status, 200);
    const setCookie = response.headers['set-cookie']?.[0];
    assert.ok(setCookie);
    return { response, cookie: setCookie.split(';')[0]! };
  }
  return { state, call, claim, config, client, port };
}

test('client configuration requires real server secrets and gives each app a separate browser host', () => {
  assert.throws(() => readClientConfig({ CLIENT_ID: 'books' }));
  assert.throws(() =>
    readClientConfig({
      CLIENT_ID: 'books',
      CLIENT_SECRET: 'too-short',
      SESSION_SECRET: 'also-short',
    }),
  );
  assert.throws(() =>
    readClientConfig({
      CLIENT_ID: 'books',
      CLIENT_SECRET: 'synthetic-client-secret',
      SESSION_SECRET: 'synthetic-session-secret-at-least-32-characters',
      PUBLIC_ORIGIN: 'http://127.0.0.1:3114',
    }),
  );
  for (const clientId of ['books', 'media', 'places'] as const) {
    const config = readClientConfig({
      CLIENT_ID: clientId,
      CLIENT_SECRET: 'synthetic-client-secret',
      SESSION_SECRET: 'synthetic-session-secret-at-least-32-characters',
    });
    assert.equal(new URL(config.publicOrigin).hostname, `${clientId}.localhost`);
    assert.notEqual(new URL(config.publicOrigin).hostname, new URL(config.ownerOrigin).hostname);
  }
});

test('claim stores credentials only server-side, strips unknown private fields, and uses an opaque host-only cookie', async (t) => {
  const f = await fixture(t);
  const page = await f.call('/claim');
  assert.equal(page.status, 200);
  assert.match(page.text, /The Reading Room/);
  assert.match(page.text, /Isolated role-play demo/);
  assert.doesNotMatch(page.text, /synthetic-/);
  assert.match(String(page.headers['content-security-policy']), /connect-src 'self'/);
  const { response, cookie } = await f.claim();
  assert.doesNotMatch(
    response.text,
    new RegExp(credential + '|' + invitation + '|' + privateSentinel + '|client-secret'),
  );
  assert.match(response.headers['set-cookie']![0]!, /HttpOnly; Path=\/; SameSite=Lax/);
  assert.doesNotMatch(response.headers['set-cookie']![0]!, /Domain=/);
  assert.doesNotMatch(cookie, /synthetic/);
  assert.equal(f.state.received[0]!.headers['x-client-id'], 'books');
  assert.equal(f.state.received[0]!.headers['x-client-secret'], f.config.clientSecret);
  assert.equal(f.state.received[0]!.headers.authorization, undefined);
  const session = await f.call('/api/session', { cookie });
  assert.equal(session.status, 200);
  assert.doesNotMatch(
    session.text,
    /extra-field-must-be-stripped|PRIVATE_REFERENCE_SENTINEL|synthetic-gateway/,
  );
  assert.equal(f.state.received.at(-1)!.headers.authorization, `Bearer ${credential}`);
  assert.equal(session.headers['cache-control'], 'private, no-store');
});

test('client builds the exact scoped gateway request and preserves returned order, then saves through the gateway', async (t) => {
  const f = await fixture(t);
  const { cookie } = await f.claim();
  const queued = await f.call('/api/decisions', {
    method: 'POST',
    cookie,
    payload: {
      hardConstraints: { maxPrice: 2500, format: 'paperback' },
      mode: 'sample',
      idempotencyKey: '6876a458-a840-4c03-9e57-130b56ae3291',
    },
  });
  assert.equal(queued.status, 202);
  const forwarded = f.state.received.at(-1)!.body;
  assert.deepEqual(forwarded.candidateIds, ['item-a', 'item-b', 'item-c']);
  assert.equal(forwarded.grantId, 'grant-example');
  assert.equal(forwarded.contextId, 'context-example');
  assert.equal(forwarded.snapshotId, 'snapshot-example');
  assert.equal(forwarded.targetType, 'book');
  assert.equal(forwarded.operation, 'rank');
  assert.deepEqual(forwarded.hardConstraints, { maxPrice: 2500, format: 'paperback' });
  const result = await f.call('/api/decisions/run-example', { cookie });
  assert.equal(result.status, 200);
  assert.deepEqual(
    (result.value.items as { id: string }[]).map((item) => item.id),
    ['item-c', 'item-a'],
  );
  assert.doesNotMatch(result.text, /PRIVATE_REFERENCE_SENTINEL|"art"|"format"/);
  const saved = await f.call('/api/decisions/run-example/selection', {
    method: 'POST',
    cookie,
    payload: { itemId: 'item-c' },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.value.saved, true);
  assert.deepEqual(f.state.received.at(-1)!.body, { itemId: 'item-c' });
  const session = await f.call('/api/session', { cookie });
  assert.equal((session.value.selections as unknown[]).length, 1);
  assert.deepEqual(session.value.brief, {
    hardConstraints: { maxPrice: 2500, format: 'paperback' },
    mode: 'sample',
  });
});

test('revoked access is checked for session, stored result, and selection; client never releases its old result cache', async (t) => {
  const f = await fixture(t);
  const { cookie } = await f.claim();
  await f.call('/api/decisions', {
    method: 'POST',
    cookie,
    payload: { hardConstraints: {}, mode: 'sample' },
  });
  assert.equal((await f.call('/api/decisions/run-example', { cookie })).status, 200);
  f.state.revoked = true;
  for (const path of ['/api/session', '/api/decisions/run-example']) {
    const denied = await f.call(path, { cookie });
    assert.equal(denied.status, 403);
    assert.equal((denied.value.error as { code: string }).code, 'GRANT_REVOKED');
    assert.doesNotMatch(denied.text, /Public item/);
  }
  const deniedSave = await f.call('/api/decisions/run-example/selection', {
    method: 'POST',
    cookie,
    payload: { itemId: 'item-c' },
  });
  assert.equal(deniedSave.status, 403);
  assert.equal(f.state.selections.length, 0);
});

test('wrong host, cross-origin POST, session crossover, and extra scope fields fail closed', async (t) => {
  const f = await fixture(t);
  const { cookie } = await f.claim();
  const count = f.state.received.length;
  assert.equal((await f.call('/', { host: `127.0.0.1:${f.port}` })).status, 403);
  assert.equal(
    (
      await f.call('/api/claim', {
        method: 'POST',
        origin: 'http://media.localhost:3115',
        payload: { token: invitation },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call('/api/decisions', {
        method: 'POST',
        cookie,
        payload: { hardConstraints: {}, mode: 'sample', contextId: 'attacker-context' },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call('/api/decisions', {
        method: 'POST',
        cookie,
        payload: { hardConstraints: { contextId: 'attacker-context' }, mode: 'sample' },
      })
    ).status,
    400,
  );
  assert.equal((await f.call('/api/decisions/uncreated-run', { cookie })).status, 404);
  assert.equal(f.state.received.length, count);
  const media = await fixture(t, { clientId: 'media' });
  assert.equal((await media.call('/api/session', { cookie })).status, 401);
  assert.equal(
    (
      await media.call('/api/session', {
        cookie: cookie.replace('tastekeeper_books_', 'tastekeeper_media_'),
      })
    ).status,
    401,
  );
  assert.equal(media.state.received.length, 0);
});

test('near-expiry gateway credentials are renewed on the server and live mode keeps its real unavailable error', async (t) => {
  const f = await fixture(t, { earlyExpiry: true });
  const { cookie } = await f.claim();
  const session = await f.call('/api/session', { cookie });
  assert.equal(session.status, 200);
  assert.equal(f.state.received[1]!.path, '/v1/credentials/renew');
  assert.equal(f.state.received[1]!.headers.authorization, `Bearer ${credential}`);
  assert.equal(f.state.received[2]!.headers.authorization, `Bearer ${renewedCredential}`);
  assert.doesNotMatch(session.text, /synthetic-renewed/);
  f.state.qlooUnavailable = true;
  const unavailable = await f.call('/api/decisions', {
    method: 'POST',
    cookie,
    payload: { hardConstraints: {}, mode: 'qloo' },
  });
  assert.equal(unavailable.status, 503);
  assert.equal((unavailable.value.error as { code: string }).code, 'UPSTREAM_UNAVAILABLE');
  assert.equal(f.state.received.at(-1)!.body.mode, 'qloo');
});

test('idempotent gateway replay may return a released run without exposing unknown fields or rewriting state', async (t) => {
  const f = await fixture(t);
  const { cookie } = await f.claim();
  const payload = {
    hardConstraints: {},
    mode: 'sample',
    idempotencyKey: '2d489fcb-0a54-4af8-bf2c-dc653ae5cf72',
  };
  const queued = await f.call('/api/decisions', { method: 'POST', cookie, payload });
  assert.equal(queued.value.state, 'queued');
  f.state.queueState = 'released';
  const replayed = await f.call('/api/decisions', { method: 'POST', cookie, payload });
  assert.equal(replayed.status, 202);
  assert.equal(replayed.value.state, 'released');
  assert.equal(replayed.value.replayed, true);
  assert.doesNotMatch(replayed.text, /PRIVATE_REFERENCE_SENTINEL/);
  assert.equal((await f.call('/api/decisions/run-example', { cookie })).status, 200);
});
