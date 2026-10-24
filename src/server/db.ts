import pg, { type PoolClient } from 'pg';
export type Db = PoolClient;
const globalDb = globalThis as typeof globalThis & { tastekeeperPool?: pg.Pool };
export function pool(): pg.Pool {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured.');
  return (globalDb.tastekeeperPool ??= new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 12,
    connectionTimeoutMillis: 4000,
    idleTimeoutMillis: 20000,
  }));
}
/** No request ever runs as the migration/superuser connection identity. */
export async function transaction<T>(
  tenantId: string | null,
  fn: (db: Db) => Promise<T>,
  lookupHash?: string,
): Promise<T> {
  const db = await pool().connect();
  try {
    await db.query('BEGIN');
    await db.query('SET LOCAL ROLE tastekeeper_runtime');
    await db.query(
      "SELECT set_config('app.tenant_id',$1,true), set_config('app.lookup_hash',$2,true)",
      [tenantId ?? '', lookupHash ?? ''],
    );
    const result = await fn(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
export async function shutdownDb() {
  if (globalDb.tastekeeperPool) {
    await globalDb.tastekeeperPool.end();
    delete globalDb.tastekeeperPool;
  }
}
