import { readFileSync } from 'node:fs';
import type { PoolConfig } from 'pg';

/** Explicit TLS prevents connection-string flags from silently weakening certificate checks. */
export function databaseConfig(
  value: string | undefined,
  env: Record<string, string | undefined> = process.env,
): PoolConfig {
  if (!value) throw new Error('DATABASE_URL is not configured.');
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('INVALID_DATABASE_URL');
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  const ca =
    env.DATABASE_CA_CERT ||
    (env.DATABASE_CA_FILE ? readFileSync(env.DATABASE_CA_FILE, 'utf8') : undefined);
  const identity = env.DATABASE_TLS_IDENTITY || 'verify-full';
  if (!['verify-full', 'instance-ca'].includes(identity))
    throw new Error('INVALID_DATABASE_TLS_IDENTITY');
  if (identity === 'instance-ca' && (!ca || env.DATABASE_TLS_SERVERNAME))
    throw new Error('INSTANCE_CA_CONFIGURATION_REQUIRED');
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode === 'no-verify' || (sslmode === 'disable' && !local))
    throw new Error('INSECURE_DATABASE_TLS');
  for (const key of ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert'])
    url.searchParams.delete(key);
  if ((!local || env.NODE_ENV === 'production') && !ca) throw new Error('DATABASE_CA_REQUIRED');
  return {
    connectionString: url.toString(),
    ...(ca
      ? {
          ssl: {
            ca,
            rejectUnauthorized: true,
            // A private Cloud SQL IP may not appear in its certificate SANs. This
            // explicit mode pins identity to that instance's unique CA; chain,
            // signature and certificate-validity checks remain mandatory.
            ...(identity === 'instance-ca' ? { checkServerIdentity: () => undefined } : {}),
            ...(env.DATABASE_TLS_SERVERNAME ? { servername: env.DATABASE_TLS_SERVERNAME } : {}),
          },
        }
      : {}),
    max: 8,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 20000,
    statement_timeout: 15000,
  };
}
