export const tenantTables = [
  'tenants',
  'users',
  'owner_sessions',
  'clients',
  'contexts',
  'context_revisions',
  'catalog_snapshots',
  'catalog_heads',
  'grants',
  'grant_revisions',
  'invitations',
  'credentials',
  'decision_runs',
  'release_receipts',
  'selections',
  'audit_events',
  'outbox',
  'client_sessions',
  'provider_attempts',
  'reference_searches',
];
export const globalTables = ['worker_heartbeats', 'request_limits', 'provider_counters'];
export const runtimeTables = [...tenantTables, ...globalTables];

export const appendOnlyTables = ['provider_attempts'];
