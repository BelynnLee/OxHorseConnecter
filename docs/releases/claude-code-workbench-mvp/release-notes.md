> Status: Archived reference. This document is retained for historical context; current implementation truth lives in README.md and docs/README.md.

# Claude Code Workbench MVP Release Notes

## New Capabilities

- Claude Code provider selection inside Agent Workbench with CLI capability detection.
- Provider-scoped model selection for Codex and Claude Code.
- Session baseline capture for git worktrees.
- Session-scoped Diff, file list, and safe discard.
- Workbench approval gate for prompt-level checks and `/init-claude` file creation.
- Permission rules with `deny > ask > allow` precedence and recent hits.
- `/init-claude` scanning and template creation for missing `CLAUDE.md` and `.claude/*` files.
- Commands tab with Best-effort command parsing, risk level, previews, and details.
- Compact summaries stored as Workbench-local prompt context.
- Markdown export with default redaction and opt-in full diff/sanitized raw logs.
- Actual usage display when provider usage is available; Estimated usage otherwise.

## Safety Design

- Dangerous skip mode is off by default (`CLAUDE_CODE_SKIP_PERMISSIONS=false`).
- Workbench does not take over Claude Code official runtime tool approval.
- `/init-claude` does not overwrite existing files; merge-needed files are surfaced for manual review.
- `/init-claude` writes are not a filesystem transaction. Partial failures are reported and session-owned created files can be reviewed or safely discarded.
- Safe discard is based on session baseline data and avoids deleting baseline dirty/untracked files.
- Default export omits full raw logs and full diff.
- Logs, command previews, and exports are sanitized for common secrets, authorization headers, tokens, passwords, private keys, database URLs, and `.env`-style values.

## Verified Commands

```powershell
pnpm verify:mvp
pnpm test:integration
corepack pnpm run test:e2e:workbench
pnpm verify:workbench
git diff --check
```

Claude Code CLI detection checklist:

```powershell
claude --version
claude --help
claude -p --help
claude --print --help
claude resume --help
claude mcp --help
```

## Known Limitations

- Claude Code official runtime tool approval is not connected.
- Best-effort command parsing can miss commands if the provider stream does not expose them as structured tool payloads.
- Estimated usage is approximate and should not be treated as billing data. Actual usage includes cache read/write token breakdown when provider usage is available.
- Cost appears only when `AGENT_MODEL_PRICING_JSON` covers the observed token types.
- `/init-claude` writes are not transactional.
- Full diff and sanitized raw-log exports are opt-in and can be large for very long sessions.
- No package-level lint script is configured in this workspace.

## Upgrade Notes

- No new migration file is required for this release candidate; startup initializes the current SQLite schema.
- Back up existing SQLite databases before deploying.
- Confirm these tables exist after startup: `agent_commands`, `agent_permission_rules`, `agent_permission_hits`, `agent_session_summaries`, `agent_usage`, `provider_capabilities`, and `session_baselines`.
- Keep `CLAUDE_CODE_SKIP_PERMISSIONS=false` unless an operator explicitly enables it in a trusted disposable worktree.
- Configure `CLAUDE_CODE_COMMAND` to the local Claude Code CLI command or absolute path.
- Configure `AGENT_MODEL_PRICING_JSON` only with approved pricing values.

## Rollback

1. Disable Claude Code by setting `CLAUDE_CODE_ENABLED=false` or pointing `CLAUDE_CODE_COMMAND` to an invalid command.
2. Keep Codex enabled and continue using existing Workbench session history.
3. Stop accepting new Claude Code edit sessions.
4. Preserve the SQLite database for audit/export access.
5. Restore the previous app build and database backup if schema startup fails.
6. Manually inspect worktree changes before discarding anything after rollback.

## Next Steps

- Add package-level lint only when the project chooses a concrete linter.
- Add deeper provider-specific command parsing fixtures as Claude Code stream formats evolve.
- Add export pagination or asynchronous export for unusually large audit bundles.
- Expand manual acceptance into CI-backed smoke coverage for real Claude Code CLI environments.
- Improve split diff UI without changing the session baseline contract.

