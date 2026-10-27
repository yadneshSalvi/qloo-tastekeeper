import pg from 'pg';
import { databaseConfig } from '../../src/server/database-config.ts';
const pool = new pg.Pool(databaseConfig(process.env.DATABASE_MIGRATION_URL));
try {
  await pool.query(`BEGIN;
    REVOKE cloudsqlsuperuser FROM tastekeeper_app;
    REVOKE tastekeeper_inventory FROM tastekeeper_app;
    ALTER ROLE tastekeeper_app NOCREATEDB NOCREATEROLE;
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    REVOKE ALL ON SCHEMA public FROM tastekeeper_app;
    GRANT CONNECT ON DATABASE tastekeeper TO tastekeeper_app;
    GRANT USAGE ON SCHEMA public TO tastekeeper_app;
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM tastekeeper_app;
    GRANT tastekeeper_runtime TO tastekeeper_app;
    COMMIT;`);
  const role = (
    await pool.query(
      "SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname='tastekeeper_app'",
    )
  ).rows[0];
  const membership = (
    await pool.query(
      "SELECT pg_has_role('tastekeeper_app','cloudsqlsuperuser','MEMBER') AS administrative, pg_has_role('tastekeeper_app','tastekeeper_inventory','MEMBER') AS inventory, pg_has_role('tastekeeper_app','tastekeeper_runtime','MEMBER') AS runtime",
    )
  ).rows[0];
  const memberships = (
    await pool.query(
      "SELECT parent.rolname FROM pg_auth_members member JOIN pg_roles parent ON parent.oid=member.roleid JOIN pg_roles login ON login.oid=member.member WHERE login.rolname='tastekeeper_app'",
    )
  ).rows;
  if (
    !role ||
    Object.values(role).some(Boolean) ||
    membership.administrative ||
    membership.inventory ||
    !membership.runtime ||
    memberships.length !== 1 ||
    memberships[0].rolname !== 'tastekeeper_runtime'
  )
    throw Error('UNEXPECTED_RUNTIME_PRIVILEGES');
  console.log(
    'TASTEKEEPER runtime login is a non-administrative, non-bypass member of the application role only.',
  );
} catch (error) {
  console.error('Runtime privilege setup failed.', {
    code: /^[A-Z0-9]{5}$/.test(String(error?.code)) ? error.code : 'UNKNOWN',
  });
  process.exitCode = 1;
} finally {
  await pool.end();
}
