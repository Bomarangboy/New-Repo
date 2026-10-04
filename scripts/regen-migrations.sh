#!/usr/bin/env bash
# Pre-release helper ONLY: rebuilds 0000/0001 from schema.ts while no database has
# applied them yet. After the first staging/production deploy, never use this —
# add new migrations with `npm run db:generate` instead.
set -euo pipefail
cd "$(dirname "$0")/.."
cp drizzle/0001_security.sql /tmp/bw_security.sql
rm -rf drizzle/0000_init.sql drizzle/0001_security.sql drizzle/meta
npx drizzle-kit generate --name init
npx drizzle-kit generate --custom --name security
cp /tmp/bw_security.sql drizzle/0001_security.sql
