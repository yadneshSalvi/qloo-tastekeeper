import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request, type IncomingHttpHeaders, type Server } from 'node:http';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClientServer, type ClientConfig, type ClientId } from '../clients/server.ts';

type Response = { status: number; headers: IncomingHttpHeaders; body: Buffer };
function get(port: number, origin: string, path: string, method = 'GET'): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        agent: false,
        headers: { host: new URL(origin).host },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () =>
          resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }),
        );
      },
    );
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('The isolated asset test timed out.')));
    req.end();
  });
}

async function listen(clientId: ClientId, factory = createClientServer) {
  // Static routes need no gateway or provider. The unreachable loopback gateway
  // also prevents these tests from accessing any live workspace or paid service.
  const config: ClientConfig = {
    clientId,
    port: 0,
    host: '127.0.0.1',
    clientSecret: 'synthetic-client-assets-fixture-secret',
    sessionSecret: 'synthetic-client-assets-fixture-session-secret',
    publicOrigin: `http://${clientId}.assets.localhost`,
    ownerOrigin: 'https://owner.example.test',
    gatewayOrigin: 'http://127.0.0.1:1',
  };
  const server = factory(config);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  return { server, config, port: address.port };
}
async function close(server: Server) {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
function assetUrls(page: Response, origin: string) {
  assert.equal(page.status, 200);
  assert.equal(page.headers['cache-control'], 'private, no-store');
  const html = page.body.toString('utf8');
  const script = html.match(/<script src="([^"]+)" defer/);
  const stylesheet = html.match(/<link rel="stylesheet" href="([^"]+)"/);
  assert(script && stylesheet, 'The page must load its external script and stylesheet.');
  return { script: new URL(script[1], origin), stylesheet: new URL(stylesheet[1], origin) };
}
async function checkAsset(port: number, origin: string, url: URL, path: string) {
  assert.equal(url.origin, origin);
  assert.equal(url.pathname, path);
  assert.deepEqual([...url.searchParams.keys()], ['v']);
  assert.match(url.searchParams.get('v') ?? '', /^[a-f0-9]{64}$/);
  const response = await get(port, origin, url.pathname + url.search);
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'public, max-age=3600');
  assert.equal(
    url.searchParams.get('v'),
    createHash('sha256').update(response.body).digest('hex'),
    'The version must identify the exact served bytes.',
  );
  return response;
}

for (const clientId of ['books', 'media', 'places'] as const) {
  test(`${clientId}: fresh HTML uses content-versioned same-origin JS and CSS`, async (t) => {
    const { server, config, port } = await listen(clientId);
    t.after(() => close(server));
    const page = await get(port, config.publicOrigin, '/');
    const urls = assetUrls(page, config.publicOrigin);
    const script = await checkAsset(port, config.publicOrigin, urls.script, '/client.js');
    const stylesheet = await checkAsset(port, config.publicOrigin, urls.stylesheet, '/styles.css');
    assert.match(String(script.headers['content-type']), /^application\/javascript/);
    assert.match(String(stylesheet.headers['content-type']), /^text\/css/);
    const policy = String(page.headers['content-security-policy']);
    assert(policy.includes("script-src 'self'"));
    assert(policy.includes("style-src 'self'"));
    assert(policy.includes("connect-src 'self'"));
    assert.equal(page.headers['referrer-policy'], 'no-referrer');
    assert.equal(page.headers['cross-origin-resource-policy'], 'same-origin');
    assert(!page.body.includes(Buffer.from(config.clientSecret)));
    assert(!page.body.includes(Buffer.from(config.sessionSecret)));
    const claim = assetUrls(await get(port, config.publicOrigin, '/claim'), config.publicOrigin);
    assert.equal(claim.script.href, urls.script.href);
    assert.equal(claim.stylesheet.href, urls.stylesheet.href);
    const head = await get(
      port,
      config.publicOrigin,
      urls.script.pathname + urls.script.search,
      'HEAD',
    );
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
  });
}

test('a new client deployment changes asset URLs while each running server hashes its own served bytes', async (t) => {
  // Copy only public client source into an isolated fixture. Never edit the live
  // workspace assets or restart an existing application process for this test.
  const artifactRoot = fileURLToPath(new URL('../.artifacts/', import.meta.url));
  await mkdir(artifactRoot, { recursive: true });
  const fixture = await mkdtemp(join(artifactRoot, 'client-assets-'));
  const clients = join(fixture, 'clients');
  const servers: Server[] = [];
  t.after(async () => {
    await Promise.all(servers.map(close));
    await rm(fixture, { recursive: true, force: true });
  });
  await mkdir(clients);
  await Promise.all(
    ['server.ts', 'view.ts', 'client.js', 'styles.css'].map((name) =>
      copyFile(new URL(`../clients/${name}`, import.meta.url), join(clients, name)),
    ),
  );
  const isolated = (await import(
    pathToFileURL(join(clients, 'server.ts')).href
  )) as typeof import('../clients/server.ts');
  const first = await listen('books', isolated.createClientServer);
  servers.push(first.server);
  const before = assetUrls(
    await get(first.port, first.config.publicOrigin, '/'),
    first.config.publicOrigin,
  );
  await checkAsset(first.port, first.config.publicOrigin, before.script, '/client.js');
  await checkAsset(first.port, first.config.publicOrigin, before.stylesheet, '/styles.css');
  for (const name of ['client.js', 'styles.css']) {
    const file = join(clients, name);
    await writeFile(
      file,
      Buffer.concat([
        await readFile(file),
        Buffer.from('\n/* Isolated deployment cache-version fixture. */\n'),
      ]),
    );
  }
  const unchanged = assetUrls(
    await get(first.port, first.config.publicOrigin, '/'),
    first.config.publicOrigin,
  );
  assert.equal(unchanged.script.href, before.script.href);
  assert.equal(unchanged.stylesheet.href, before.stylesheet.href);
  await checkAsset(first.port, first.config.publicOrigin, unchanged.script, '/client.js');
  await checkAsset(first.port, first.config.publicOrigin, unchanged.stylesheet, '/styles.css');
  const second = await listen('books', isolated.createClientServer);
  servers.push(second.server);
  const after = assetUrls(
    await get(second.port, second.config.publicOrigin, '/'),
    second.config.publicOrigin,
  );
  assert.notEqual(
    after.script.href,
    before.script.href,
    'Changed JavaScript must bypass its previous browser cache key.',
  );
  assert.notEqual(
    after.stylesheet.href,
    before.stylesheet.href,
    'Changed CSS must bypass its previous browser cache key.',
  );
  await checkAsset(second.port, second.config.publicOrigin, after.script, '/client.js');
  await checkAsset(second.port, second.config.publicOrigin, after.stylesheet, '/styles.css');
});
