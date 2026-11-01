#!/usr/bin/env bash
# Health probe for cron. Alerts on the transition into failure, not on every tick.
#
#   */5 * * * * /home/gameclaw/betting/deploy/scripts/monitor.sh >> /var/log/gameclaw-monitor.log 2>&1
#
# Deliberately not Prometheus and Grafana. Those are 400-600 MB of RAM on a box chosen for being
# cheap, to watch three containers. This answers the only questions that matter unattended - is it
# serving, is the database reachable, is the disk filling - and says so once when the answer
# changes.
set -uo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

STATE=${STATE_FILE:-/tmp/gameclaw-monitor.state}
problems=()

health=$(curl -fsS --max-time 20 "https://${API_DOMAIN}/api/v1/health" 2>/dev/null || echo "")
if [ -z "$health" ]; then
  problems+=("API unreachable at https://${API_DOMAIN}/api/v1/health")
else
  status=$(printf '%s' "$health" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')
  [ "$status" = "ok" ] || problems+=("API health reports '$status'")
fi

for svc in db api caddy; do
  cid=$(docker compose ps -q "$svc" 2>/dev/null || true)
  if [ -z "$cid" ]; then problems+=("container $svc is not running"); continue; fi
  st=$(docker inspect -f '{{.State.Status}}' "$cid" 2>/dev/null || echo unknown)
  [ "$st" = "running" ] || problems+=("container $svc is $st")
done

use=$(df --output=pcent / | tail -1 | tr -dc '0-9')
[ "${use:-0}" -ge 85 ] && problems+=("disk is ${use}% full")

newest=$(ls -1t backups/gameclaw-*.dump.age 2>/dev/null | head -1 || true)
if [ -z "$newest" ]; then
  problems+=("no backup has ever been written")
else
  age_h=$(( ( $(date +%s) - $(stat -c %Y "$newest") ) / 3600 ))
  [ "$age_h" -gt 36 ] && problems+=("newest backup is ${age_h}h old")
fi

now="${problems[*]:-}"
was=$(cat "$STATE" 2>/dev/null || echo "")
printf '%s\n' "$now" > "$STATE"

ts=$(date -u +%FT%TZ)
if [ -z "$now" ]; then
  echo "$ts ok"
  # Say so once when it comes back, so a resolved alert is not silence.
  if [ -n "$was" ] && [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    curl -fsS -m 15 -X POST -H 'content-type: application/json' \
      --data "{\"text\":\"GameClaw recovered at $ts\"}" "$ALERT_WEBHOOK_URL" >/dev/null || true
  fi
  exit 0
fi

echo "$ts PROBLEM: $now"
if [ "$now" != "$was" ] && [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
  curl -fsS -m 15 -X POST -H 'content-type: application/json' \
    --data "{\"text\":\"GameClaw $ts: $now\"}" "$ALERT_WEBHOOK_URL" >/dev/null || true
fi
exit 1
