#!/usr/bin/env bash
# Copies the Render database into this host's Postgres. Read-only against Render.
#
#   RENDER_DATABASE_URL='postgresql://…' ./scripts/migrate-from-render.sh --into gameclaw_import
#
# Nothing is written to Render and nothing is dropped there. The default target is a scratch
# database, so a rehearsal cannot touch the live local one.
#
# RENDER_DATABASE_URL must be Render's EXTERNAL connection string, and this needs Render's public
# database port to still be reachable - which is exactly the exposure being removed. So: rehearse
# this and do the final run BEFORE closing the Render firewall, or run it from a Render shell.
#
# Pass it in the environment, never as an argument: arguments are visible in `ps` to every process
# on the box.
set -euo pipefail
cd "$(dirname "$0")/.."

INTO="gameclaw_import"; FINAL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --into)  INTO=$2; shift 2 ;;
    --final) FINAL=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
: "${RENDER_DATABASE_URL:?set RENDER_DATABASE_URL in the environment}"
set -a; . ./.env; set +a

case "$RENDER_DATABASE_URL" in
  *render.com*|*dpg-*) ;;
  *) echo "RENDER_DATABASE_URL does not look like a Render connection string" >&2; exit 1 ;;
esac

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

echo "== reading the source (no writes) =="
# Version first: pg_dump refuses a newer server, and finding that out after a 40-minute dump is a
# waste of a maintenance window.
psql "$RENDER_DATABASE_URL" -At -c "select 'server: ' || version()" | sed 's/^/  /'
psql "$RENDER_DATABASE_URL" -At -c "select 'size: ' || pg_size_pretty(pg_database_size(current_database()))" | sed 's/^/  /'
psql "$RENDER_DATABASE_URL" -At -F $'\t' -c "
  select relname, n_live_tup from pg_stat_user_tables where schemaname='public' order by relname
" > "$TMP/source.counts.tsv"
echo "  tables: $(wc -l < "$TMP/source.counts.tsv")"

echo
echo "== dumping =="
# --no-owner/--no-acl: Render's role names do not exist here, and ownership is set by the roles
# script. Without these, every COMMENT and GRANT referencing the Render role fails on restore.
docker compose --profile tools run --rm -T \
  -e PGPASSWORD= \
  --entrypoint pg_dump backup \
  --format=custom --no-owner --no-acl --dbname "$RENDER_DATABASE_URL" \
  > "$TMP/render.dump"
echo "  $(stat -c %s "$TMP/render.dump") bytes"

echo
echo "== restoring into $INTO =="
if [ "$INTO" = "${POSTGRES_DB:-gameclaw}" ] && [ "$FINAL" -ne 1 ]; then
  echo "Refusing to overwrite the live local database without --final." >&2
  echo "Rehearse into a scratch name first: --into gameclaw_import" >&2
  exit 1
fi
docker compose exec -T db psql -v ON_ERROR_STOP=1 -U "$POSTGRES_SUPERUSER" -d postgres \
  -c "DROP DATABASE IF EXISTS \"$INTO\";" -c "CREATE DATABASE \"$INTO\" OWNER gameclaw_owner;"
docker compose exec -T db pg_restore -U "$POSTGRES_SUPERUSER" --dbname "$INTO" \
  --no-owner --no-acl --exit-on-error < "$TMP/render.dump"

echo
echo "== comparing row counts, source against restored =="
fail=0
while IFS=$'\t' read -r table expected; do
  [ -z "$table" ] && continue
  actual=$(docker compose exec -T db psql -At -U "$POSTGRES_SUPERUSER" -d "$INTO" \
    -c "select count(*) from \"$table\"" 2>/dev/null | tr -d '\r' || echo ERR)
  if [ "$actual" = "ERR" ]; then printf '  %-28s MISSING\n' "$table"; fail=1
  elif [ "$expected" -gt 0 ] && [ "$actual" -eq 0 ]; then printf '  %-28s EMPTY (source ~%s)\n' "$table" "$expected"; fail=1
  else printf '  %-28s %s (source ~%s)\n' "$table" "$actual" "$expected"; fi
done < "$TMP/source.counts.tsv"

echo
docker compose exec -T db psql -At -U "$POSTGRES_SUPERUSER" -d "$INTO" \
  -c "select count(*) || ' migrations applied' from _prisma_migrations where finished_at is not null" | sed 's/^/  /'
# Restoring a dump brings the schema with it, so migrate deploy should find nothing to do. If it
# wants to apply something, the dump and this checkout disagree and the cutover is not ready.
echo "  (expect 19 for this checkout; a mismatch means the dump and the code disagree)"

[ "$fail" -eq 0 ] || { echo; echo "  COMPARISON FAILED - do not cut over." >&2; exit 1; }
echo
echo "  import verified into $INTO."
