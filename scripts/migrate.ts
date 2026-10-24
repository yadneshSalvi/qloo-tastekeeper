import pg from 'pg';
import { readFile } from 'node:fs/promises';
const database = process.env.DATABASE_URL;
if (!database) throw new Error('DATABASE_URL is required. Run pnpm demo:setup first.');
const pool = new pg.Pool({ connectionString: database });
try {
  const exists = await pool.query("SELECT to_regclass('public.schema_migrations') AS name");
  const done = exists.rows[0].name
    ? await pool.query("SELECT version FROM schema_migrations WHERE version='001_gateway'")
    : { rowCount: 0 };
  if (done.rowCount) console.log('Database schema is already current.');
  else {
    await pool.query(
      await readFile(new URL('../migrations/001_gateway.sql', import.meta.url), 'utf8'),
    );
    console.log('Applied 001_gateway. Runtime transactions use a non-bypass RLS role.');
  }
} finally {
  await pool.end();
}
