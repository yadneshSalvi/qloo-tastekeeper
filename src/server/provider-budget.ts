import { bodyDigest } from './crypto.ts';
import { transaction } from './db.ts';
import { DomainError } from './errors.ts';

type Provider = 'qloo' | 'openai';
function limit(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 0 || value > 100000)
    throw new Error('INVALID_PROVIDER_BUDGET');
  return value;
}
/** Reserve before every actual HTTP attempt. Uncertain outcomes never refund or auto-repeat. */
export async function reserveProviderRequest(tenantId: string, runId: string, provider: Provider) {
  const date = new Date().toISOString().slice(0, 10);
  const prefix = provider.toUpperCase();
  const globalLimit = limit(`${prefix}_GLOBAL_DAILY_LIMIT`, provider === 'qloo' ? 120 : 240);
  const tenantLimit = limit(`${prefix}_TENANT_DAILY_LIMIT`, provider === 'qloo' ? 8 : 16);
  return transaction(tenantId, async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `provider:${provider}:${date}`,
    ]);
    const attempts = Number(
      (
        await db.query<{ count: string }>(
          'SELECT count(*) FROM provider_attempts WHERE tenant_id=$1 AND run_id=$2 AND provider=$3',
          [tenantId, runId, provider],
        )
      ).rows[0].count,
    );
    if (attempts >= (provider === 'qloo' ? 1 : 2)) {
      throw new DomainError(
        'PROVIDER_ATTEMPT_LIMIT',
        'An earlier provider attempt may have completed. Start a new choice to retry safely.',
        409,
      );
    }
    for (const [scope, max] of [
      ['global', globalLimit],
      [tenantId, tenantLimit],
    ] as const) {
      const bucket = bodyDigest({ provider, date, scope });
      await db.query(
        "INSERT INTO provider_counters(bucket,used,expires_at) VALUES($1,0,now()+interval '2 days') ON CONFLICT DO NOTHING",
        [bucket],
      );
      const result = await db.query(
        'UPDATE provider_counters SET used=used+1 WHERE bucket=$1 AND used<$2 RETURNING used',
        [bucket, max],
      );
      if (result.rowCount !== 1)
        throw new DomainError(
          'UPSTREAM_LIMIT',
          'The live demo has reached its provider allowance. Your brief is preserved; try again after the daily allowance renews.',
          429,
        );
    }
    await db.query(
      'INSERT INTO provider_attempts(tenant_id,run_id,provider,ordinal) VALUES($1,$2,$3,$4)',
      [tenantId, runId, provider, attempts + 1],
    );
    return { ordinal: attempts + 1 };
  });
}

export async function reserveReferenceSearch(tenantId: string, searchId: string) {
  const date = new Date().toISOString().slice(0, 10);
  return transaction(tenantId, async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `provider:qloo:${date}`,
    ]);
    const row = (
      await db.query<{ http_reserved: boolean }>(
        "SELECT http_reserved FROM reference_searches WHERE tenant_id=$1 AND id=$2 AND state='searching' AND lease_until>clock_timestamp() AND expires_at>now() FOR UPDATE",
        [tenantId, searchId],
      )
    ).rows[0];
    if (!row || row.http_reserved)
      throw new DomainError(
        'PROVIDER_ATTEMPT_LIMIT',
        'This search already attempted its provider request. Start a new search to retry safely.',
        409,
      );
    const scopes = [
      ['global', limit('QLOO_GLOBAL_DAILY_LIMIT', 120)],
      [tenantId, limit('QLOO_TENANT_DAILY_LIMIT', 8)],
      [`search:${tenantId}`, limit('QLOO_SEARCH_TENANT_DAILY_LIMIT', 6)],
    ] as const;
    for (const [scope, max] of scopes) {
      const bucket = bodyDigest({ provider: 'qloo', date, scope });
      await db.query(
        "INSERT INTO provider_counters(bucket,used,expires_at) VALUES($1,0,now()+interval '2 days') ON CONFLICT DO NOTHING",
        [bucket],
      );
      const changed = await db.query(
        'UPDATE provider_counters SET used=used+1 WHERE bucket=$1 AND used<$2 RETURNING used',
        [bucket, max],
      );
      if (!changed.rowCount)
        throw new DomainError(
          'UPSTREAM_LIMIT',
          'The live search allowance is exhausted. Try again after the daily allowance renews.',
          429,
        );
    }
    await db.query(
      'UPDATE reference_searches SET http_reserved=true WHERE tenant_id=$1 AND id=$2',
      [tenantId, searchId],
    );
  });
}
