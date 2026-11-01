#!/usr/bin/env bash
# Checks the configuration before anything is built or started. Run from deploy/.
#
# Exists because every one of these has been a real deployment failure somewhere: a missing
# variable that only surfaces as a 500 on the first request, a secret committed by accident, a
# compose file that does not parse, a domain that does not point here yet.
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
ok()   { printf '  \033[32mok\033[0m    %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=1; }
warn() { printf '  \033[33mwarn\033[0m  %s\n' "$1"; }

echo "== .env =="
if [ ! -f .env ]; then
  bad ".env is missing (cp .env.example .env and fill it in)"
else
  ok ".env present"
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
  required=(API_DOMAIN ACME_EMAIL POSTGRES_SUPERUSER POSTGRES_SUPERUSER_PASSWORD
            OWNER_DB_PASSWORD APP_DB_PASSWORD BACKUP_AGE_RECIPIENT NEXT_PUBLIC_SITE_URL
            AUTH_JWT_SECRET IP_HASH_SALT CRON_SECRET GOOGLE_WEB_CLIENT_ID API_FOOTBALL_KEY)
  for k in "${required[@]}"; do
    v=${!k:-}
    if [ -z "$v" ]; then bad "$k is empty"; else ok "$k set"; fi
  done
  for k in POSTGRES_SUPERUSER_PASSWORD OWNER_DB_PASSWORD APP_DB_PASSWORD AUTH_JWT_SECRET IP_HASH_SALT CRON_SECRET; do
    v=${!k:-}
    [ -n "$v" ] && [ ${#v} -lt 24 ] && warn "$k is only ${#v} characters; use: openssl rand -base64 32"
  done
  # Three distinct passwords. Reusing one defeats the point of separate roles.
  if [ -n "${OWNER_DB_PASSWORD:-}" ] && [ "${OWNER_DB_PASSWORD:-}" = "${APP_DB_PASSWORD:-}" ]; then
    bad "OWNER_DB_PASSWORD and APP_DB_PASSWORD are identical - the roles are then only nominally separate"
  fi
  case "${BACKUP_AGE_RECIPIENT:-}" in
    age1*) ok "BACKUP_AGE_RECIPIENT looks like an age public key" ;;
    "")    ;;
    AGE-SECRET-KEY*) bad "BACKUP_AGE_RECIPIENT is a PRIVATE key. Use the public one (age1...) and keep the private key off this host" ;;
    *)     bad "BACKUP_AGE_RECIPIENT does not look like an age public key" ;;
  esac
  case "${NEXT_PUBLIC_SITE_URL:-}" in
    */) bad "NEXT_PUBLIC_SITE_URL has a trailing slash" ;;
    https://*) ok "NEXT_PUBLIC_SITE_URL looks right" ;;
    *) bad "NEXT_PUBLIC_SITE_URL must be an https origin" ;;
  esac
fi

echo "== secrets are not in git =="
if git -C .. check-ignore -q deploy/.env 2>/dev/null; then ok "deploy/.env is gitignored"
else bad "deploy/.env is NOT gitignored - add it before committing anything"; fi
if git -C .. ls-files --error-unmatch deploy/.env >/dev/null 2>&1; then
  bad "deploy/.env is TRACKED BY GIT - remove it from the index now"
else ok "deploy/.env is not tracked"; fi

echo "== compose =="
if command -v docker >/dev/null 2>&1; then
  if docker compose config >/dev/null 2>&1; then ok "docker-compose.yml parses and resolves"
  else bad "docker compose config failed:"; docker compose config 2>&1 | tail -5 | sed 's/^/        /'; fi
else warn "docker not installed here; skipping compose validation"; fi

echo "== dns =="
if [ -n "${API_DOMAIN:-}" ] && command -v getent >/dev/null 2>&1; then
  ips=$(getent ahostsv4 "$API_DOMAIN" 2>/dev/null | awk '{print $1}' | sort -u | paste -sd, -)
  if [ -n "$ips" ]; then ok "$API_DOMAIN resolves to $ips"
  else warn "$API_DOMAIN does not resolve yet - Let's Encrypt will fail until it does"; fi
fi

echo
[ "$fail" -eq 0 ] && echo "  preflight passed." || echo "  preflight FAILED - fix the items above."
exit "$fail"
