-- Stage 5: row level security for advertising connections, lead sources and reporting (same model as 0003/0005/0007).

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['ad_connections','ad_accounts','ad_lead_sources','ad_lead_events','ad_campaigns','ad_daily_metrics','ad_sync_runs'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR ALL USING (app.unrestricted() OR company_id = app.current_company_id()) WITH CHECK (app.unrestricted() OR company_id = app.current_company_id())', t || '_company', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON app.%I TO bluewater_app', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- The import history is a record.
REVOKE DELETE, TRUNCATE ON app.ad_sync_runs FROM bluewater_app;
--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA app FROM anon, authenticated';
  END IF;
END $$;
