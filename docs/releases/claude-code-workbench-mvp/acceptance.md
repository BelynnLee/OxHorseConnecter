> Status: Archived reference. This document is retained for historical context; current implementation truth lives in README.md and docs/README.md.

# Claude Code Workbench MVP Acceptance

This document validates the publishable MVP for Claude Code inside Agent Workbench. It focuses on Workbench UI/state safety and does not claim to test Anthropic's hosted service.

## Scope

- Provider selector and provider-scoped model UI.
- Workbench approval gate for prompt/init actions.
- Claude project initialization with session baseline and safe discard.
- Permission rules, hits, and approval history.
- Commands, export, compact summary, usage display, and inspector empty states.

## Known Limits

- Workbench does not take over Claude Code official runtime tool approval. The installed CLI help does not expose a stable Workbench-driven deferred approval protocol.
- Best-effort command parsing is based on `stream-json` `tool_use` and `tool_result` blocks.
- Estimated usage is shown when provider usage fields are unavailable; actual usage shows cache-aware token totals when provider usage includes cache fields; cost is shown only when `AGENT_MODEL_PRICING_JSON` covers the observed token types.
- Compact summaries are Workbench-local prompt context. They do not rewrite Claude Code native conversation memory.

## Automated Browser Smoke

Run:

```powershell
corepack pnpm run test:e2e:workbench
```

Expected:

- Starts host and web against `data/workbench-e2e.db`.
- Logs in through the real browser context.
- Verifies provider/model controls render.
- Verifies slash command palette search and keyboard close.
- Opens `/permissions`, creates/disables/deletes a rule.
- Opens `/diff`, `/export`, Commands, and Context inspector tabs.
- Verifies empty states and export controls render without blank panels.

## Init Claude API Smoke

Use a temporary git repository and a temporary DB.

Expected:

- No custom file rule: `/init-claude apply` creates missing `CLAUDE.md` and `.claude` templates.
- `deny` file rule for `CLAUDE.md|.claude`: apply returns denied and creates nothing.
- `ask` file rule: apply creates a pending ApprovalCard and writes nothing before approval.
- Approve: missing files are written, session-scoped diff appears, and safe discard can remove them.
- Reject: no files are written.
- Existing `CLAUDE.md` is marked merge-needed and is not overwritten.

## Manual Browser Checklist

1. Open `/workbench`.
2. Select `Claude Code` if available.
3. Confirm model list changes to Claude-compatible models.
4. Type `/per`; command palette appears.
5. Use arrow keys and Escape; selection changes and palette closes.
6. Run `/permissions`; Approvals tab opens.
7. Add command deny rule, then disable/delete it.
8. Run `/init-claude`; Context tab shows create/merge-needed/unsafe plan.
9. Click Apply; confirm before writing.
10. With an ask file rule, confirm ApprovalCard appears and remains after browser refresh.
11. Approve; confirm Diff shows created files.
12. Discard created files and confirm they are removed safely.
13. Repeat ask flow and reject; confirm no files are written.
14. Run `/export`; Settings tab opens export controls.
15. Toggle full diff/raw logs, Copy Markdown, and Download Markdown.
16. Run `/compact`; Context tab shows Workbench-local prompt context.
17. Refresh the page; commands, approvals, compact summary, session status, and inspector data restore.

## Status Expectations

- Running: header shows `running`, Composer input is disabled, Stop is enabled.
- Waiting approval: header shows `waiting_approval`, ApprovalCard is visible.
- Completed: conversation has completion output and header is no longer running.
- Failed: error message is visible, logs remain inspectable.
- Cancelled: session remains inspectable; no automatic discard occurs.

## Export Expectations

- Filename contains provider, session id, and timestamp, sanitized for Windows/Linux.
- Default export includes metadata, prompt, conversation, commands, approvals, changed files, diff summary, compact summary, and raw-log omission note.
- Full diff and raw logs are included only when explicitly checked.
- `api_key`, `Authorization`, bearer tokens, password, secret, token, and common `.env` secret patterns are redacted.

