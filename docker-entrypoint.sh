#!/bin/sh
set -e

echo "==> Initialising base schema (agents, indexer_state)..."
node scripts/init-db.js

echo "==> Initialising activation audit schema..."
node scripts/migrate-activation-audit.js

echo "==> Initialising medical schema + seeding scenarios..."
node scripts/init-medical-db.js

echo "==> Starting API server..."
exec npx ts-node src/api/server.ts
