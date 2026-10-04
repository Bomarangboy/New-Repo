-- Stage 2: row level security for CRM and intake tables (same model as 0001_security.sql).

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['contacts','inquiries','consent_records','notes','tasks','inquiry_events','intake_sources','intake_events','import_batches'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR ALL USING (app.unrestricted() OR company_id = app.current_company_id()) WITH CHECK (app.unrestricted() OR company_id = app.current_company_id())', t || '_company', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON app.%I TO bluewater_app', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- History is append-only for the application.
REVOKE UPDATE, DELETE, TRUNCATE ON app.inquiry_events FROM bluewater_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON app.consent_records FROM bluewater_app;
--> statement-breakpoint

-- Leads and tasks may only be assigned to active members of the same company.
CREATE OR REPLACE FUNCTION app.guard_assignee() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.assigned_user_id IS NOT NULL
     AND NEW.assigned_user_id IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.assigned_user_id ELSE NULL END)
     AND NOT EXISTS (SELECT 1 FROM app.memberships m
                     WHERE m.company_id = NEW.company_id AND m.user_id = NEW.assigned_user_id AND m.status = 'active') THEN
    RAISE EXCEPTION 'assignee must be an active member of this company' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER inquiries_assignee_guard BEFORE INSERT OR UPDATE ON app.inquiries FOR EACH ROW EXECUTE FUNCTION app.guard_assignee();
--> statement-breakpoint
CREATE TRIGGER tasks_assignee_guard BEFORE INSERT OR UPDATE ON app.tasks FOR EACH ROW EXECUTE FUNCTION app.guard_assignee();
--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA app FROM anon, authenticated';
  END IF;
END $$;
