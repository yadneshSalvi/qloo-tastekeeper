import pg from 'pg';
import { rootCertificates } from 'node:tls';
import { databaseConfig } from '../../src/server/database-config.ts';
import { tenantTables, runtimeTables, appendOnlyTables } from './runtime-tables.mjs';
const config = databaseConfig(process.env.DATABASE_URL);
const pool = new pg.Pool(config);
try {
  const session = (await pool.query('SELECT current_user AS login')).rows[0];
  if (session.login !== 'tastekeeper_app') throw Error('WRONG_RUNTIME_LOGIN');
  const role = (
    await pool.query(
      'SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user',
    )
  ).rows[0];
  if (Object.values(role).some(Boolean)) throw Error('ELEVATED_RUNTIME_LOGIN');
  const rights = (
    await pool.query(`SELECT
    pg_has_role(current_user,'cloudsqlsuperuser','MEMBER') AS administrative,
    pg_has_role(current_user,'tastekeeper_inventory','MEMBER') AS inventory,
    has_schema_privilege(current_user,'public','CREATE') AS create_schema,
    has_table_privilege(current_user,'schema_migrations','SELECT,INSERT,UPDATE,DELETE') AS migration_access`)
  ).rows[0];
  if (Object.values(rights).some(Boolean)) throw Error('EXCESS_RUNTIME_ACCESS');
  const memberships = (
    await pool.query(
      'SELECT parent.rolname FROM pg_auth_members member JOIN pg_roles parent ON parent.oid=member.roleid WHERE member.member=(SELECT oid FROM pg_roles WHERE rolname=current_user)',
    )
  ).rows;
  if (memberships.length !== 1 || memberships[0].rolname !== 'tastekeeper_runtime')
    throw Error('EXCESS_RUNTIME_MEMBERSHIP');
  const rows = (
    await pool.query(`SELECT c.relname AS name,c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls,
    has_table_privilege(current_user,c.oid,'SELECT') AS readable,
    has_table_privilege(current_user,c.oid,'INSERT') AS insertable,
    has_table_privilege(current_user,c.oid,'UPDATE') AS updatable,
    has_table_privilege(current_user,c.oid,'DELETE') AS deletable
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'`)
  ).rows;
  for (const name of runtimeTables) {
    const row = rows.find((r) => r.name === name);
    if (!row || !row.readable || !row.insertable) throw Error('MISSING_RUNTIME_GRANT');
    if (
      appendOnlyTables.includes(name)
        ? row.updatable || row.deletable
        : !row.updatable || !row.deletable
    )
      throw Error('UNEXPECTED_RUNTIME_MUTATION_GRANT');
    if (tenantTables.includes(name) && (!row.rls || !row.force_rls))
      throw Error('MISSING_FORCED_RLS');
  }
  if (
    rows.some(
      (r) =>
        !runtimeTables.includes(r.name) &&
        (r.readable || r.insertable || r.updatable || r.deletable),
    )
  )
    throw Error('UNEXPECTED_TABLE_ACCESS');
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query('SET LOCAL ROLE tastekeeper_runtime');
    await connection.query(
      "SELECT set_config('app.tenant_id','',true),set_config('app.lookup_hash','',true)",
    );
    const count = Number((await connection.query('SELECT count(*) FROM contexts')).rows[0].count);
    if (count !== 0) throw Error('UNSCOPED_CONTEXT_VISIBLE');
    await connection.query('ROLLBACK');
  } finally {
    connection.release();
  }
  const wrong = new pg.Pool({
    ...config,
    ssl: { ...config.ssl, ca: rootCertificates[0], rejectUnauthorized: true },
  });
  let rejected = false;
  try {
    await wrong.query('SELECT 1');
  } catch (error) {
    rejected =
      String(error?.code ?? '').includes('CERT') ||
      [
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
        'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
        'DEPTH_ZERO_SELF_SIGNED_CERT',
      ].includes(error?.code);
  } finally {
    await wrong.end();
  }
  if (!rejected) throw Error('UNRELATED_CA_NOT_REJECTED');
  console.log(
    JSON.stringify({
      strictCaConnection: true,
      unrelatedCaRejected: true,
      runtimeTables: runtimeTables.length,
      forcedRlsTables: tenantTables.length,
      unscopedContexts: 0,
      administrativeAccess: false,
      migrationAccess: false,
      unexpectedTableAccess: false,
    }),
  );
} catch (error) {
  console.error('Runtime verification failed.', {
    code: /^[A-Z0-9_]{3,60}$/.test(String(error?.code ?? error?.message))
      ? String(error.code ?? error.message)
      : 'UNKNOWN',
  });
  process.exitCode = 1;
} finally {
  await pool.end();
}
