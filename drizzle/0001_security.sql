-- Bluewater Collective: database-level company isolation (Row Level Security).
--
-- The web app and workers connect as `bluewater_app`, a role that CANNOT bypass
-- RLS. Each transaction declares its context with set_config(..., true):
--   app.company_id   – the company the request is acting for (verified by the server first)
--   app.user_id      – the signed-in Bluewater user
--   app.auth_user_id – identity-provider id, used only while resolving the user at sign-in
--   app.scope        – 'platform' (verified administrator) or 'system' (workers, sign-in, webhooks)
-- With no context, every company-owned table appears empty.

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'bluewater_app') THEN
    CREATE ROLE bluewater_app LOGIN NOBYPASSRLS NOINHERIT;
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.current_company_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.company_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.current_auth_user_id() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.auth_user_id', true), '') $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.unrestricted() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT coalesce(current_setting('app.scope', true), '') IN ('platform', 'system') $$;
--> statement-breakpoint

-- Enable and FORCE row level security on every table in the schema.
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'app' LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
--> statement-breakpoint

-- companies: members can see companies they belong to; writes are limited to the
-- current company, and a trigger blocks non-administrators from restricted fields.
CREATE POLICY companies_select ON app.companies FOR SELECT USING (
  app.unrestricted() OR id = app.current_company_id() OR EXISTS (
    SELECT 1 FROM app.memberships m
    WHERE m.company_id = companies.id AND m.user_id = app.current_user_id() AND m.status = 'active'));
--> statement-breakpoint
CREATE POLICY companies_update ON app.companies FOR UPDATE
  USING (app.unrestricted() OR id = app.current_company_id())
  WITH CHECK (app.unrestricted() OR id = app.current_company_id());
--> statement-breakpoint
CREATE POLICY companies_insert ON app.companies FOR INSERT WITH CHECK (app.unrestricted());
--> statement-breakpoint
CREATE POLICY companies_delete ON app.companies FOR DELETE USING (app.unrestricted());
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_company_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT app.unrestricted() AND (
       NEW.package IS DISTINCT FROM OLD.package OR NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status
    OR NEW.billing_status IS DISTINCT FROM OLD.billing_status OR NEW.suspended IS DISTINCT FROM OLD.suspended
    OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.slug IS DISTINCT FROM OLD.slug
    OR NEW.demo_expires_at IS DISTINCT FROM OLD.demo_expires_at OR NEW.service_ends_at IS DISTINCT FROM OLD.service_ends_at
    OR NEW.admin_notes IS DISTINCT FROM OLD.admin_notes OR NEW.churn_reason IS DISTINCT FROM OLD.churn_reason) THEN
    RAISE EXCEPTION 'restricted company fields can only be changed by a platform administrator' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER companies_guard BEFORE UPDATE ON app.companies FOR EACH ROW EXECUTE FUNCTION app.guard_company_update();
--> statement-breakpoint

-- users: a person sees themself and the members of the company in context.
CREATE POLICY users_select ON app.users FOR SELECT USING (
  app.unrestricted() OR id = app.current_user_id() OR auth_user_id = app.current_auth_user_id() OR EXISTS (
    SELECT 1 FROM app.memberships m WHERE m.user_id = users.id AND m.company_id = app.current_company_id()));
--> statement-breakpoint
CREATE POLICY users_update ON app.users FOR UPDATE
  USING (app.unrestricted() OR id = app.current_user_id())
  WITH CHECK (app.unrestricted() OR id = app.current_user_id());
--> statement-breakpoint
CREATE POLICY users_insert ON app.users FOR INSERT WITH CHECK (app.unrestricted());
--> statement-breakpoint
CREATE POLICY users_delete ON app.users FOR DELETE USING (app.unrestricted());
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_user_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT app.unrestricted() AND (
       NEW.is_platform_admin IS DISTINCT FROM OLD.is_platform_admin OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id OR NEW.email IS DISTINCT FROM OLD.email) THEN
    RAISE EXCEPTION 'restricted user fields cannot be changed here' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER users_guard BEFORE UPDATE ON app.users FOR EACH ROW EXECUTE FUNCTION app.guard_user_update();
--> statement-breakpoint

-- memberships: visible to the company in context and to the member themself.
CREATE POLICY memberships_select ON app.memberships FOR SELECT USING (
  app.unrestricted() OR company_id = app.current_company_id() OR user_id = app.current_user_id());
--> statement-breakpoint
CREATE POLICY memberships_write ON app.memberships FOR ALL
  USING (app.unrestricted() OR company_id = app.current_company_id())
  WITH CHECK (app.unrestricted() OR company_id = app.current_company_id());
--> statement-breakpoint

-- Simple company-owned tables.
CREATE POLICY invitations_company ON app.invitations FOR ALL
  USING (app.unrestricted() OR company_id = app.current_company_id())
  WITH CHECK (app.unrestricted() OR company_id = app.current_company_id());
--> statement-breakpoint
CREATE POLICY package_history_select ON app.package_history FOR SELECT USING (app.unrestricted() OR company_id = app.current_company_id());
--> statement-breakpoint
CREATE POLICY package_history_insert ON app.package_history FOR INSERT WITH CHECK (app.unrestricted());
--> statement-breakpoint
CREATE POLICY lifecycle_history_select ON app.lifecycle_history FOR SELECT USING (app.unrestricted() OR company_id = app.current_company_id());
--> statement-breakpoint
CREATE POLICY lifecycle_history_insert ON app.lifecycle_history FOR INSERT WITH CHECK (app.unrestricted());
--> statement-breakpoint
CREATE POLICY support_grants_select ON app.support_access_grants FOR SELECT USING (app.unrestricted() OR company_id = app.current_company_id());
--> statement-breakpoint
CREATE POLICY support_grants_write ON app.support_access_grants FOR ALL USING (app.unrestricted()) WITH CHECK (app.unrestricted());
--> statement-breakpoint

-- audit_log: append-only. Readable by the company it concerns; administrator-level
-- entries (no company) are readable only in platform scope.
CREATE POLICY audit_select ON app.audit_log FOR SELECT USING (app.unrestricted() OR company_id = app.current_company_id());
--> statement-breakpoint
CREATE POLICY audit_insert ON app.audit_log FOR INSERT WITH CHECK (
  app.unrestricted() OR company_id = app.current_company_id()
  OR (company_id IS NULL AND actor_user_id = app.current_user_id()));
--> statement-breakpoint

-- Sign-in internals: only reachable in system scope.
CREATE POLICY local_credentials_system ON app.local_credentials FOR ALL USING (app.unrestricted()) WITH CHECK (app.unrestricted());
--> statement-breakpoint
CREATE POLICY local_sessions_system ON app.local_sessions FOR ALL USING (app.unrestricted()) WITH CHECK (app.unrestricted());
--> statement-breakpoint
CREATE POLICY password_reset_system ON app.password_reset_tokens FOR ALL USING (app.unrestricted()) WITH CHECK (app.unrestricted());
--> statement-breakpoint
CREATE POLICY dev_outbox_system ON app.dev_outbox FOR ALL USING (app.unrestricted()) WITH CHECK (app.unrestricted());
--> statement-breakpoint

-- Privileges for the application role.
GRANT USAGE ON SCHEMA app TO bluewater_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO bluewater_app;
--> statement-breakpoint
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO bluewater_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bluewater_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON app.audit_log FROM bluewater_app;
--> statement-breakpoint

-- Supabase's browser-facing roles must never reach this schema.
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA app FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA app FROM anon, authenticated';
  END IF;
END $$;
