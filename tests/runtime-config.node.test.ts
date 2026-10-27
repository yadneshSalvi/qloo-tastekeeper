import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tls from 'node:tls';
import { databaseConfig } from '../src/server/database-config.ts';
import { cloudDispatchConfig } from '../src/server/dispatch.ts';
import { readMappings } from '../src/server/mappings.ts';

test('remote and production database connections require an explicit verifying CA', () => {
  assert.throws(
    () => databaseConfig('postgresql://runtime:synthetic@db.example/tastekeeper', {}),
    /DATABASE_CA_REQUIRED/,
  );
  assert.throws(
    () =>
      databaseConfig('postgresql://runtime:synthetic@localhost/tastekeeper', {
        NODE_ENV: 'production',
      }),
    /DATABASE_CA_REQUIRED/,
  );
  assert.throws(
    () =>
      databaseConfig('postgresql://runtime:synthetic@db.example/tastekeeper?sslmode=no-verify', {
        DATABASE_CA_CERT: 'synthetic-ca',
      }),
    /INSECURE_DATABASE_TLS/,
  );
  const config = databaseConfig(
    'postgresql://runtime:synthetic@db.example/tastekeeper?sslmode=require&sslrootcert=untrusted-path',
    { DATABASE_CA_CERT: 'synthetic-reviewed-ca' },
  );
  assert.deepEqual(config.ssl, { ca: 'synthetic-reviewed-ca', rejectUnauthorized: true });
  assert.ok(!config.connectionString?.includes('sslmode'));
  assert.ok(!config.connectionString?.includes('sslrootcert'));
  assert.equal(
    databaseConfig('postgresql://runtime:synthetic@127.0.0.1/tastekeeper', {}).ssl,
    undefined,
  );
});

test('Cloud Tasks requires an HTTPS origin and an explicit invoker identity', () => {
  const env = {
    CLOUD_TASKS_QUEUE: 'decisions',
    CLOUD_TASKS_LOCATION: 'us-central1',
    GOOGLE_CLOUD_PROJECT: 'tastekeeper-test',
    WORKER_ORIGIN: 'https://worker.example',
    WORKER_INVOKER_SERVICE_ACCOUNT: 'invoker@tastekeeper-test.iam.gserviceaccount.com',
  };
  assert.equal(cloudDispatchConfig(env)?.worker, 'https://worker.example');
  for (const origin of [
    'http://worker.example',
    'https://worker.example/tasks',
    'https://user:password@worker.example',
  ])
    assert.throws(() => cloudDispatchConfig({ ...env, WORKER_ORIGIN: origin }));
  assert.equal(cloudDispatchConfig({}), null);
});

test('explicit instance-ca mode still rejects a real untrusted TLS certificate chain', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tastekeeper-tls-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of ['expected', 'unrelated'])
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-subj',
        `/CN=${name}.instance.invalid`,
        '-keyout',
        join(directory, `${name}.key`),
        '-out',
        join(directory, `${name}.pem`),
      ],
      { stdio: 'ignore' },
    );
  const cert = await readFile(join(directory, 'expected.pem'), 'utf8');
  const unrelated = await readFile(join(directory, 'unrelated.pem'), 'utf8');
  const server = tls.createServer(
    { key: await readFile(join(directory, 'expected.key')), cert },
    (socket) => socket.end(),
  );
  server.on('tlsClientError', () => undefined);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `postgresql://runtime:synthetic@127.0.0.1:${address.port}/tastekeeper`;
  const connect = (ca: string, identity: string) =>
    new Promise<void>((resolve, reject) => {
      const config = databaseConfig(url, {
        DATABASE_CA_CERT: ca,
        DATABASE_TLS_IDENTITY: identity,
        NODE_ENV: 'production',
      });
      assert.ok(config.ssl && typeof config.ssl === 'object');
      assert.equal(config.ssl.rejectUnauthorized, true);
      const socket = tls.connect({ ...config.ssl, host: '127.0.0.1', port: address.port }, () => {
        assert.equal(socket.authorized, true);
        socket.destroy();
        resolve();
      });
      socket.on('error', (error) => {
        socket.destroy();
        reject(error);
      });
    });
  await connect(cert, 'instance-ca');
  await assert.rejects(connect(cert, 'verify-full'), /Hostname\/IP does not match certificate/);
  await assert.rejects(connect(unrelated, 'instance-ca'), /self.signed|certificate/i);
  assert.throws(
    () => databaseConfig(url, { DATABASE_TLS_IDENTITY: 'instance-ca' }),
    /INSTANCE_CA_CONFIGURATION_REQUIRED/,
  );
  assert.throws(
    () => databaseConfig(url, { DATABASE_TLS_IDENTITY: 'skip-everything', DATABASE_CA_CERT: cert }),
    /INVALID_DATABASE_TLS_IDENTITY/,
  );
});

test('reviewed mapping input rejects unknown catalog identities and cross-type substitution', () => {
  const value = {
    version: 1,
    verifiedAt: '2026-10-27T00:00:00.000Z',
    references: {},
    items: {
      'book-trees': {
        entityId: '11111111-1111-4111-8111-111111111111',
        type: 'movie',
        name: 'Synthetic wrong type',
        verifiedAt: '2026-10-27T00:00:00.000Z',
        method: 'Synthetic test',
      },
    },
  };
  assert.throws(
    () => readMappings({ QLOO_MAPPINGS_JSON: JSON.stringify(value) }),
    /MAPPING_IDENTITY_MISMATCH/,
  );
  value.items['book-trees'].type = 'book';
  assert.equal(
    readMappings({ QLOO_MAPPINGS_JSON: JSON.stringify(value) })?.items['book-trees'].type,
    'book',
  );
  assert.equal(readMappings({}), null);
});
