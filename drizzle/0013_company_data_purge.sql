-- Restricted company data deletion (docs/RETENTION.md, D-38).
-- Several tables are append-only for the application role (no DELETE), so permanent deletion goes through
-- this one narrowly-scoped function instead of granting DELETE broadly. It refuses unless:
--   * the caller is in platform/system scope (admin area or trusted job), and
--   * the company is ARCHIVED, or is a sales-demo prospect workspace (fictional data only).
-- Kept on purpose: the company row, invoices and billing terms, lifecycle/package history, support-access
-- grants, the activity log, the data_deletions record itself, and the opt-out list (suppressions) so that
-- people who said STOP are never contacted again if the company were ever reactivated.
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
    'message_status_events', 'messages', 'conversations', 'notifications', 'jobs',
    'sequence_enrollments', 'sequence_steps', 'sequences', 'appointments', 'booking_events', 'booking_settings',
    'notes', 'tasks', 'inquiry_events', 'inquiries', 'consent_records', 'contacts',
    'intake_events', 'intake_sources', 'import_batches',
    'ad_lead_events', 'ad_lead_sources', 'ad_daily_metrics', 'ad_campaigns', 'ad_sync_runs', 'ad_accounts', 'ad_connections',
    'message_templates', 'messaging_settings', 'company_senders',
    'support_ticket_messages', 'support_tickets', 'invitations', 'memberships'
  ] LOOP
    -- A demo reset keeps the people who can sign in; a real deletion removes access too.
    CONTINUE WHEN p_keep_access AND t IN ('invitations', 'memberships');
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
REVOKE ALL ON FUNCTION app.purge_company_data(uuid, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.purge_company_data(uuid, boolean) TO bluewater_app;
