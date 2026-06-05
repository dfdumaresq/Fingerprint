#!/bin/sh
set -e

echo "==> Initialising database schema..."
node scripts/init-medical-db.js

echo "==> Starting API server..."
exec npx ts-node src/api/server.ts
