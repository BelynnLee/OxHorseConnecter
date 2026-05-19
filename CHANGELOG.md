# Changelog

语言：简体中文 | [English](CHANGELOG.en.md)

本文件记录适合公开仓库展示的项目更新。项目当前仍处于 WIP / Alpha 阶段，尚未发布稳定版本，也尚未完成正式线上环境验证。

## Unreleased

### Added

- 新增 GitHub 公开前的项目状态说明，明确项目仍在开发中。
- 补充 README 中的未上线测试、生产环境风险和试用建议。
- 增加文档入口和路线图中的当前阶段说明。
- 新增双语文档维护规则，以及第一批英文文档入口。

### Changed

- 将文档口径调整为 WIP / Alpha，不再把部署文档表述成已经完成上线验证。
- 强调真实执行器应运行在受控、可丢弃的工作区中。

### Known Issues

- 尚未完成真实线上环境部署测试、长期运行验证和故障恢复演练。
- API、数据结构、配置项和 UI 交互仍可能在后续迭代中调整。
- 真实 Codex / Claude Code provider 的可用性取决于本机 CLI、登录状态、PATH 和权限配置。
- 当前没有可用的 Cursor executor，真实 Cursor background agent 集成仍属于未来路线图。

## 0.1.0-alpha - 2026-05-15

### Added

- 建立 Remote Agent Console 的 pnpm monorepo 基础结构。
- 实现 Host API、React Web 控制台、SQLite 持久化和共享类型包。
- 初步接入 Mock、Codex CLI、Claude Code CLI 和 Claude API 执行器。
- 提供 Agent Workbench、任务历史、设备管理、配置、通知和安全审计相关能力。
- 添加集成测试、Workbench E2E、CI 脚本和生产化部署参考文档。

### Notes

- 该版本用于开发验证和仓库公开展示，不是生产可用版本。
