# Production Deployment Runbook

This runbook covers the `dev` workspace Remote Agent Console deployment.

For a step-by-step Chinese deployment tutorial, see [`deployment-guide.md`](deployment-guide.md).

## Build Gate

Run these from the repository root before promoting a build:

```powershell
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm run ci
git diff --check
```

`pnpm run ci` is the release gate for the Host and Web console. It runs:

- `pnpm verify:mvp` — full TypeScript build of all packages, host, and web
- `pnpm lint` — ESLint with `--max-warnings=0`
- `pnpm audit --prod` (in CI workflow) — fails on known vulnerabilities
- All unit / integration / E2E suites

The AI service is optional for production unless RAG indexing, evaluation helpers, or failure analysis are part of the deployment.

## Required Environment

Use one repository-root `.env` file. **Do not deploy `apps/.env`**; runtime config, the configuration page, and bootstrap persistence all use the root `.env`.

A complete production template lives at [`.env.production.example`](../.env.production.example) — copy it to `.env` and fill in every `<CHANGE_ME_*>` placeholder. Required production values:

```dotenv
NODE_ENV=production
HOST_HOSTNAME=127.0.0.1
PUBLIC_BASE_URL=https://console.example.com
REQUIRE_HTTPS=true
TRUST_PROXY=true
CORS_ORIGINS=https://console.example.com
AGENT_SECURITY_PROFILE=strict
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<strong-admin-password>
JWT_SECRET=<strong-random-secret-at-least-32-chars>
PROVIDER_SECRET_KEY=<strong-random-secret-at-least-32-chars>
REMOTE_REGISTRATION_TOKEN=<strong-random-secret-at-least-32-chars>
AUTH_COOKIE_SECURE=true
AUTH_COOKIE_SAME_SITE=lax
ALLOW_QUERY_TOKEN_AUTH=false
CODEX_FULL_AUTO=false
CLAUDE_CODE_SKIP_PERMISSIONS=false
DB_PATH=./data/rac.db
ALLOWED_WORK_DIR=./data/workspaces
# On remote worker machines, set a worker-local controlled workspace root.
# If unset, the worker falls back to ALLOWED_WORK_DIR.
RAC_REMOTE_ALLOWED_WORK_DIR=/srv/rac-worker/workspaces
RAC_REMOTE_HEARTBEAT_INTERVAL_MS=3000
RAC_REMOTE_MAX_RECONNECT_DELAY_MS=30000
RAC_REMOTE_BRIDGE_PING_INTERVAL_MS=15000

# Optional: enable file logging with daily rotation
LOG_FILE_PATH=./data/logs/rac-host.log
LOG_FILE_KEEP_DAYS=30
```

Keep the Host bound to `127.0.0.1` and expose it through Nginx/Caddy TLS termination. Public deployments must keep `REQUIRE_HTTPS=true`, `TRUST_PROXY=true`, `AUTH_COOKIE_SECURE=true`, and `ALLOW_QUERY_TOKEN_AUTH=false`.

## Reverse Proxy (TLS Termination)

Host should never be exposed directly on the public internet. Terminate TLS in a reverse proxy and forward to `127.0.0.1:3001`. Sample configs:

- **Nginx** — see [`docs/nginx.conf.example`](nginx.conf.example). Includes HSTS, SSE/WebSocket handling, rate-limited login.
- **Caddy** — see [`docs/Caddyfile.example`](Caddyfile.example). Auto-provisions Let's Encrypt certs.

Both samples assume:

- The built Web SPA at `apps/web/dist` is served as static files at `/var/www/rac-web` (or your equivalent).
- Host listens on `127.0.0.1:3001` with `TRUST_PROXY=true`.

## Runtime Layout

- **Host API:** build with `corepack pnpm build:host`, then run `corepack pnpm --filter @rac/host start`. Host installs `SIGTERM`/`SIGINT` handlers for graceful shutdown (10-second timeout).
- **Web console:** build with `corepack pnpm build:web`. Serve `apps/web/dist` from the same trusted origin configured in `CORS_ORIGINS`, or from a static host that talks to `PUBLIC_BASE_URL`. **Note:** `VITE_API_URL`, `VITE_SSE_URL`, `VITE_WS_URL` are baked into the bundle at build time.
- **SQLite:** back up the configured `DB_PATH` before every deployment and before rollback. See "Database Backups" below.
- **Remote workers:** run on the machine that should execute Codex/Claude. Set `RAC_CONTROLLER_URL`, `RAC_REMOTE_REGISTRATION_TOKEN`, and `RAC_REMOTE_ALLOWED_WORK_DIR`; after registration, store the one-time returned `RAC_REMOTE_DEVICE_ID` and `RAC_REMOTE_DEVICE_TOKEN`. A trusted worker can claim tasks only when it reports a workspace root and `workRootExists=true`. For production, run it as a supervised service using [`scripts/install-remote-worker-service.ps1`](../scripts/install-remote-worker-service.ps1) on Windows or [`docs/rac-remote-worker.service.example`](rac-remote-worker.service.example) on Linux.

