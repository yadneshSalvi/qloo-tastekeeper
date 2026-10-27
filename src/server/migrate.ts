import { readFile, readdir } from 'node:fs/promises';
import type pg from 'pg';

/** Called by the controlled migration command and isolated database tests, never web startup. */
export async function applyMigrations(db: pg.Pool) {
  const files = (await readdir(new URL('../../migrations/', import.meta.url)))
    .filter((name) => /^\d+_[a-z_]+\.sql$/.test(name))
    .sort();
  const exists = await db.query("SELECT to_regclass('public.schema_migrations') AS name");
  const applied = new Set<string>(
    exists.rows[0].name
      ? (await db.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map(
          (r) => r.version,
        )
      : [],
  );
  const completed: string[] = [];
  for (const file of files) {
    const version = file.slice(0, -4);
    if (applied.has(version)) continue;
    await db.query(await readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'));
    completed.push(version);
  }
  return completed;
}
