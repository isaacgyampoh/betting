#!/usr/bin/env bash
# Nightly encrypted dump. Runs inside the backup container, which has pg_dump and age.
#
#   docker compose --profile tools run --rm backup
#
# Public-key encryption, deliberately: this host holds only BACKUP_AGE_RECIPIENT, so it can write
# backups and cannot read them. Keep the private key somewhere else - a VPS that gets compromised
# must not be able to decrypt its own backup history.
set -euo pipefail

: "${PGHOST:?}" "${PGDATABASE:?}" "${PGUSER:?}" "${PGPASSWORD:?}" "${BACKUP_AGE_RECIPIENT:?}"

DIR=${BACKUP_DIR:-/backups}
KEEP_DAILY=${KEEP_DAILY:-7}
KEEP_WEEKLY=${KEEP_WEEKLY:-4}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BASE="$DIR/gameclaw-$STAMP"

mkdir -p "$DIR"

echo "[backup] dumping $PGDATABASE from $PGHOST"
# -Fc is the custom format: compressed, and pg_restore can filter it per table on the way back in.
# A failure here must not leave a truncated .age file behind that looks like a backup, so the dump
# lands on disk first and is only encrypted once pg_dump has exited 0.
pg_dump --format=custom --no-owner --no-acl --file "$BASE.dump"

SIZE=$(stat -c %s "$BASE.dump")
# A dump of this schema is tens of kilobytes even when nearly empty; anything smaller than 20 KB
# means pg_dump wrote a header and gave up, which has exited 0 before now.
if [ "$SIZE" -lt 20480 ]; then
  echo "[backup] FAILED: dump is only $SIZE bytes, refusing to keep it" >&2
  rm -f "$BASE.dump"
  exit 1
fi

# A manifest of row counts, so a restore can be checked against what was taken rather than against
# an assumption. Written before encryption and kept in clear: it is counts, not data.
echo "[backup] recording row counts"
psql -At -F $'\t' -c "
  select relname, n_live_tup
  from pg_stat_user_tables
  where schemaname = 'public'
  order by relname
" > "$BASE.counts.tsv"

echo "[backup] encrypting to $BACKUP_AGE_RECIPIENT"
age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" --output "$BASE.dump.age" "$BASE.dump"
rm -f "$BASE.dump"          # the cleartext copy does not stay on the box

echo "[backup] wrote $(basename "$BASE.dump.age") ($(stat -c %s "$BASE.dump.age") bytes)"

# Rotation: keep the newest KEEP_DAILY, plus one per ISO week for KEEP_WEEKLY weeks.
echo "[backup] rotating (keeping $KEEP_DAILY daily, $KEEP_WEEKLY weekly)"
mapfile -t all < <(ls -1 "$DIR"/gameclaw-*.dump.age 2>/dev/null | sort -r)
declare -A keep_week
keep=()
for i in "${!all[@]}"; do
  f=${all[$i]}
  if [ "$i" -lt "$KEEP_DAILY" ]; then keep+=("$f"); continue; fi
  # gameclaw-20261101T030000Z.dump.age -> 20261101
  d=$(basename "$f" | sed -E 's/gameclaw-([0-9]{8})T.*/\1/')
  wk=$(date -u -d "$d" +%G-W%V 2>/dev/null || echo "")
  if [ -n "$wk" ] && [ -z "${keep_week[$wk]:-}" ] && [ "${#keep_week[@]}" -lt "$KEEP_WEEKLY" ]; then
    keep_week[$wk]=$f
    keep+=("$f")
  fi
done
for f in "${all[@]}"; do
  if ! printf '%s\n' "${keep[@]}" | grep -qxF "$f"; then
    echo "[backup] pruning $(basename "$f")"
    rm -f "$f" "${f%.dump.age}.counts.tsv"
  fi
done

echo "[backup] done. $(ls -1 "$DIR"/gameclaw-*.dump.age 2>/dev/null | wc -l) backups on disk."
echo "[backup] REMINDER: these are only as good as the off-box copy. See deploy/README.md."