## Database Backups

A backup helper ships at [`scripts/backup-db.ps1`](../scripts/backup-db.ps1) and is exposed as `pnpm db:backup`.

```powershell
# Local backup (defaults: data/backups, 7-day retention)
pnpm db:backup

# Custom retention
pnpm db:backup -- -KeepDays 30

# Compress and upload to S3 / rclone target
pnpm db:backup -- -Compress -S3Bucket s3://your-bucket/rac/
pnpm db:backup -- -Compress -RcloneTarget remote:rac-backups
```

The script prefers `sqlite3 .backup` (online, WAL-safe) and falls back to file copy. Local backups older than `-KeepDays` are pruned automatically.

Back up these items separately:

- SQLite database at `DB_PATH`.
- Root `.env` with production secrets.
- Remote worker credentials (`RAC_REMOTE_DEVICE_ID` and `RAC_REMOTE_DEVICE_TOKEN`) on each worker.
- Code repositories under `ALLOWED_WORK_DIR` / `RAC_REMOTE_ALLOWED_WORK_DIR`.

Do not treat workspace roots as disposable cache directories; they contain the working copies that executors mutate.

**Schedule a daily backup** via Windows Task Scheduler (or cron on Linux):

```
schtasks /Create /TN "RAC DB Backup" /TR "powershell -ExecutionPolicy Bypass -File C:\path\to\dev\scripts\backup-db.ps1 -Compress -S3Bucket s3://your-bucket/rac/" /SC DAILY /ST 02:00
```

## Health Monitoring

Probe `/api/health` with [`scripts/health-check.ps1`](../scripts/health-check.ps1):

```powershell
# Basic probe
pnpm health:check

# Probe production with Slack alert on failure
pnpm health:check -- -BaseUrl https://console.example.com -AlertWebhook <SLACK_WEBHOOK_URL>
```

The script returns non-zero exit codes (1=HTTP error, 2=invalid response, 3=timeout) so it integrates with Task Scheduler / cron / external monitors. For external uptime monitoring, point UptimeRobot or similar at `https://console.example.com/api/health` directly.

## Capacity Baseline

Before going live, run a quick load test against a staging environment:

```powershell
# 30s with 10 concurrent clients (default)
pnpm load:test

# Heavier load
pnpm load:test -- --duration 60 --concurrency 50

# Authenticated endpoints
pnpm load:test -- --token <jwt-from-login-response>
```

Output reports p50 / p95 / p99 latency and error rate per endpoint.

**Reference baseline** measured locally on Windows 11 (Node 22, single Host instance, SQLite, 30 s per run, `/api/health` only):

| Concurrency | RPS    | p50     | p95     | p99     | Errors |
| ----------- | ------ | ------- | ------- | ------- | ------ |
| 10          | ~5,180 | 1.4 ms  | 4.9 ms  | 7.0 ms  | 0      |
| 100         | ~6,670 | 14.4 ms | 19.8 ms | 24.8 ms | 0      |

For read-only endpoints, throughput plateaus at ~6-7 K RPS due to single-threaded Node + SQLite read locking. **SQLite begins to slow down under heavy concurrent writes** (sessions, tasks, audit events) — re-evaluate the storage backend before scaling beyond ~50 concurrently active sessions or ~100 RPS of authenticated mutating requests.

## Optional AI Service

The FastAPI service under `apps/ai-service` is optional. Enable it only when using RAG indexing, evaluation helpers, or failure analysis.

```powershell
python -m pip install uv
python -m uv run --project apps/ai-service pytest
python -m uv run --project apps/ai-service uvicorn app.main:app --host 127.0.0.1 --port 8010
```

Set `AI_SERVICE_URL` in the root `.env` when the Host should call this service.

## Rollback

1. Stop accepting new sessions.
2. Stop the Host process (sends `SIGTERM`; Host flushes pending writes within 10 s).
3. Restore the previous application build and the previous SQLite backup.
4. Restart Host and verify `/api/health` (use `pnpm health:check`).
5. Review any in-progress worktree changes manually before discarding them.
