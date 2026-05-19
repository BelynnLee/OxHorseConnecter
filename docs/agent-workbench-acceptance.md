# Agent Workbench Acceptance Tests

This checklist validates the closed-loop Workbench behavior after the three-panel UI, SSE stream, Codex JSONL parsing, tool cards, Terminal, Changes, Diff, and Summary are present.

Provider note: Workbench now supports Codex and Claude Code through the same session/baseline/diff/approval shell. The Claude Code path should be validated with the provider selector set to `Claude Code`.

## Preconditions

- Start host and web with `pnpm dev`, then open the Agent Workbench page.
- Use a git repository as the project path for diff and discard tests.
- Log in as an authenticated user.
- Keep browser DevTools open for failed API calls when diagnosing.

## 1. Normal Conversation

1. Start a new Workbench session.
2. Prompt: `Say hello and summarize what repository you are in.`
3. Expected:
   - User message appears immediately.
   - Assistant content streams and then completes.
   - Header status moves from `running` to `completed`.
   - Summary panel contains the final assistant content.

## 2. Read File Task

1. Prompt: `Read package.json and tell me the workspace scripts. Do not edit files.`
2. Expected:
   - Tool call card appears for Codex.
   - Terminal contains Codex/tool output.
   - Assistant response includes scripts.
   - Changes/Diff remain empty.

## 3. Modify File Task

1. Create or choose a harmless test file in the repo.
2. Prompt: `Append a short comment to <file>.`
3. Expected:
   - Changes lists the edited file.
   - Diff tab shows patch text.
   - Copy patch copies the current patch.
   - Summary reflects the edit.

## 4. Run Command Task

1. Prompt: `Run a read-only command that prints the current directory and list the top-level files.`
2. Expected:
   - Tool call card shows command/tool activity.
   - Terminal tab contains stdout/stderr lines.
   - Assistant completes without file changes unless the command edits files.

## 5. Long Output Task

1. Prompt: `Run a command that prints at least 200 numbered lines.`
2. Expected:
   - Tool card keeps only a usable preview.
   - Terminal preserves the longer output.
   - UI remains responsive and scrollable.

## 6. Failed Task

1. Prompt: `Run a command that exits with code 7, then report what happened.`
2. Expected:
   - Tool card status becomes failed or session shows failed if Codex exits non-zero.
   - Error appears in conversation or Summary.
   - Session status persists after refresh.

## 7. Cancel Task

1. Start a slow task.
2. Click Stop while it is running.
3. Expected:
   - Session moves to `cancelled`.
   - Conversation shows a cancellation/result message.
   - Refresh keeps the cancelled state.

## 8. Approval Task

1. Prompt with an explicit dangerous command, for example: `Run \`git reset --hard\` only after approval.`
2. Expected:
   - Approval card appears with Approve and Reject.
   - Clicking Approve resolves the approval and continues the Codex run.
   - Clicking Reject resolves the approval as rejected and the session stream shows the rejection/failure result.
   - Refresh keeps the approval status.

Note: current Workbench approval catches explicit risky commands in the prompt before launching Codex. It does not yet drive Codex CLI's own internal per-tool approval protocol if the CLI exposes one mid-run.

Codex CLI check: `codex exec --help` and `codex exec resume --help` for the installed CLI show JSONL output support, sandbox modes, `--full-auto`, and the dangerous bypass flag, but do not document a stable JSONL request/response protocol for runtime tool approval decisions. Until that exists, Workbench uses the prompt-level approval gate and records this limitation explicitly.

## 9. Refresh History Replay

1. Complete a session that includes user text, assistant text, a tool card, terminal output, changes, diff, and summary.
2. Refresh the browser.
3. Expected:
   - User and assistant messages are restored.
   - Assistant delta is represented as full completed content.
   - Tool cards and terminal output are restored.
   - Changes, Diff, Summary, and session status are restored.
   - Approval cards restore their current status if the session used approval.

## 10. `/model`

1. Enter `/model` and verify current/available models are shown.
2. Enter `/model <model-id>` using a listed Codex model.
3. Start the next task.
4. Expected:
   - Header and Composer display the selected backend model.
   - Codex launch log/tool action includes `--model <actual-model>`, unless the model is the Codex default profile.
   - Refresh keeps the session model.

## 11. `/resume`

1. Enter `/resume`.
2. Expected:
   - Workbench opens the latest local history session.
   - UI message says it restored local history.
   - This command does not claim to manually resume a Codex CLI session.

Implementation note: when a Workbench session has captured a Codex CLI session id from JSONL, the next message in that same Workbench session uses `codex exec resume <id>` automatically.

