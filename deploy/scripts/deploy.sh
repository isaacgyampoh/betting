#!/usr/bin/env bash
# Builds, migrates, starts, and then proves it is actually serving. Run from deploy/ on the VPS.
#
#   ./scripts/deploy.sh
#
# Migrations run as a one-shot container before the API starts, so a failed migration stops the
# deploy with the previous version still running - the same fail-safe ordering Render's pre-deploy
# command gives us.
set -euo pipefail
cd "$(dirname "$0")/.."

./scripts/preflight.sh

set -a; . ./.env; set +a
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo dev)
export GIT_COMMIT
echo
echo "== building $GIT_COMMIT =="
docker compose build --build-arg "GIT_COMMIT=$GIT_COMMIT" api
docker compose --profile tools build migrate backup

echo
echo "== database up =="
docker compose up -d db
# Compose's service_healthy condition covers dependent services, but this script talks to the
# database itself in a moment, so it waits here too.
for i in $(seq 1 60); do
  if [ "$(docker compose ps -q db | xargs -r docker inspect -f '{{.State.Health.Status}}')" = "healthy" ]; then break; fi
  [ "$i" -eq 60 ] && { echo "database did not become healthy" >&2; docker compose logs --tail 40 db; exit 1; }
  sleep 2
done
echo "  healthy"

echo
echo "== migrations =="
docker compose --profile tools run --rm migrate

echo
echo "== starting =="
docker compose up -d api caddy

echo
echo "== waiting for the API to report healthy =="
for i in $(seq 1 60); do
  status=$(docker compose ps -q api | xargs -r docker inspect -f '{{.State.Health.Status}}')
  [ "$status" = "healthy" ] && break
  [ "$i" -eq 60 ] && { echo "API did not become healthy" >&2; docker compose logs --tail 60 api; exit 1; }
  sleep 2
done
echo "  container healthy"

# Container health only proves the process answers on loopback. This checks the whole path -
# through Caddy, with TLS - which is what a user actually traverses.
echo
echo "== through the proxy =="
if curl -fsS --max-time 30 "https://$API_DOMAIN/api/v1/health" -o /tmp/gc-health.json; then
  python3 -c "import json;d=json.load(open('/tmp/gc-health.json'))['data'];print('  status:',d['status'],'commit:',d['commit'])" 2>/dev/null \
    || head -c 200 /tmp/gc-health.json
else
  echo "  could not reach https://$API_DOMAIN/api/v1/health" >&2
  echo "  the containers are healthy, so check DNS, the firewall, and: docker compose logs caddy" >&2
  exit 1
fi

echo
docker compose ps
echo
echo "  deployed $GIT_COMMIT."
echo "  Nothing has been cut over: the Cloudflare Worker and the apps still point at Render."
echo "  See deploy/README.md, 'Cutover', for the switch."
