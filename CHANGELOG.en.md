# Changelog

Language: [Simplified Chinese](CHANGELOG.md) | English

This file records project updates suitable for a public repository. The project is currently WIP / Alpha, has not published a stable release, and has not completed formal online environment validation.

## Unreleased

### Added

- Added public repository status notes that clearly mark the project as still under active development.
- Expanded README with not-yet-online-tested status, production risk notes, and trial-use guidance.
- Added current-stage notes to the documentation index and roadmap.
- Added bilingual documentation maintenance rules and the first English documentation entry points.

### Changed

- Updated documentation language to WIP / Alpha instead of implying completed online validation.
- Emphasized that real executors should run only inside controlled, disposable workspaces.

### Known Issues

- Real online deployment testing, long-running validation, and failure-recovery drills are not complete.
- APIs, data structures, configuration fields, and UI interactions may still change in later iterations.
- Real Codex / Claude Code provider availability depends on local CLI installation, login state, `PATH`, and permission configuration.
- There is currently no usable Cursor executor. Real Cursor background agent integration remains a future roadmap item.

## 0.1.0-alpha - 2026-05-15

### Added

- Established the Remote Agent Console pnpm monorepo foundation.
- Implemented Host API, React Web console, SQLite persistence, and shared type packages.
- Added initial Mock, Codex CLI, Claude Code CLI, and Claude API executor integration.
- Added Agent Workbench, task history, device management, configuration, notifications, and security audit capabilities.
- Added integration tests, Workbench E2E, CI scripts, and production-readiness reference documentation.

### Notes

- This version is for development validation and public repository presentation. It is not production-ready.
