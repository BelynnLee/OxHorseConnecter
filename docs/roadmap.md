# 开发路线

语言：简体中文 | [English](roadmap.en.md)

本文档记录当前仓库真实状态。历史 Phase 2+ 设计已归档到
[archive/design/phase2-plus-design.md](archive/design/phase2-plus-design.md)，仅作背景参考。

## 当前阶段

项目当前处于 WIP / Alpha 阶段，适合本地开发、功能验证和小范围试用。虽然已经具备 Workbench、执行器接入、安全边界、通知和基础质量门禁，但尚未完成真实线上环境部署测试、长期运行验证和故障恢复演练，因此不应作为生产可用版本发布。

## 已完成

- [x] Monorepo 工程骨架：Host、Web、shared、storage、security、executors 分包。
- [x] Mock Executor 全链路：任务创建、事件流、审批、diff、取消、超时和集成 smoke。
- [x] Agent Workbench v2：三栏工作台、timeline、inspector、composer、slash commands、session replay、模型和 reasoning 控制。
- [x] 真实执行器接入：Codex CLI、Claude Code CLI、Claude API executor；当前没有可用的 Cursor executor。
- [x] Git diff 与会话基线：任务/会话完成后生成 diff，支持文件级查看、刷新和安全 discard。
- [x] SSE 韧性：`seq`、`Last-Event-ID`/`lastEventId` 回放、心跳、前端重连和超时 watchdog。
- [x] Host 恢复与任务超时：重启后恢复卡住任务/会话，`TASK_MAX_DURATION_SECONDS` 限制单次执行时长。
- [x] 风险与权限：内置/外部风险规则、`GET /api/security/rules`、Workbench permission rules 和 hit 记录。
- [x] 通知：Webhook、Telegram、Web Push、通知设置和 `push_subscriptions` 持久化。
- [x] 任务增强：模板 CRUD、重试、多设备 fan-out、任务详情 Command Timeline。
- [x] Release readiness 基础：根级 `ci` 脚本、usage accounting 测试入口、Workbench E2E、真实 provider opt-in smoke。

## 当前 Release Readiness 重点

- [x] 统一根级验证入口：`pnpm run ci` 固定执行构建、executor 参数测试、usage accounting、集成 smoke 和 Workbench E2E。
- [x] GitHub Actions：Node 22 + pnpm 10.11.1 + Playwright Chromium，在 PR/push 上运行 `pnpm run ci`。
- [x] 真实 provider smoke：`REAL_PROVIDER_SMOKE=1 pnpm test:real-provider-smoke` 在临时 git repo 中验证 Codex/Claude Code 的 plan/read/edit/diff/failure/cancel 基本路径。
- [x] 文档同步：roadmap、architecture、security 与当前实现对齐。

## 上线前缺口

- [ ] 完成真实线上环境或准生产环境部署测试，并记录环境、版本、回滚步骤和验证结果。
- [ ] 完成长期运行观察，包括 SSE/WebSocket 稳定性、任务恢复、日志增长、数据库备份和磁盘占用。
- [ ] 对公网暴露场景进行安全复核，包括 TLS、反向代理、CORS、cookie、密钥轮换、remote worker 凭据和工作区边界。
- [ ] 补充面向新用户的截图、演示流程或最小 demo，让 GitHub 访问者能快速理解项目状态。
- [ ] 梳理不稳定 API、配置项和数据库 schema，标注可能变更的部分。

## 生产安全加固

- [x] Remote worker 凭据：新增 `device_credentials`，使用 `racw_<credentialId>_<secret>` 一次性明文 token，数据库只保存 hash；`/api/remote/*` 不再接受 `device.id` 作为 token。
- [x] 严格注册：生产或 HTTPS 模式要求 `REMOTE_REGISTRATION_TOKEN`，worker 使用 `RAC_REMOTE_REGISTRATION_TOKEN` 首次注册，再保存 `RAC_REMOTE_DEVICE_ID` 和 `RAC_REMOTE_DEVICE_TOKEN`。
- [x] Remote worker 工作区边界：worker 上报 `workRoot` / `workRootExists`，任务和远端终端统一按 worker 本机受控根目录解析路径。
- [x] 安全审计：新增 `security_audit_events` 和 `GET /api/security/audit`，覆盖登录、设备注册、凭据、trust/untrust、remote claim/report、审批、权限命中和配置变更。
- [x] Provider strict profile：`AGENT_SECURITY_PROFILE=strict` 禁止 Codex full-auto 和 Claude bypass permissions；Codex plan/review 强制 read-only，agent 默认 workspace-write；Claude Code plan/review 使用 plan permission mode 并配置保守 disallowed tools。
- [x] 前端入口：设备页支持创建/撤销 worker credential，Settings 显示安全审计，Config 显示安全配置项。

## 后续建议

- [ ] Cursor executor：仅作为未来路线图项；接入真实 Cursor background agent 前不作为现有执行器能力展示。
- [ ] Provider runtime approval：若 Codex/Claude Code 暴露稳定的运行时工具审批协议，将 Workbench 审批从 prompt/preflight 扩展到 provider 原生中途决策。
- [ ] Hooks runtime：当前 `/hooks` 明确提示未实现，后续可按项目级 hooks 配置接入。
- [ ] CI 可选真实 provider job：在具备安全凭据和隔离 runner 后，把 real-provider smoke 加成手动触发 workflow。
- [ ] 移动端专用交互：把当前响应式布局进一步升级为 Drawer/Bottom Sheet 等移动端专用工作流。
- [ ] 数据迁移体系：把 `ensureColumn` 式 schema 演进升级为显式版本迁移和回滚策略。
- [ ] 集中日志 / SIEM：在出现合规或审计需求后，选择日志 sink，定义结构化日志 envelope，并镜像 `security_audit_events`。
- [ ] SQLite → PostgreSQL：当 active session 写入量、持续写入 RPS 或多实例部署需求触发阈值后，再启动 repository async 化和迁移工具设计。历史细节见 [archive/roadmap/non-functional-roadmap.md](archive/roadmap/non-functional-roadmap.md)。
