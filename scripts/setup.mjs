import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
const fresh = () => randomBytes(32).toString('base64url');
const gateway = 'http://127.0.0.1:3104';
if (!existsSync('.env.local')) {
  const secrets = { books: fresh(), media: fresh(), places: fresh() };
  writeFileSync(
    '.env.local',
    `DATABASE_URL=postgresql://qloo:qloo_local_dev@127.0.0.1:55432/tastekeeper\nAPP_ORIGIN=${gateway}\nCONTEXT_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}\nCLIENT_BOOKS_SECRET=${secrets.books}\nCLIENT_MEDIA_SECRET=${secrets.media}\nCLIENT_PLACES_SECRET=${secrets.places}\nDEMO_ENABLED=true\nQLOO_API_KEY=\n`,
    { mode: 0o600 },
  );
}
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((line) => line.includes('='))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);
for (const [index, kind] of ['books', 'media', 'places'].entries()) {
  const name = `.env.${kind}.local`;
  if (!existsSync(name))
    writeFileSync(
      name,
      `CLIENT_ID=${kind}\nCLIENT_SECRET=${env[`CLIENT_${kind.toUpperCase()}_SECRET`]}\nSESSION_SECRET=${fresh()}\nPORT=${3114 + index}\nPUBLIC_ORIGIN=http://${kind}.localhost:${3114 + index}\nGATEWAY_ORIGIN=${gateway}\nOWNER_ORIGIN=${gateway}\n`,
      { mode: 0o600 },
    );
}
console.log(
  'Local configuration is ready. Secrets were kept in ignored files. Run pnpm db:migrate.',
);
