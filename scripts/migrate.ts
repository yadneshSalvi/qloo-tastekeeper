import pg from 'pg';
import { databaseConfig } from '../src/server/database-config.ts';
import { applyMigrations } from '../src/server/migrate.ts';
const database =
  process.env.DATABASE_MIGRATION_URL ||
  (process.env.NODE_ENV === 'production' ? undefined : process.env.DATABASE_URL);
if (!database)
  throw new Error('DATABASE_MIGRATION_URL is required for a controlled production migration.');
const pool = new pg.Pool(databaseConfig(database));
try {
  const completed = await applyMigrations(pool);
  console.log(
    completed.length ? `Applied ${completed.join(', ')}.` : 'Database schema is already current.',
  );
} finally {
  await pool.end();
}
