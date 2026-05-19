# Roadmap

Language: [Simplified Chinese](roadmap.md) | English

This document records the repository's current real state. Historical Phase 2+ design material has been archived to [archive/design/phase2-plus-design.md](archive/design/phase2-plus-design.md) and is kept only as background reference.

## Current Stage

The project is currently WIP / Alpha. It is suitable for local development, feature validation, and small-scope trials. Although Workbench, executor integration, security boundaries, notifications, and basic quality gates are already present, real online deployment testing, long-running validation, and failure-recovery drills are not complete. It should not be released as production-ready.

## Completed

- [x] Monorepo foundation: Host, Web, shared, storage, security, and executors packages.
- [x] Mock Executor full path: task creation, event streams, approvals, diffs, cancellation, timeout, and integration smoke.
- [x] Agent Workbench v2: three-column workbench, timeline, inspector, composer, slash commands, session replay, model controls, and reasoning controls.
- [x] Real executor integration: Codex CLI, Claude Code CLI, and Claude API executor. There is currently no usable Cursor executor.
- [x] Git diff and session baseline: generate diffs after task/session completion, with file-level review, refresh, and safe discard.
- [x] SSE resilience: `seq`, `Last-Event-ID`/`lastEventId` replay, heartbeats, frontend reconnect, and timeout watchdog.
- [x] Host recovery and task timeout: recover stuck tasks/sessions after restart, and limit single execution duration with `TASK_MAX_DURATION_SECONDS`.
- [x] Risk and permissions: built-in/external risk rules, `GET /api/security/rules`, Workbench permission rules, and hit records.
- [x] Notifications: Webhook, Telegram, Web Push, notification settings, and `push_subscriptions` persistence.
- [x] Task enhancements: template CRUD, retry, multi-device fan-out, task detail Command Timeline.
- [x] Release-readiness foundation: root `ci` script, usage accounting test entry point, Workbench E2E, and opt-in real provider smoke.

## Current Release Readiness Focus

- [x] Unified root validation entry point: `pnpm run ci` runs build, executor argument tests, usage accounting, integration smoke, and Workbench E2E.
- [x] GitHub Actions: Node 22 + pnpm 10.11.1 + Playwright Chromium, running `pnpm run ci` on PR/push.
- [x] Real provider smoke: `REAL_PROVIDER_SMOKE=1 pnpm test:real-provider-smoke` validates basic plan/read/edit/diff/failure/cancel paths for Codex/Claude Code in a temporary git repository.
- [x] Documentation synchronization: roadmap, architecture, and security docs are aligned with the current implementation.

## Pre-Launch Gaps

- [ ] Complete real online or staging deployment testing, and record environment, version, rollback steps, and validation results.
- [ ] Complete long-running observation, including SSE/WebSocket stability, task recovery, log growth, database backup, and disk usage.
- [ ] Review public exposure security, including TLS, reverse proxy, CORS, cookies, key rotation, remote worker credentials, and workspace boundaries.
- [ ] Add screenshots, a demo flow, or a minimal demo for new GitHub visitors.
- [ ] Identify unstable APIs, configuration fields, and database schema areas, and mark what may change.

## Production Security Hardening

- [x] Remote worker credentials: added `device_credentials`, using one-time plaintext tokens in the form `racw_<credentialId>_<secret>`, with only hashes stored in the database. `/api/remote/*` no longer accepts `device.id` as a token.
- [x] Strict registration: production or HTTPS mode requires `REMOTE_REGISTRATION_TOKEN`. Workers use `RAC_REMOTE_REGISTRATION_TOKEN` for first registration, then store `RAC_REMOTE_DEVICE_ID` and `RAC_REMOTE_DEVICE_TOKEN`.
- [x] Remote worker workspace boundary: workers report `workRoot` / `workRootExists`; tasks and remote terminals resolve paths against the worker's local controlled root.
- [x] Security audit: added `security_audit_events` and `GET /api/security/audit`, covering login, device registration, credentials, trust/untrust, remote claim/report, approvals, permission hits, and configuration changes.
- [x] Provider strict profile: `AGENT_SECURITY_PROFILE=strict` disables Codex full-auto and Claude bypass permissions. Codex plan/review is forced read-only, agents default to workspace-write, and Claude Code plan/review uses plan permission mode with conservative disallowed tools.
- [x] Frontend entry points: Devices page supports creating/revoking worker credentials, Settings shows security audit, and Config shows security configuration items.

## Follow-Up Recommendations

- [ ] Cursor executor: keep it as a future roadmap item. Do not present real Cursor background agent integration as an existing executor capability before it is implemented.
- [ ] Provider runtime approval: if Codex/Claude Code exposes a stable runtime tool-approval protocol, extend Workbench approvals from prompt/preflight to native provider mid-run decisions.
- [ ] Hooks runtime: `/hooks` currently states that it is not implemented. Later, connect it to project-level hooks configuration.
- [ ] Optional real provider CI job: after safe credentials and isolated runners exist, add real-provider smoke as a manually triggered workflow.
- [ ] Mobile-specific interactions: evolve the current responsive layout into mobile-specific Drawer/Bottom Sheet workflows.
- [ ] Data migration system: replace `ensureColumn`-style schema evolution with explicit versioned migrations and rollback strategy.
- [ ] Centralized logs / SIEM: when compliance or audit needs appear, choose a log sink, define a structured log envelope, and mirror `security_audit_events`.
- [ ] SQLite to PostgreSQL: when active session writes, sustained write RPS, or multi-instance deployment needs cross the threshold, start repository async conversion and migration tooling design. Historical details are in [archive/roadmap/non-functional-roadmap.md](archive/roadmap/non-functional-roadmap.md).