## 12. `/diff`

1. Enter `/diff`.
2. Expected:
   - Right panel switches to the Diff tab.
   - Copy patch, Open file, Refresh diff, Discard file, and Discard all controls are visible where applicable.

## 13. `/plan`

1. Enter `/plan <task>`.
2. Expected:
   - A planning-only run starts.
   - No file edits are made.
   - Plan/step content appears in the conversation.

## 14. `/review`

1. Create a small git diff.
2. Enter `/review`.
3. Expected:
   - Codex reviews the current diff.
   - Assistant reports findings or says no issues were found.
   - No file edits are made by default.

## Claude Code Provider

### Capability Detection

1. Start the host and open Agent Workbench.
2. Call `GET /api/agent/providers` or inspect the provider selector.
3. Expected:
   - `claude-code` appears when the CLI is installed.
   - Capability payload includes CLI path, version, print mode, stream-json output, resume, MCP, model flag, append-system-prompt, settings support, permission mode, and raw stream mode.
   - If Claude Code is not installed, the provider is disabled with an unavailable reason.

Observed on this machine:

- `claude --version`: `2.1.92 (Claude Code)`
- `claude --help`, `claude -p --help`, and `claude --print --help` document `--print`, `--output-format json|stream-json`, `--include-partial-messages`, `--model`, `--permission-mode`, `--append-system-prompt`, `--settings`, and `--resume`.
- `claude resume --help` is not a separate command in this CLI; resume is exposed as `-r, --resume [value]`.
- `claude mcp --help` is available.
- No stable Workbench-driven runtime tool approval protocol was documented; Workbench keeps prompt-level approval plus safe baseline/discard protections.

### Claude Plan / Review / Edit

1. Select provider `Claude Code`.
2. Run `/plan <task>` and `/review`.
3. Expected:
   - Claude Code launches in print stream-json mode.
   - Read-only prompts use Claude permission mode `plan` where supported.
   - Output streams into the conversation and logs.
   - No file changes are produced by plan/review runs.

1. Select provider `Claude Code` and run an edit task on a harmless file.
2. Expected:
   - Assistant output streams.
   - Tool use and tool result JSON blocks appear as tool cards when present.
   - Raw stdout/stderr remains visible in Logs if a line cannot be parsed as structured JSON.
   - Session captures the Claude `session_id`; the next message uses `claude --resume <session_id>`.
   - Diff and discard use the same session-scoped baseline logic as Codex.

### Claude Slash Commands

1. Type `/` in the composer.
2. Expected:
   - Command palette shows `/help`, `/model`, `/config`, `/permissions`, `/status`, `/diff`, `/discard`, `/review`, `/plan`, `/resume`, `/export`, `/compact`, `/hooks`, and `/init-claude`.
   - `/config` opens provider settings.
   - `/permissions` opens permission rules, recent rule hits, and approval history.
   - `/discard` opens the safe discard controls without performing discard immediately.
   - `/hooks` clearly says hooks runtime is not implemented.
   - `/init-claude` previews files and does not write until the user confirms Apply.

## Claude Experience Closure

### Permission Rules

1. Open `/permissions` or the Approvals inspector tab.
2. Add a command rule with pattern `git clean` and decision `deny`.
3. Prompt: `Run \`git clean -fd\`.`
4. Expected:
   - The session is blocked before CLI execution.
   - Permission Hits shows a deny hit with the matched rule/reason.

1. Add a command rule with pattern `git reset --hard` and decision `ask`.
2. Prompt: `Run \`git reset --hard\` only if approved.`
3. Expected:
   - Workbench creates an approval request before launching the provider.
   - Approve continues the run; Reject fails it with a rejection message.
   - Hits records the ask decision.

### `/init-claude`

1. Use a git repository that does not already contain `CLAUDE.md` or `.claude/`.
2. Run `/init-claude`.
3. Expected:
   - Context tab shows `CLAUDE.md`, `.claude/settings.json`, `.claude/commands/review.md`, and `.claude/commands/plan.md` as create actions.
   - No files are written yet.

1. Click Apply or run `/init-claude apply`.
2. Expected:
   - Workbench records/reuses the session baseline.
   - Missing files are created with conservative templates and no secrets.
   - Existing files are marked merge-needed and are not overwritten.
   - Diff tab shows the created files as session-owned changes.
   - Safe discard can remove those session-created files.

### `/export`

