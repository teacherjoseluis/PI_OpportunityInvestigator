# Database setup (Phase 0)

PostgreSQL is the system of record for research cases, evidence, scores, and audit history. n8n workflows come after this database is running and reachable.

## What this repo provides

| Path | Purpose |
|---|---|
| `docker-compose.yml` | Postgres 16 + one-shot migrate service |
| `db/migrations/*.sql` | Versioned schema (lexical order) |
| `db/scripts/docker-migrate.sh` | Applies pending migrations inside Compose |
| `.env.example` | Non-secret environment template |

## Local setup (Windows or Linux)

1. Copy environment file and set a strong password:

```bash
cp .env.example .env
```

2. Start Postgres:

```bash
docker compose up -d postgres
```

3. Apply migrations:

```bash
docker compose --profile migrate run --rm migrate
```

4. Verify:

```bash
docker compose exec postgres psql -U pii_app -d pii_research -c "\dt"
docker compose exec postgres psql -U pii_app -d pii_research -c "SELECT filename, applied_at FROM schema_migrations;"
```

Expected: all Phase 0 tables plus `schema_migrations` with `001_initial_schema.sql`.

## VPS setup

1. Clone or pull this repository on the VPS.
2. Create `.env` from `.env.example` with production passwords (do not reuse the local password).
3. Start and migrate the same way:

```bash
docker compose up -d postgres
docker compose --profile migrate run --rm migrate
```

4. Confirm the host firewall allows your n8n Cloud egress IP (or VPN) to `POSTGRES_PORT`, preferably with TLS termination or an SSH tunnel. Prefer not exposing Postgres to the entire internet.

5. From n8n, create a Postgres credential pointing at:

- Host: your VPS public or private hostname
- Port: value of `POSTGRES_PORT` (default `5432`)
- Database: `pii_research`
- User / password: from `.env`
- SSL: enable when traffic crosses a public network

Use a dedicated research database. If n8n ever shares this Postgres server, give n8n its own database and credentials.

## Backup and restore (minimum)

Backup:

```bash
docker compose exec -T postgres pg_dump -U pii_app -d pii_research -Fc > pii_research_$(date +%Y%m%d).dump
```

Restore (destructive to target DB — use carefully):

```bash
docker compose exec -T postgres pg_restore -U pii_app -d pii_research --clean --if-exists < pii_research_YYYYMMDD.dump
```

Automate nightly dumps on the VPS before Phase 1 goes live.

## Adding a migration later

1. Add `db/migrations/002_something.sql`.
2. Commit and pull on the VPS.
3. Run `docker compose --profile migrate run --rm migrate`.

Already-applied files are skipped via `schema_migrations`.

## Out of scope for this phase

- n8n workflows
- Object storage for raw filings
- Redis / queue mode
- Live credentials in git
