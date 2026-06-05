#!/usr/bin/env bash
# init-ssl.sh — Obtain the first Let's Encrypt certificate and enable HTTPS.
# Run this ONCE on the server after DNS has propagated (A record → 162.223.226.119).
#
# Usage:  bash scripts/init-ssl.sh your@email.com
#
set -euo pipefail

DOMAIN="clinicianledger.ca"
EMAIL="${1:?Usage: $0 <your@email.com>}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Creating certbot webroot directory..."
mkdir -p "$APP_DIR/certbot/www/.well-known/acme-challenge"
mkdir -p "$APP_DIR/certbot/conf"

echo "==> Ensuring nginx is running (must serve port 80 for ACME challenge)..."
docker compose -f "$APP_DIR/docker-compose.yml" up -d nginx

echo "==> Requesting Let's Encrypt certificate for $DOMAIN and www.$DOMAIN..."
docker compose -f "$APP_DIR/docker-compose.yml" run --rm certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  --force-renewal \
  -d "$DOMAIN" \
  -d "www.$DOMAIN"

echo "==> Certificate obtained. Switching nginx to HTTPS config..."
cp "$APP_DIR/nginx/nginx-https.conf" "$APP_DIR/nginx/nginx.conf"

echo "==> Reloading nginx..."
docker compose -f "$APP_DIR/docker-compose.yml" exec nginx nginx -s reload

echo ""
echo "✅ Done! clinicianledger.ca is now served over HTTPS."
echo "   Certbot will auto-renew every 12 hours via the certbot container."
