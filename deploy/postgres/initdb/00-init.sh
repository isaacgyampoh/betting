#!/bin/bash
# Creates the application and owner roles on first initialisation.
#
# The SQL lives at ../roles.sql and is mounted outside this directory on purpose. Postgres runs
# everything in /docker-entrypoint-initdb.d in alphabetical order, so a .sql file sitting next to
# this script would be executed twice - once by this script and once by the entrypoint - and the
# second pass fails on CREATE ROLE already existing, which aborts initialisation and leaves a
# half-built data directory.
#
# The passwords are passed as psql variables rather than interpolated into a command line, where
# `ps` would show them to every process on the box.
set -euo pipefail

: "${APP_DB_PASSWORD:?APP_DB_PASSWORD is required}"
: "${OWNER_DB_PASSWORD:?OWNER_DB_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  -v "app_password=$APP_DB_PASSWORD" \
  -v "owner_password=$OWNER_DB_PASSWORD" \
  -v "db_name=$POSTGRES_DB" \
  -f /opt/gameclaw/roles.sql
