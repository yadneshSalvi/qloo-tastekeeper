BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='tastekeeper_inventory') THEN
    CREATE ROLE tastekeeper_inventory NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  EXECUTE format('GRANT tastekeeper_inventory TO %I',current_user);
END $$;
GRANT USAGE, CREATE ON SCHEMA public TO tastekeeper_inventory;
GRANT SELECT ON tenants TO tastekeeper_inventory;
CREATE POLICY maintenance_tenant_inventory ON tenants FOR SELECT TO tastekeeper_inventory USING (true);
ALTER FUNCTION active_demo_tenants() OWNER TO tastekeeper_inventory;
CREATE TABLE client_sessions (
  token_hash text PRIMARY KEY,
  tenant_id uuid NOT NULL,
  client_id text NOT NULL,
  delegate_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  grant_version integer NOT NULL,
  client_epoch integer NOT NULL,
  encrypted_credential text NOT NULL,
  credential_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  latest_run_id uuid,
  last_brief jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,grant_id) REFERENCES grants ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,client_id) REFERENCES clients,
  FOREIGN KEY (tenant_id,delegate_id) REFERENCES users,
  FOREIGN KEY (credential_hash) REFERENCES credentials
);
ALTER TABLE client_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON client_sessions USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY client_session_lookup ON client_sessions FOR SELECT USING (token_hash = current_setting('app.lookup_hash',true));
GRANT SELECT,INSERT,UPDATE,DELETE ON client_sessions TO tastekeeper_runtime;

ALTER TABLE decision_runs ADD COLUMN encrypted_checkpoint text;
CREATE TABLE provider_attempts (
  tenant_id uuid NOT NULL,
  run_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('qloo','openai')),
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 2),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,run_id,provider,ordinal),
  FOREIGN KEY (tenant_id,run_id) REFERENCES decision_runs ON DELETE CASCADE
);
ALTER TABLE provider_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON provider_attempts USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
GRANT SELECT,INSERT ON provider_attempts TO tastekeeper_runtime;
CREATE TABLE provider_counters (bucket text PRIMARY KEY, used integer NOT NULL CHECK(used>=0), expires_at timestamptz NOT NULL);
GRANT SELECT,INSERT,UPDATE,DELETE ON provider_counters TO tastekeeper_runtime;

-- Immutable evidence can be erased only through the narrowly scoped functions below.
-- Runtime callers cannot bypass the trigger by setting the GUC themselves.
CREATE OR REPLACE FUNCTION immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND current_setting('app.retention_delete',true)='on' AND current_user <> 'tastekeeper_runtime' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'immutable record';
END $$;

CREATE FUNCTION erase_demo_workspace(requested_tenant uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF requested_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid THEN RAISE EXCEPTION 'tenant denied'; END IF;
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE tenant_id=requested_tenant AND demo) THEN RETURN false; END IF;
  PERFORM id FROM clients WHERE tenant_id=requested_tenant ORDER BY id FOR UPDATE;
  PERFORM id FROM contexts WHERE tenant_id=requested_tenant ORDER BY id FOR UPDATE;
  PERFORM id FROM grants WHERE tenant_id=requested_tenant ORDER BY id FOR UPDATE;
  PERFORM set_config('app.retention_delete','on',true);
  DELETE FROM client_sessions WHERE tenant_id=requested_tenant;
  DELETE FROM tenants WHERE tenant_id=requested_tenant;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION erase_demo_workspace(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erase_demo_workspace(uuid) TO tastekeeper_runtime;

CREATE FUNCTION erase_context_payloads(requested_tenant uuid, requested_context uuid, requested_owner uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF requested_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid THEN RAISE EXCEPTION 'tenant denied'; END IF;
  PERFORM id FROM clients WHERE tenant_id=requested_tenant ORDER BY id FOR UPDATE;
  PERFORM id FROM contexts WHERE tenant_id=requested_tenant AND id=requested_context AND owner_id=requested_owner FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM id FROM grants WHERE tenant_id=requested_tenant AND context_id=requested_context ORDER BY id FOR UPDATE;
  UPDATE contexts SET deleted=true,revision=revision+1 WHERE tenant_id=requested_tenant AND id=requested_context AND NOT deleted;
  DELETE FROM selections WHERE tenant_id=requested_tenant AND run_id IN (SELECT id FROM decision_runs WHERE tenant_id=requested_tenant AND context_id=requested_context);
  UPDATE decision_runs SET encrypted_inputs='',encrypted_checkpoint=NULL,result=NULL,state='stale',error_code='CONTEXT_DELETED',lease_until=NULL WHERE tenant_id=requested_tenant AND context_id=requested_context;
  DELETE FROM client_sessions WHERE tenant_id=requested_tenant AND grant_id IN (SELECT id FROM grants WHERE tenant_id=requested_tenant AND context_id=requested_context);
  PERFORM set_config('app.retention_delete','on',true);
  DELETE FROM context_revisions WHERE tenant_id=requested_tenant AND context_id=requested_context;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION erase_context_payloads(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erase_context_payloads(uuid,uuid,uuid) TO tastekeeper_runtime;

CREATE FUNCTION expired_demo_tenants() RETURNS TABLE(tenant_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT tenant_id FROM tenants WHERE demo AND expires_at <= now() ORDER BY expires_at LIMIT 100
$$;
ALTER FUNCTION expired_demo_tenants() OWNER TO tastekeeper_inventory;
REVOKE ALL ON FUNCTION expired_demo_tenants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION expired_demo_tenants() TO tastekeeper_runtime;
REVOKE CREATE ON SCHEMA public FROM tastekeeper_inventory;
INSERT INTO schema_migrations(version) VALUES ('002_hosted_execution');
COMMIT;
