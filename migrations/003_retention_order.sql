BEGIN;
CREATE OR REPLACE FUNCTION erase_demo_workspace(requested_tenant uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF requested_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid THEN RAISE EXCEPTION 'tenant denied'; END IF;
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE tenant_id=requested_tenant AND demo) THEN RETURN false; END IF;
  PERFORM id FROM clients WHERE tenant_id=requested_tenant ORDER BY id FOR UPDATE;
  PERFORM id FROM contexts WHERE tenant_id=requested_tenant ORDER BY id FOR UPDATE;
  PERFORM id FROM grants WHERE tenant_id=requested_tenant ORDER BY id FOR UPDATE;
  PERFORM set_config('app.retention_delete','on',true);
  DELETE FROM client_sessions WHERE tenant_id=requested_tenant;
  DELETE FROM selections WHERE tenant_id=requested_tenant;
  DELETE FROM release_receipts WHERE tenant_id=requested_tenant;
  DELETE FROM provider_attempts WHERE tenant_id=requested_tenant;
  DELETE FROM decision_runs WHERE tenant_id=requested_tenant;
  DELETE FROM credentials WHERE tenant_id=requested_tenant;
  DELETE FROM invitations WHERE tenant_id=requested_tenant;
  DELETE FROM grant_revisions WHERE tenant_id=requested_tenant;
  DELETE FROM grants WHERE tenant_id=requested_tenant;
  DELETE FROM context_revisions WHERE tenant_id=requested_tenant;
  DELETE FROM contexts WHERE tenant_id=requested_tenant;
  DELETE FROM catalog_heads WHERE tenant_id=requested_tenant;
  DELETE FROM catalog_snapshots WHERE tenant_id=requested_tenant;
  DELETE FROM clients WHERE tenant_id=requested_tenant;
  DELETE FROM owner_sessions WHERE tenant_id=requested_tenant;
  DELETE FROM users WHERE tenant_id=requested_tenant;
  DELETE FROM audit_events WHERE tenant_id=requested_tenant;
  DELETE FROM outbox WHERE tenant_id=requested_tenant;
  DELETE FROM tenants WHERE tenant_id=requested_tenant;
  RETURN true;
END $$;
INSERT INTO schema_migrations(version) VALUES ('003_retention_order');
COMMIT;
