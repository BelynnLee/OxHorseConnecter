# Claude Code Workbench Quickstart

This guide starts from a fresh clone. It covers local development for Agent Workbench with the Codex and Claude Code providers.

## Requirements

- Windows PowerShell or a POSIX shell. The checked-in test scripts are PowerShell-first.
- Node.js 18 or newer. The root `package.json` pins `pnpm@10.11.1`.
- Corepack enabled: `corepack enable`.
- Git available on `PATH`; Workbench uses it for baselines, session-scoped diff, and safe discard.
- SQLite support through `better-sqlite3`; no external database server is required.
- Claude Code CLI installed for real Claude Code runs. The UI can load without it, but provider detection will mark Claude Code unavailable.
- Codex CLI installed if you want to run the Codex provider.

## Install

```powershell
corepack enable
corepack pnpm install
```

Copy the sample environment and edit local values:

```powershell
Copy-Item .env.example .env
```

The repository-root `.env` is the only file used by Host runtime config, the configuration page, and bootstrap persistence. Do not create or deploy `apps/.env`.

For a first local run, keep these values aligned:

```dotenv
PUBLIC_BASE_URL=http://127.0.0.1:3001
REQUIRE_HTTPS=false
AUTH_COOKIE_SECURE=false
CORS_ORIGINS=http://127.0.0.1:5173,http://localhost:5173
VITE_API_URL=http://127.0.0.1:3001
DB_PATH=./data/rac.db
ALLOWED_WORK_DIR=./data/workspaces
CLAUDE_CODE_COMMAND=claude
CLAUDE_CODE_SKIP_PERMISSIONS=false
```

Set real secrets only in `.env` or the process environment. Do not put secrets in `.env.example`.

## Database

The host initializes the SQLite schema on startup through the storage package. There is no separate migration command for this release candidate.

For an existing database, back it up before starting a new build. The current schema includes Agent Workbench tables for commands, permission rules/hits, compact summaries, usage, and session baselines.

## Claude Code CLI

Verify the CLI before starting a real Claude Code session:

```powershell
claude --version
claude --help
claude -p --help
claude --print --help
claude resume --help
claude mcp --help
```

Configure the command or absolute path with `CLAUDE_CODE_COMMAND`. `CLAUDE_CODE_SKIP_PERMISSIONS` defaults to `false` and should stay false except in trusted disposable development worktrees.

Workbench does not take over Claude Code official runtime tool approval. It provides a Workbench approval gate for prompt-level and `/init-claude` actions.

## Start The Backend

```powershell
corepack pnpm build:packages
corepack pnpm build:host
corepack pnpm dev:host
```

Expected health endpoint:

```text
http://127.0.0.1:3001/api/health
```

## Start The Frontend

In a second terminal:

```powershell
corepack pnpm dev:web
```

Open:

```text
http://127.0.0.1:5173
```

Default bootstrap credentials come from `.env` (`ADMIN_USERNAME` and `ADMIN_PASSWORD`).

## Run Tests

```powershell
corepack pnpm verify:mvp
corepack pnpm test:integration
corepack pnpm run test:e2e:workbench
corepack pnpm verify:workbench
git diff --check
```

`verify:mvp` builds shared packages, the host, and the web frontend. `test:integration` starts a temporary host and runs backend smoke coverage. `test:e2e:workbench` starts host and web servers and runs the browser Workbench suite.

There is currently no package-level lint script in the workspace.

The `apps/ai-service` FastAPI service is optional. Run `corepack pnpm test:ai` only when RAG indexing, evaluation helpers, or failure analysis are part of the deployment and `uv` is installed.

## Common Issues

**Claude Code provider is unavailable**

Check `CLAUDE_CODE_COMMAND`, run `claude --version`, and restart the host. If the CLI is not installed or not on `PATH`, detection will keep the provider disabled.

**Login cookie is not sent in local development**

Use `REQUIRE_HTTPS=false`, `AUTH_COOKIE_SECURE=false`, and a `PUBLIC_BASE_URL` matching the API URL.

**Workbench says the worktree is dirty**

This is expected when pre-existing changes exist. Confirm only when you want the session baseline to preserve them. Safe discard only targets session-owned changes.

**Commands tab misses a command**

Best-effort command parsing depends on provider stream and tool payloads. The raw logs remain inspectable.

**Usage looks approximate**

Estimated usage is shown when provider usage fields are unavailable. Actual Claude usage includes uncached input, cache write, cache read, output, and total tokens. Cost is shown only when `AGENT_MODEL_PRICING_JSON` includes all rates needed for the observed token types.

**`/init-claude` partially writes files**

`/init-claude` writes are not a filesystem transaction. Existing files are not overwritten; created session-owned files can be reviewed in Diff and safely discarded.
