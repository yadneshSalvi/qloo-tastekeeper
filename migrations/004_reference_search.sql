BEGIN;
CREATE TABLE reference_searches (
  tenant_id uuid NOT NULL REFERENCES tenants ON DELETE CASCADE,
  id uuid NOT NULL,
  owner_id uuid NOT NULL,
  query_digest text NOT NULL,
  encrypted_query text NOT NULL,
  encrypted_results text,
  state text NOT NULL CHECK(state IN ('queued','searching','complete','failed')),
  error_code text,
  http_reserved boolean NOT NULL DEFAULT false,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',
  PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,owner_id) REFERENCES users ON DELETE CASCADE
);
CREATE INDEX reference_search_work ON reference_searches(state,lease_until,created_at);
ALTER TABLE reference_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE reference_searches FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON reference_searches USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON reference_searches TO tastekeeper_runtime;
INSERT INTO schema_migrations(version) VALUES ('004_reference_search');
COMMIT;
