# Documentation Index

Language: [Simplified Chinese](README.md) | English

This documentation separates current implementation facts from historical planning material. For daily development, deployment, and troubleshooting, start with this file and the root [`README.en.md`](../README.en.md).

The project is currently WIP / Alpha. Deployment, production configuration, and release-readiness documents describe target boundaries and preparation checklists. They do not mean the project has completed formal online testing.

## Current Facts

- [Architecture](architecture.md): current monorepo structure, runtime modules, and data flow.
- [API](api.md): REST, realtime streams, Workbench, and remote worker interfaces.
- [Security](security.md): implemented security boundaries, deployment requirements, and current limitations.
- [Deployment guide](deployment-guide.md): Chinese deployment steps from server preparation to startup, backup, and rollback.
- [Production deployment runbook](production-deployment.md): production gates, backup, monitoring, and rollback.
- [Agent Workbench](agent-workbench.md): Workbench behavior and session capabilities.
- [Agent Workbench acceptance](agent-workbench-acceptance.md): manual acceptance scenarios for Workbench behavior.
- [Roadmap](roadmap.en.md): current stage and follow-up recommendations.
- [Changelog](../CHANGELOG.en.md): public repository update records, unreleased items, and known issues.
- [Documentation guide](documentation-guide.en.md): bilingual documentation naming, synchronization, and status rules.

## Operating Helpers

- [Claude Code Workbench quickstart](claude-code-workbench-quickstart.md): detailed guide for starting Workbench after a fresh clone.
- [Workbench regression matrix](workbench-regression-matrix.md): release confidence and coverage matrix.
- [Nginx example](nginx.conf.example) and [proxy snippet](nginx-rac-proxy.snippet.conf): reverse proxy configuration.
- [Caddy example](Caddyfile.example): alternative reverse proxy configuration.
- [AI service README](../apps/ai-service/README.md): optional Python service documentation.
- [E2E README](../tests/e2e/README.md) and [integration README](../tests/integration/README.md): test suite documentation.

## Translation Coverage

English versions are currently maintained for the GitHub-facing entry documents:

- Root README: [`../README.en.md`](../README.en.md)
- Changelog: [`../CHANGELOG.en.md`](../CHANGELOG.en.md)
- Documentation index: [`README.en.md`](README.en.md)
- Roadmap: [`roadmap.en.md`](roadmap.en.md)
- Documentation maintenance guide: [`documentation-guide.en.md`](documentation-guide.en.md)

Other detailed documents may still be Chinese-only. When they are changed, either add an English `.en.md` file or clearly mark the English translation status.

## Release Materials

- [Claude Code Workbench MVP release materials](releases/claude-code-workbench-mvp/README.md): release notes and acceptance record for the MVP milestone.