1. Complete a session with messages, at least one tool/command if available, and optionally a diff.
2. Run `/export` or open Settings and click Download Markdown.
3. Expected:
   - Browser downloads a Markdown file named with provider, session id, and timestamp.
   - Export includes metadata, prompt, conversation, commands, approvals, files changed, diff summary, compact summary, and sanitized raw log appendix when requested.
   - Full diff and raw logs are omitted by default unless selected.

### `agent_commands`

1. In a Claude Code session, trigger a bash/shell/tool command.
2. Open Commands tab.
3. Expected:
   - Command rows come from `agent_commands`.
   - Each row shows command, cwd, exit code if known, stdout/stderr preview, risk level, and approval id if linked.
   - Long previews are bounded; full raw logs remain in Logs.

### `/compact`

1. Complete a session with several messages.
2. Run `/compact`.
3. Expected:
   - Context tab shows a saved Workbench compact summary.
   - The summary includes user goal, latest result, files changed, commands, approvals, unresolved issues, and next steps.
   - Later append/resume injects this as Workbench prompt-context only; UI/export must not claim Claude Code native context was rewritten.

### Usage

1. Complete a Claude Code session.
2. Expected:
   - Header and Settings show token usage.
   - If Claude Code emitted stable usage, label is Actual.
   - Otherwise Workbench shows Estimated tokens using character-count estimation.
   - Actual usage includes uncached input, cache write, cache read, output, and total tokens.
   - Cost appears only when model pricing is configured through `AGENT_MODEL_PRICING_JSON`; cache-aware usage requires cache read/write rates, otherwise no cost is displayed.

## Diff Operations

1. Click Refresh diff after editing a file outside Workbench.
2. Expected: Changes and Diff update to match the current git worktree.

1. Click Open file on a changed file.
2. Expected: host opens the file location or falls back to copying/showing the path depending on OS support.

1. Click Discard file on one changed file.
2. Expected: only that file is restored/cleaned and diff refreshes.

1. Click Discard all.
2. Expected: only session-owned tracked changes are restored and only session-created untracked files are removed, then diff refreshes empty.

1. Repeat in a non-git folder.
2. Expected: discard controls are disabled or the API returns a graceful unavailable reason.

## Baseline And Isolation

### Existing Dirty Worktree

1. Before starting a Workbench run, edit a tracked file and create one untracked file.
2. Start a normal agent task in that project.
3. Expected:
   - UI shows a warning that the worktree already has uncommitted changes.
   - Clicking Cancel does not start a session.
   - Clicking Continue starts the session and records the baseline.
   - Existing tracked/untracked changes are not shown as session-owned changes unless Codex modifies them after the baseline.

### Session Modifies Existing Clean File

1. Start from a clean tracked file.
2. Ask Codex to edit it.
3. Expected:
   - File appears in Changes/Diff.
   - Discard file restores only that file to `HEAD`.
   - Other pre-existing dirty files remain untouched.

### Session Adds New Untracked File

1. Start a session with no untracked file at `tmp/workbench-new.txt`.
2. Ask Codex to create `tmp/workbench-new.txt`.
3. Expected:
   - File appears as created.
   - Discard file deletes that specific file.
   - Discard all deletes only session-created untracked files, never all untracked files in the repo.

### Existing Untracked File

1. Create an untracked file before session start.
2. Continue through the dirty worktree warning.
3. Ask Codex to modify other files.
4. Expected:
   - Discard all does not remove the pre-existing untracked file.
   - If that pre-existing untracked file changed after baseline, discard all is blocked and tells the user to handle it manually.

### Baseline Dirty Tracked File

1. Modify a tracked file before session start.
2. Continue through the dirty worktree warning.
3. Ask Codex to modify that same file.
4. Expected:
   - If Workbench captured a baseline snapshot, discard file restores the file to its baseline content, not `HEAD`.
   - If the file was too large or could not be snapshotted, discard is blocked and asks for manual handling.

### Non-Git Repository

1. Use a folder that is not inside a git repository.
2. Start and complete a session.
3. Expected:
   - Workbench can run Codex.
   - Diff/discard APIs return a graceful unavailable reason.

### Concurrent Same Project Session

1. Start a normal agent session and keep it running.
2. Try to start another normal agent session with the same `projectPath`.
3. Expected:
   - Second modifying session is rejected.
   - A `/plan` or `/review` session for the same path is allowed.
   - To run concurrent modifying work, create a separate git worktree and use that path.

### Cancel Then Discard

1. Start a session that edits a file.
2. Cancel before completion.
3. Open Changes/Diff and discard the edited file or discard all.
4. Expected:
   - Discard still uses the recorded session baseline.
   - Only session-owned changes are reverted or removed.
