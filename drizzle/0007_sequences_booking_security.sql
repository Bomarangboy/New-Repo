-- Stage 4: row level security for follow-up sequences, booking and appointments (same model as 0003/0005).

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['sequences','sequence_steps','sequence_enrollments','booking_settings','appointments','booking_events'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR ALL USING (app.unrestricted() OR company_id = app.current_company_id()) WITH CHECK (app.unrestricted() OR company_id = app.current_company_id())', t || '_company', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON app.%I TO bluewater_app', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- Sequence step versions are never edited in place (a change is a new version), and the webhook log is a record.
REVOKE UPDATE, DELETE, TRUNCATE ON app.sequence_steps FROM bluewater_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON app.booking_events FROM bluewater_app;
--> statement-breakpoint

-- Keep "one notification per person per event" when some columns are empty (as in 0005).
DROP INDEX app.notifications_once_key;
--> statement-breakpoint
CREATE UNIQUE INDEX notifications_once_key ON app.notifications (company_id, user_id, kind, inquiry_id, conversation_id, ref_key) NULLS NOT DISTINCT;
--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA app FROM anon, authenticated';
  END IF;
END $$;
