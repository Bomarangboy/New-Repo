-- Platform Studio and Sequence Library security (docs/STUDIO.md, docs/LIBRARY.md).

-- Platform-only: drafts, version history, uploaded images, template drafts, evidence computation inputs.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['studio_drafts','studio_versions','studio_assets','library_template_drafts'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR ALL USING (app.unrestricted()) WITH CHECK (app.unrestricted())', t || '_platform', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON app.%I TO bluewater_app', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- History is permanent.
REVOKE UPDATE, DELETE ON app.studio_versions FROM bluewater_app;
--> statement-breakpoint
REVOKE UPDATE ON app.studio_assets FROM bluewater_app;
--> statement-breakpoint

-- Published appearance: platform and package rows are readable by every workspace; a company row only by
-- that company. Only administrators write.
ALTER TABLE app.studio_published ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.studio_published FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY studio_published_read ON app.studio_published FOR SELECT
  USING (app.unrestricted() OR scope_kind IN ('platform', 'package') OR company_id = app.current_company_id());
--> statement-breakpoint
CREATE POLICY studio_published_platform ON app.studio_published FOR ALL USING (app.unrestricted()) WITH CHECK (app.unrestricted());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON app.studio_published TO bluewater_app;
--> statement-breakpoint

-- Library catalogue: clients read only what has been published (never drafts); administrators write.
ALTER TABLE app.library_categories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.library_categories FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY library_categories_read ON app.library_categories FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY library_categories_platform ON app.library_categories FOR ALL USING (app.unrestricted()) WITH CHECK (app.unrestricted());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON app.library_categories TO bluewater_app;
--> statement-breakpoint
ALTER TABLE app.library_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.library_templates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY library_templates_read ON app.library_templates FOR SELECT USING (app.unrestricted() OR status <> 'draft');
--> statement-breakpoint
CREATE POLICY library_templates_platform ON app.library_templates FOR ALL USING (app.unrestricted()) WITH CHECK (app.unrestricted());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON app.library_templates TO bluewater_app;
--> statement-breakpoint
ALTER TABLE app.library_template_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.library_template_versions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY library_template_versions_read ON app.library_template_versions FOR SELECT
  USING (app.unrestricted() OR EXISTS (SELECT 1 FROM app.library_templates t WHERE t.id = template_id AND t.status <> 'draft'));
--> statement-breakpoint
CREATE POLICY library_template_versions_platform ON app.library_template_versions FOR ALL USING (app.unrestricted()) WITH CHECK (app.unrestricted());
--> statement-breakpoint
GRANT SELECT, INSERT ON app.library_template_versions TO bluewater_app;
--> statement-breakpoint
ALTER TABLE app.library_evidence ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.library_evidence FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY library_evidence_read ON app.library_evidence FOR SELECT USING (app.unrestricted() OR published);
--> statement-breakpoint
CREATE POLICY library_evidence_platform ON app.library_evidence FOR ALL USING (app.unrestricted()) WITH CHECK (app.unrestricted());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON app.library_evidence TO bluewater_app;
--> statement-breakpoint

-- Company copies: ordinary company-owned rows.
ALTER TABLE app.library_copies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.library_copies FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY library_copies_company ON app.library_copies FOR ALL
  USING (app.unrestricted() OR company_id = app.current_company_id())
  WITH CHECK (app.unrestricted() OR company_id = app.current_company_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON app.library_copies TO bluewater_app;
--> statement-breakpoint

-- Restricted deletion now also covers library copies and a company's Studio overrides.
CREATE OR REPLACE FUNCTION app.purge_company_data(p_company uuid, p_keep_access boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  c record;
  t text;
  n bigint;
  result jsonb := '{}'::jsonb;
BEGIN
  IF coalesce(current_setting('app.scope', true), '') NOT IN ('platform', 'system') THEN
    RAISE EXCEPTION 'purge_company_data: not allowed in this scope';
  END IF;
  SELECT id, kind, lifecycle_status INTO c FROM app.companies WHERE id = p_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'purge_company_data: company not found'; END IF;
  IF NOT (c.lifecycle_status = 'archived' OR c.kind = 'demo_prospect') THEN
    RAISE EXCEPTION 'purge_company_data: company must be archived first';
  END IF;
  IF p_keep_access AND c.kind <> 'demo_prospect' THEN
    RAISE EXCEPTION 'purge_company_data: only demo workspaces can be reset';
  END IF;
  -- Children before parents (all foreign keys also cascade; the order keeps counts meaningful).
  FOREACH t IN ARRAY ARRAY[
    'library_copies',
    'message_status_events', 'messages', 'conversations', 'notifications', 'jobs',
    'sequence_enrollments', 'sequence_steps', 'sequences', 'appointments', 'booking_events', 'booking_settings',
    'notes', 'tasks', 'inquiry_events', 'inquiries', 'consent_records', 'contacts',
    'intake_events', 'intake_sources', 'import_batches',
    'ad_lead_events', 'ad_lead_sources', 'ad_daily_metrics', 'ad_campaigns', 'ad_sync_runs', 'ad_accounts', 'ad_connections',
    'message_templates', 'messaging_settings', 'company_senders',
    'support_ticket_messages', 'support_tickets', 'studio_drafts', 'studio_published', 'invitations', 'memberships'
  ] LOOP
    -- A demo reset keeps the people who can sign in (and the workspace's Studio look); a real deletion removes both.
    CONTINUE WHEN p_keep_access AND t IN ('invitations', 'memberships', 'studio_drafts', 'studio_published');
    EXECUTE format('DELETE FROM app.%I WHERE company_id = $1', t) USING p_company;
    GET DIAGNOSTICS n = ROW_COUNT;
    result := result || jsonb_build_object(t, n);
  END LOOP;
  -- Fictional demo data has no real opt-outs to honour.
  IF c.kind = 'demo_prospect' THEN
    DELETE FROM app.suppressions WHERE company_id = p_company;
    GET DIAGNOSTICS n = ROW_COUNT;
    result := result || jsonb_build_object('suppressions', n);
  END IF;
  RETURN result;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA app FROM anon, authenticated';
  END IF;
END $$;
