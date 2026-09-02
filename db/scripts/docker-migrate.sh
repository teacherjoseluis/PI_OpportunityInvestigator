#!/bin/sh
# Apply SQL migrations in lexical order. Tracks applied filenames in
# schema_migrations. Intended to run inside the compose "migrate" service.
set -eu

HOST="${DATABASE_HOST:-postgres}"
PORT="${DATABASE_PORT:-5432}"
USER="${POSTGRES_USER:?POSTGRES_USER is required}"
DB="${POSTGRES_DB:?POSTGRES_DB is required}"

echo "Waiting for Postgres at ${HOST}:${PORT}..."
until pg_isready -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" >/dev/null 2>&1; do
  sleep 1
done

psql -v ON_ERROR_STOP=1 -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SQL

for file in /migrations/*.sql; do
  [ -e "$file" ] || continue
  name=$(basename "$file")
  already=$(psql -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -Atc \
    "SELECT 1 FROM schema_migrations WHERE filename = '${name}'")
  if [ "$already" = "1" ]; then
    echo "skip  ${name}"
    continue
  fi
  echo "apply ${name}"
  psql -v ON_ERROR_STOP=1 -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -f "$file"
  psql -v ON_ERROR_STOP=1 -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -c \
    "INSERT INTO schema_migrations (filename) VALUES ('${name}')"
done

echo "Migrations complete."
