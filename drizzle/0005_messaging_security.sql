-- Stage 3: row level security for jobs and messaging tables (same model as 0001/0003).

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['messaging_settings','message_templates','conversations','messages','message_status_events','suppressions','notifications'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR ALL USING (app.unrestricted() OR company_id = app.current_company_id()) WITH CHECK (app.unrestricted() OR company_id = app.current_company_id())', t || '_company', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON app.%I TO bluewater_app', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- Jobs: company jobs visible to that company's context; platform jobs (no company) only to system scope.
ALTER TABLE app.jobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.jobs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY jobs_company ON app.jobs FOR ALL
  USING (app.unrestricted() OR (company_id IS NOT NULL AND company_id = app.current_company_id()))
  WITH CHECK (app.unrestricted() OR (company_id IS NOT NULL AND company_id = app.current_company_id()));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON app.jobs TO bluewater_app;
--> statement-breakpoint

-- Sender identities are configured by Bluewater only; companies can read their status.
ALTER TABLE app.company_senders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.company_senders FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_senders_read ON app.company_senders FOR SELECT USING (app.unrestricted() OR company_id = app.current_company_id());
--> statement-breakpoint
CREATE POLICY company_senders_write ON app.company_senders FOR ALL USING (app.unrestricted()) WITH CHECK (app.unrestricted());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON app.company_senders TO bluewater_app;
--> statement-breakpoint

-- Provider reports are an append-only record.
REVOKE UPDATE, DELETE, TRUNCATE ON app.message_status_events FROM bluewater_app;
--> statement-breakpoint

-- One notification per person per event, even when inquiry_id or conversation_id is empty.
DROP INDEX app.notifications_once_key;
--> statement-breakpoint
CREATE UNIQUE INDEX notifications_once_key ON app.notifications (company_id, user_id, kind, inquiry_id, conversation_id) NULLS NOT DISTINCT;
--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA app FROM anon, authenticated';
  END IF;
END $$;
