#!/usr/bin/env bash
# start-local.sh — Run all local development services (Express API, Webpack Frontend, Indexer)

set -euo pipefail

echo "==> Checking local PostgreSQL and Redis..."
if ! lsof -i :5432 >/dev/null; then
  echo "❌ Error: PostgreSQL is not running on port 5432 natively."
  echo "Please start PostgreSQL before running this script."
  exit 1
fi

if ! lsof -i :6379 >/dev/null; then
  echo "❌ Error: Redis is not running on port 6379 natively."
  echo "Please start Redis before running this script."
  exit 1
fi

echo "==> PostgreSQL and Redis are online!"

# Create logs directory
mkdir -p logs

# Clean up function
cleanup() {
  echo ""
  echo "==> Stopping background local services..."
  if [ -n "${API_PID:-}" ]; then kill "$API_PID" 2>/dev/null || true; fi
  if [ -n "${INDEXER_PID:-}" ]; then kill "$INDEXER_PID" 2>/dev/null || true; fi
  if [ -n "${FRONTEND_PID:-}" ]; then kill "$FRONTEND_PID" 2>/dev/null || true; fi
  echo "✅ All services stopped."
}
trap cleanup EXIT

echo "==> Starting API Server on port 3000 (logs: logs/api.log)..."
npm run dev:medical > logs/api.log 2>&1 &
API_PID=$!

echo "==> Starting Blockchain Indexer (logs: logs/indexer.log)..."
npm run dev:indexer > logs/indexer.log 2>&1 &
INDEXER_PID=$!

echo "==> Starting Webpack Dev Server on port 8080..."
npm start &
FRONTEND_PID=$!

echo "==> Services are running. Press Ctrl+C to terminate all services."
wait
