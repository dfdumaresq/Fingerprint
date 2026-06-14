#!/usr/bin/env bash
# scripts/deploy-vps.sh — Automates the local cross-compile and VPS deployment pipeline for the active branch

# Exit on any error, undefined variable, or pipeline failure
set -euo pipefail

PROJECT_ROOT="/Users/dfdumaresq/Projects/Fingerprint"
cd "$PROJECT_ROOT"

# Get current git branch
CURRENT_BRANCH=$(git branch --show-current)
echo "==> Step 1: Synchronizing local and remote Git for branch '$CURRENT_BRANCH'..."
git pull origin "$CURRENT_BRANCH" --ff-only
ssh vps "cd ~/app && git fetch origin && git checkout $CURRENT_BRANCH && git pull --ff-only origin $CURRENT_BRANCH"

# Download the remote .env to a temp local file
ssh vps "cat ~/app/.env" > .env.vps

# Parse variables locally (deleting any enclosing single/double quotes)
PROD_API_KEY=$(grep ^API_KEY= .env.vps | cut -d= -f2- | tr -d "'\"")
PROD_RPC_URL=$(grep ^REACT_APP_SEPOLIA_RPC_URL= .env.vps | cut -d= -f2- | tr -d "'\"")
PROD_CONTRACT=$(grep ^REACT_APP_SEPOLIA_CONTRACT_ADDRESS= .env.vps | cut -d= -f2- | tr -d "'\"")
PROD_CHAIN_ID=$(grep ^REACT_APP_SEPOLIA_CHAIN_ID= .env.vps | cut -d= -f2- | tr -d "'\"")

# Clean up temp file
rm .env.vps

echo "==> Step 3: Cross-compiling Docker images locally for linux/amd64..."
docker build --platform linux/amd64 -t fingerprint-api:latest -f Dockerfile .
docker build --platform linux/amd64 \
  --build-arg API_KEY="$PROD_API_KEY" \
  --build-arg REACT_APP_SEPOLIA_RPC_URL="$PROD_RPC_URL" \
  --build-arg REACT_APP_SEPOLIA_CONTRACT_ADDRESS="$PROD_CONTRACT" \
  --build-arg REACT_APP_SEPOLIA_CHAIN_ID="$PROD_CHAIN_ID" \
  -t fingerprint-nginx:latest -f Dockerfile.nginx .

echo "==> Step 4 & 5: Archiving and compressing images..."
docker save fingerprint-api:latest | gzip > fingerprint-api.tar.gz
docker save fingerprint-nginx:latest | gzip > fingerprint-nginx.tar.gz

echo "==> Step 6: Uploading compressed tarballs to VPS..."
scp fingerprint-api.tar.gz fingerprint-nginx.tar.gz vps:/home/auditadmin/

echo "==> Step 7 & 8: Loading images and recreating containers on VPS..."
ssh vps "
  echo '   Loading API image...'
  docker load < ~/fingerprint-api.tar.gz &&
  echo '   Loading Nginx image...'
  docker load < ~/fingerprint-nginx.tar.gz &&
  echo '   Restoring Nginx HTTPS configuration...' &&
  cp ~/app/nginx/nginx-https.conf ~/app/nginx/nginx.conf &&
  echo '   Recreating containers...'
  cd ~/app && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --force-recreate
"

echo "==> Step 9: Cleaning up local and remote archive files..."
ssh vps "rm ~/fingerprint-api.tar.gz ~/fingerprint-nginx.tar.gz"
rm fingerprint-api.tar.gz fingerprint-nginx.tar.gz

echo "🎉 Deployment Completed Successfully! Verifying container health on VPS:"
ssh vps "docker compose -f ~/app/docker-compose.yml ps"
