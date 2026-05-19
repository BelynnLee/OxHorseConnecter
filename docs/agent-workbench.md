# Agent Workbench

Agent Workbench is the local and remote coding-agent console at `/workbench`.
It supports Workbench sessions for Codex and Claude Code, plus a Remote TUI
panel for interactive Shell, Codex, and Claude Code terminals.

## Start

```bash
nvm use 22.22.0
corepack pnpm install
corepack pnpm build
corepack pnpm dev
```

Open `http://localhost:5173` and sign in with the configured admin account.

## Run A Codex Task

1. Open `/workbench`.
2. Enter the project path in the header.
3. Pick a model, then choose Agent, Plan, or Review mode.
4. Send a prompt from the composer.
5. Watch the center stream for user messages, assistant deltas, steps, tool cards, file change notices, errors, and summaries.

## Review Output

- Changes: changed files grouped by created, modified, and deleted status.
- Diff: unified or split patch view with Copy patch and Refresh diff.
- Terminal: full command and process output, including debug events for unmapped Codex JSONL.
- Summary: final assistant summary and session metadata.

## Remote TUI

The Remote TUI panel opens a WebSocket-backed terminal for the selected project
path and device. It supports three providers:

- Shell: the host or remote worker starts the platform shell. Windows prefers
  `pwsh.exe`, then `powershell.exe`, then `cmd.exe`; Unix-like systems prefer
  `$SHELL`, then `/bin/bash`, then `/bin/sh`.
- Codex: starts the configured Codex CLI command.
- Claude Code: starts the configured Claude Code CLI command.

Local terminals run inside the Host process through `node-pty`. Remote terminals
are bridged through a trusted remote worker connected to
`/api/remote/native-terminal`.

Shell terminals are intentionally gated. Before a new Shell PTY is created, the
web client calls `/api/agent/native-terminal/authorizations`. The host evaluates
Workbench permission rules with provider `shell`, input type `tool`, and high
risk. If the result is `ask`, the UI shows an explicit authorization bar. The
returned authorization id is short lived, bound to the user/device/project path,
and consumed once when the WebSocket session is created.

Codex and Claude Code terminals can accept launch args. Shell terminals reject
launch args because the authorization covers an interactive shell, not a
pre-composed command line.

Terminal sessions keep a bounded output replay buffer. Detached sessions are
cleaned up after an idle timeout, and all sessions have a maximum lifetime so
orphaned PTYs are not left running indefinitely.

## Slash Commands

- `/model <id>` switches the default model.
- `/plan <task>` starts a planning-only run.
- `/review [prompt]` starts a diff review run.
- `/diff` opens the diff tab.
- `/clear` clears the active workbench view.
- `/resume` opens the latest session.
- `/help` prints command help.

Slash commands are Workbench/session commands, not Shell commands. A small
allowlist of provider-native slash commands typed inside Codex/Claude terminal
sessions is mirrored back into Workbench state, but general Shell terminal input
is sent directly to the PTY after the initial Shell authorization.

## Cancel

Use Stop while a session is running. The host calls the agent cancel API, kills the active Codex child process, and emits `session.cancelled`.
