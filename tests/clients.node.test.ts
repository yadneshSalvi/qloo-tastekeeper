import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer, request, type Server, type IncomingHttpHeaders } from 'node:http';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createClientServer,
  readClientConfig,
  type ClientConfig,
  type ClientId,
} from '../clients/server.ts';

const credential = 'synthetic-gateway-credential-never-for-browser';
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
  if (!server.listening) return;
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
    req.setTimeout(3000, () => req.destroy(new Error('The test HTTP request timed out.')));
    req.end(serialized);
  });
}

async function startClientProcess(config: ClientConfig, port: number): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'clients/server.ts'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    // Only synthetic fixture credentials reach the subprocess. In particular,
    // never inherit a developer's provider or database environment variables.
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'test',
      CLIENT_ID: config.clientId,
      CLIENT_HOST: config.host,
      PORT: String(port),
      CLIENT_SECRET: config.clientSecret,
      SESSION_SECRET: config.sessionSecret,
      GATEWAY_ORIGIN: config.gatewayOrigin,
      OWNER_ORIGIN: config.ownerOrigin,
      PUBLIC_ORIGIN: config.publicOrigin,
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  let failed = false;
  child.on('error', () => {
    failed = true;
  });
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (failed || child.exitCode !== null || child.signalCode !== null) break;
    try {
      if ((await browserRequest(port, config.publicOrigin, '/health')).status === 200) return child;
    } catch {
      // The process has not bound its port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await stopClientProcess(child);
  throw new Error('The reference client test process did not become ready.');
}
async function stopClientProcess(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => child.kill('SIGKILL'), 1500);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill('SIGTERM');
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
    sessionTokens: new Set<string>(),
    runIds: [] as string[],
    latestRunId: undefined as string | undefined,
    brief: undefined as
      | {
          hardConstraints: Record<string, string | number>;
          mode: 'sample' | 'qloo';
          brief?: { occasion: string; note?: string };
        }
      | undefined,
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
    if (state.revoked && path !== '/v1/browser-sessions/claim')
      return send(403, { error: { code: 'GRANT_REVOKED', message: 'This connection has ended.' } });
    if (path !== '/v1/browser-sessions/claim') {
      const token = req.headers['x-client-session'];
      if (typeof token !== 'string' || !state.sessionTokens.has(token))
        return send(401, { error: { code: 'TOKEN_EXPIRED', message: 'This session has ended.' } });
    }
    const view = {
      ...sampleView(
        clientId,
        new Date(Date.now() + (options.earlyExpiry ? 30_000 : 300_000)).toISOString(),
      ),
      selections: state.selections,
      runIds: state.runIds,
      ...(state.latestRunId ? { latestRunId: state.latestRunId } : {}),
      ...(state.brief ? { brief: state.brief } : {}),
    };
    if (path === '/v1/browser-sessions/claim') {
      const sessionToken = randomBytes(32).toString('base64url');
      state.sessionTokens.add(sessionToken);
      return send(200, { ...view, sessionToken, credential });
    }
    if (path === '/v1/session')
      return send(200, { ...view, credential: 'extra-field-must-be-stripped' });
    if (path === '/v1/decisions') {
      if (payload.mode === 'qloo' && state.qlooUnavailable)
        return send(503, {
          error: { code: 'UPSTREAM_UNAVAILABLE', message: 'No Qloo key is configured.' },
        });
      if (!state.runIds.includes('run-example')) state.runIds.push('run-example');
      state.latestRunId = 'run-example';
      state.brief = {
        hardConstraints: payload.hardConstraints as Record<string, string | number>,
        mode: payload.mode as 'sample' | 'qloo',
        ...(payload.brief ? { brief: payload.brief as { occasion: string; note?: string } } : {}),
      };
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
          ...(state.brief?.mode === 'qloo'
            ? {
                mode: 'qloo',
                label: 'Synthetic Qloo fixture; no provider request.',
                status: 'partial',
                mappedCount: 3,
                returnedCount: 2,
                unmappedCount: 0,
                agent: { enabled: true, status: 'complete', label: 'Synthetic completed tools' },
              }
            : { mode: 'authored_sample', label: 'Authored sample; no Qloo call.', status: 'ok' }),
          candidateCount: 3,
          selectedCount: 2,
          privateReferences: [privateSentinel],
        },
        qlooEvidence: {
          transport: 'synthetic',
          requestCount: 1,
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
    if (path === '/v1/browser-sessions/disconnect') {
      state.sessionTokens.delete(String(req.headers['x-client-session']));
      return send(200, { disconnected: true });
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

test('claim uses a durable opaque gateway handle, strips private fields, and sets a signed host-only cookie', async (t) => {
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
  assert.equal(f.state.received[0]!.path, '/v1/browser-sessions/claim');
  assert.equal(f.state.received[0]!.headers.authorization, undefined);
  assert.equal(f.state.received[0]!.headers['x-client-session'], undefined);
  const sessionToken = [...f.state.sessionTokens][0]!;
  assert.match(sessionToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(response.text.includes(sessionToken), false);
  const session = await f.call('/api/session', { cookie });
  assert.equal(session.status, 200);
  assert.doesNotMatch(
    session.text,
    /extra-field-must-be-stripped|PRIVATE_REFERENCE_SENTINEL|synthetic-gateway/,
  );
  assert.equal(f.state.received.at(-1)!.path, '/v1/session');
  assert.equal(f.state.received.at(-1)!.headers.authorization, undefined);
  assert.equal(f.state.received.at(-1)!.headers['x-client-session'], sessionToken);
  assert.equal(session.value.runIds, undefined);
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
      brief: { occasion: 'birthday', note: 'Something for a quiet afternoon.' },
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
  assert.deepEqual(forwarded.brief, {
    occasion: 'birthday',
    note: 'Something for a quiet afternoon.',
  });
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
    brief: { occasion: 'birthday', note: 'Something for a quiet afternoon.' },
  });
  assert.equal(session.value.latestRunId, 'run-example');
  assert.deepEqual(f.state.runIds, ['run-example']);
  await f.call('/api/decisions', {
    method: 'POST',
    cookie,
    payload: { hardConstraints: {}, mode: 'qloo' },
  });
  const coverage = await f.call('/api/decisions/run-example', { cookie });
  assert.equal(coverage.status, 200);
  assert.deepEqual(coverage.value.provenance, {
    mode: 'qloo',
    label: 'Synthetic Qloo fixture; no provider request.',
    status: 'partial',
    candidateCount: 3,
    selectedCount: 2,
    mappedCount: 3,
    returnedCount: 2,
    unmappedCount: 0,
    agent: { enabled: true, status: 'complete', label: 'Synthetic completed tools' },
  });
  assert.doesNotMatch(coverage.text, /qlooEvidence|PRIVATE_REFERENCE_SENTINEL/);
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
  assert.deepEqual(
    f.state.received.slice(count).map((entry) => entry.path),
    ['/v1/session', '/v1/session', '/v1/session'],
  );
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

test('the opaque session delegates credential lifetime to the gateway and preserves live provider errors', async (t) => {
  const f = await fixture(t, { earlyExpiry: true });
  const { cookie } = await f.claim();
  const session = await f.call('/api/session', { cookie });
  assert.equal(session.status, 200);
  assert.equal(f.state.received[1]!.path, '/v1/session');
  assert.equal(f.state.received[1]!.headers.authorization, undefined);
  assert.equal(f.state.received[1]!.headers['x-client-session'], [...f.state.sessionTokens][0]);
  assert.equal(
    f.state.received.some((entry) => entry.path === '/v1/credentials/renew'),
    false,
  );
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
  assert.ok(f.state.received.every((entry) => entry.headers.authorization === undefined));
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

test(
  'the same cookie restores brief, saved choices and run access across separate client processes',
  { timeout: 20_000 },
  async (t) => {
    const f = await fixture(t);
    await close(f.client);
    let child = await startClientProcess(f.config, f.port);
    t.after(async () => stopClientProcess(child));
    const firstPid = child.pid;
    const { cookie } = await f.claim();
    const persistedBrief = {
      hardConstraints: { maxPrice: 2400, format: 'paperback' },
      mode: 'sample',
      brief: { occasion: 'thank_you', note: 'A small thank-you for a generous host.' },
    };
    const queued = await f.call('/api/decisions', {
      method: 'POST',
      cookie,
      payload: persistedBrief,
    });
    assert.equal(queued.status, 202);
    assert.equal(
      (
        await f.call('/api/decisions/run-example/selection', {
          method: 'POST',
          cookie,
          payload: { itemId: 'item-c' },
        })
      ).status,
      200,
    );
    await stopClientProcess(child);
    child = await startClientProcess(f.config, f.port);
    assert.notEqual(child.pid, firstPid);

    const recovered = await f.call('/api/session', { cookie });
    assert.equal(recovered.status, 200);
    assert.deepEqual(recovered.value.brief, persistedBrief);
    assert.equal(recovered.value.latestRunId, 'run-example');
    assert.equal((recovered.value.selections as unknown[]).length, 1);
    assert.equal(recovered.headers['set-cookie'], undefined);
    const result = await f.call('/api/decisions/run-example', { cookie });
    assert.equal(result.status, 200);
    assert.deepEqual(
      (result.value.items as { id: string }[]).map((item) => item.id),
      ['item-c', 'item-a'],
    );
    assert.equal(
      f.state.received.filter((entry) => entry.path === '/v1/browser-sessions/claim').length,
      1,
    );
    assert.ok(f.state.received.every((entry) => entry.headers.authorization === undefined));

    // Every request must rehydrate authoritative membership, including on an
    // already-running replacement process that previously fetched the result.
    f.state.runIds = [];
    const before = f.state.received.length;
    const removed = await f.call('/api/decisions/run-example', { cookie });
    assert.equal(removed.status, 404);
    assert.equal((removed.value.error as { code: string }).code, 'DECISION_NOT_FOUND');
    assert.deepEqual(
      f.state.received.slice(before).map((entry) => entry.path),
      ['/v1/session'],
    );
    assert.doesNotMatch(removed.text, /Public item/);
  },
);

test('disconnect invalidates the durable gateway handle before clearing the browser cookie', async (t) => {
  const f = await fixture(t);
  const { cookie } = await f.claim();
  const result = await f.call('/api/disconnect', { method: 'POST', cookie, payload: {} });
  assert.equal(result.status, 200);
  assert.equal(result.value.disconnected, true);
  assert.equal(f.state.received.at(-1)!.path, '/v1/browser-sessions/disconnect');
  assert.match(result.headers['set-cookie']![0]!, /Max-Age=0/);
  assert.equal(f.state.sessionTokens.size, 0);
  // Replaying the original signed cookie still has to pass the gateway.
  const replayed = await f.call('/api/session', { cookie });
  assert.equal(replayed.status, 401);
  assert.equal((replayed.value.error as { code: string }).code, 'TOKEN_EXPIRED');
});
