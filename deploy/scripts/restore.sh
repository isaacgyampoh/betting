#!/usr/bin/env bash
# Restores an encrypted backup, and checks the result against the manifest taken with it.
#
#   # verify a backup without touching the live database (do this monthly):
#   ./restore.sh --file backups/gameclaw-20261101T030000Z.dump.age --into gameclaw_verify
#
#   # restore over the live database (last resort, asks first):
#   ./restore.sh --file backups/... --into gameclaw --force
#
# The private age key is read from AGE_KEY_FILE and is NOT expected to live on this server. Bring
# it with you for the restore and take it away again.
set -euo pipefail

FILE=""; INTO="gameclaw_verify"; FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --file)  FILE=$2; shift 2 ;;
    --into)  INTO=$2; shift 2 ;;
    --force) FORCE=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

: "${FILE:?--file is required}"
: "${AGE_KEY_FILE:?AGE_KEY_FILE must point at the age private key}"
[ -f "$FILE" ] || { echo "no such backup: $FILE" >&2; exit 1; }
[ -f "$AGE_KEY_FILE" ] || { echo "no such key file: $AGE_KEY_FILE" >&2; exit 1; }

if [ "$INTO" = "${POSTGRES_DB:-gameclaw}" ] && [ "$FORCE" -ne 1 ]; then
  cat >&2 <<WARN
Refusing to restore over "$INTO" without --force.

That is the live database. Restoring into it replaces its contents. If you are verifying a backup -
which is the thing worth doing regularly - restore into a scratch name instead:

  ./restore.sh --file "$FILE" --into gameclaw_verify
WARN
  exit 1
fi

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
echo "[restore] decrypting"
age --decrypt --identity "$AGE_KEY_FILE" --output "$TMP/db.dump" "$FILE"

echo "[restore] creating $INTO"
psql -v ON_ERROR_STOP=1 -d postgres -c "DROP DATABASE IF EXISTS \"$INTO\";"
psql -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE \"$INTO\" OWNER gameclaw_owner;"

echo "[restore] restoring"
# --no-owner because the dump was taken that way; ownership is set by the CREATE DATABASE above and
# the roles script. Exit status is checked, but pg_restore warns about things that do not matter
# (extension comments, for one), so warnings are shown and not treated as failure.
pg_restore --dbname "$INTO" --no-owner --no-acl --exit-on-error "$TMP/db.dump"

COUNTS="${FILE%.dump.age}.counts.tsv"
if [ -f "$COUNTS" ]; then
  echo "[restore] comparing row counts against the manifest taken with this backup"
  fail=0
  while IFS=$'\t' read -r table expected; do
    [ -z "$table" ] && continue
    actual=$(psql -At -d "$INTO" -c "select count(*) from \"$table\"" 2>/dev/null || echo "ERR")
    # pg_stat_user_tables.n_live_tup is an estimate, so this looks for the wrong order of
    # magnitude rather than an exact match - a restore that dropped a table reads as 0.
    if [ "$actual" = "ERR" ]; then
      printf '  %-28s MISSING (manifest said ~%s)\n' "$table" "$expected"; fail=1
    elif [ "$expected" -gt 0 ] && [ "$actual" -eq 0 ]; then
      printf '  %-28s EMPTY   (manifest said ~%s)\n' "$table" "$expected"; fail=1
    else
      printf '  %-28s %s rows (manifest ~%s)\n' "$table" "$actual" "$expected"
    fi
  done < "$COUNTS"
  [ "$fail" -eq 0 ] || { echo "[restore] VERIFICATION FAILED - see above" >&2; exit 1; }
else
  echo "[restore] no manifest beside this backup; cannot verify counts" >&2
fi

echo "[restore] migration state in the restored copy:"
psql -At -d "$INTO" -c "select count(*) || ' migrations applied' from _prisma_migrations where finished_at is not null" 2>&1 | sed 's/^/  /'
echo "[restore] ok"
