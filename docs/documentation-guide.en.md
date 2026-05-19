# Documentation Maintenance Guide

Language: [Simplified Chinese](documentation-guide.md) | English

This document defines how bilingual documentation is maintained in this repository. The Simplified Chinese documents are currently the source of truth. English documents are provided for public GitHub presentation and for non-Chinese readers to quickly understand the project state.

## Naming Rules

- Chinese documents use the original filename, such as `README.md` or `roadmap.md`.
- English documents use the `.en.md` suffix, such as `README.en.md` or `roadmap.en.md`.
- Every bilingual document should include language switch links at the top.
- The `docs/archive/` directory does not require translation by default, unless an archived document becomes current fact again.

## Synchronization Scope

When changing the following documents, check whether the English version needs to be updated:

- Root `README.md`
- Root `CHANGELOG.md`
- `docs/README.md`
- `docs/roadmap.md`
- `docs/security.md`
- `docs/deployment-guide.md`
- `docs/production-deployment.md`
- `docs/api.md`

If a complete English update cannot be done immediately, mark the English file with:

```md
> Translation status: may lag behind the Simplified Chinese version.
```

## Maintenance Principles

- Chinese documentation is the current source of truth.
- English documentation does not need to be word-for-word translation, but it must preserve project status, risk notes, commands, security boundaries, and known limitations.
- WIP / Alpha, not-yet-online-tested, and not-production-ready status notes must appear in both Chinese and English documents.
- Commands, paths, environment variables, and API paths should stay consistent across languages.
- When adding an important section, update both `docs/README.md` and `docs/README.en.md`.

## Current English Coverage

- [`../README.en.md`](../README.en.md)
- [`../CHANGELOG.en.md`](../CHANGELOG.en.md)
- [`README.en.md`](README.en.md)
- [`roadmap.en.md`](roadmap.en.md)
- [`documentation-guide.en.md`](documentation-guide.en.md)

Other detailed documents can be translated incrementally.
