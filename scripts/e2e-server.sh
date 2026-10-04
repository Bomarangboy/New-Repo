#!/usr/bin/env bash
# Starts an isolated app instance for browser tests: fresh database, sample data, port 3100.
set -euo pipefail
cd "$(dirname "$0")/.."
export APP_ENV=test AUTH_PROVIDER=local APP_BASE_URL=http://localhost:3100 SYSTEM_EMAIL_TRANSPORT=dev-outbox LIVE_SENDING_ENABLED=false
export ENCRYPTION_KEY="ZTJlLWtleS1lMmUta2V5LWUyZS1rZXktZTJlLWtleTE="
export DATABASE_URL=postgres://bluewater_app:bluewater_app_local@localhost:5432/bluewater_e2e
export DATABASE_MIGRATION_URL=postgres://bluewater_owner:bluewater_owner_local@localhost:5432/bluewater_e2e
npx tsx scripts/reset-local-db.ts bluewater_e2e
npx tsx scripts/seed.ts
exec npx next start -p 3100
