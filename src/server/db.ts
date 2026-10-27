import pg, { type PoolClient } from 'pg';
import { databaseConfig } from './database-config.ts';
export type Db = PoolClient;
const globalDb = globalThis as typeof globalThis & { tastekeeperPool?: pg.Pool };
export function pool(): pg.Pool {
  return (globalDb.tastekeeperPool ??= new pg.Pool(databaseConfig(process.env.DATABASE_URL)));
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
    if (process.env.NODE_ENV === 'production') {
      const login = (
        await db.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
          'SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=session_user',
        )
      ).rows[0];
      if (!login || login.rolsuper || login.rolbypassrls)
        throw new Error('UNSAFE_RUNTIME_DATABASE_IDENTITY');
    }
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
