-- Stage 7: row level security for operations tables.

-- Client-visible, Bluewater-managed: the company can read its own rows; only platform/system scope can write.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['company_billing','invoices'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR SELECT USING (app.unrestricted() OR company_id = app.current_company_id())', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR ALL USING (app.unrestricted()) WITH CHECK (app.unrestricted())', t || '_write', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON app.%I TO bluewater_app', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- Billing records are never deleted by the application.
REVOKE DELETE, TRUNCATE ON app.invoices FROM bluewater_app;
--> statement-breakpoint

-- Support tickets: the company works with its own tickets.
ALTER TABLE app.support_tickets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.support_tickets FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY support_tickets_company ON app.support_tickets FOR ALL
  USING (app.unrestricted() OR company_id = app.current_company_id())
  WITH CHECK (app.unrestricted() OR company_id = app.current_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON app.support_tickets TO bluewater_app;
--> statement-breakpoint

-- Ticket messages: the company never sees or writes Bluewater's internal notes.
ALTER TABLE app.support_ticket_messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.support_ticket_messages FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ticket_messages_platform ON app.support_ticket_messages FOR ALL USING (app.unrestricted()) WITH CHECK (app.unrestricted());
--> statement-breakpoint
CREATE POLICY ticket_messages_company_read ON app.support_ticket_messages FOR SELECT
  USING (company_id = app.current_company_id() AND NOT internal);
--> statement-breakpoint
CREATE POLICY ticket_messages_company_write ON app.support_ticket_messages FOR INSERT
  WITH CHECK (company_id = app.current_company_id() AND NOT internal AND author_type = 'customer');
--> statement-breakpoint
GRANT SELECT, INSERT ON app.support_ticket_messages TO bluewater_app;
--> statement-breakpoint

-- Ticket references BW-1001, BW-1002 …
CREATE SEQUENCE IF NOT EXISTS app.ticket_ref_seq START 1001;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE app.ticket_ref_seq TO bluewater_app;
--> statement-breakpoint

-- Platform-only tables (administrators and trusted system jobs).
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['platform_settings','ops_alerts','incident_notices','data_deletions','ops_records'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR ALL USING (app.unrestricted()) WITH CHECK (app.unrestricted())', t || '_platform', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON app.%I TO bluewater_app', t);
  END LOOP;
END $$;
--> statement-breakpoint
GRANT DELETE ON app.platform_settings TO bluewater_app;
--> statement-breakpoint
-- Deletion and drill records are permanent.
REVOKE UPDATE ON app.data_deletions FROM bluewater_app;
--> statement-breakpoint
REVOKE UPDATE ON app.ops_records FROM bluewater_app;
--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA app FROM anon, authenticated';
  END IF;
END $$;
