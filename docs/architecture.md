# 架构说明

本文档描述当前仓库已经落地的 MVP/Workbench 架构，而不是理想化设计图。

## 当前实现范围

- 本地 Host 服务
- Web 控制台
- SQLite 持久化
- 统一共享协议
- Mock Executor 全链路
- Agent Workbench v2
- 审批、权限、diff、通知与安全基础能力
- Codex CLI、Claude Code CLI、Claude API 执行器
- 远端 worker 轮询模式

## Phase 0：基础骨架

Phase 0 的落地目标是先把工程边界固定下来，而不是先做功能堆叠。当前仓库根目录就是 pnpm workspace：

```text
apps/
  host/
  web/
packages/
  executors/
  security/
  shared/
  storage/
docs/
scripts/
tests/
e2e/
.env.example
package.json
pnpm-workspace.yaml
tsconfig.json
```

这个骨架保证了：

- Web、Host、共享协议、存储、安全、执行器职责拆分清晰
- 所有实现均在 workspace 内闭环
- CI、集成测试、Workbench E2E 和 opt-in 真实 provider smoke 都从根目录入口运行

历史需求文档已归档到 `docs/archive/prd/remote-agent-console-mvp-requirements.md`，不再作为当前实现真源。

## Phase 1：共享协议层

Phase 1 的目标是先冻结 Host、Web、Executor 之间的共同语言。当前共享协议全部集中在 `packages/shared/src/`：

```text
packages/shared/src/
  constants.ts
  executor.ts
  index.ts
  types/
    api.ts
    approval.ts
    auth.ts
    common.ts
    device.ts
    diff-summary.ts
    security.ts
    index.ts
    stream.ts
    task-event.ts
    task.ts
```

其中：

- `types/device.ts` 定义设备身份、在线状态、信任状态
- `types/task.ts` 定义任务状态机、执行器类型和创建任务输入
- `types/task-event.ts` 定义统一事件类型、事件等级和 payload map
- `types/approval.ts` 定义审批状态、风险级别和审批输入
- `types/diff-summary.ts` 定义 patch 摘要和文件粒度变更结构
- `types/security.ts` 定义 remote worker credential 和安全审计事件类型
- `types/api.ts` 定义 REST API 响应和聚合详情结构
- `types/stream.ts` 定义 SSE 推送信封
- `executor.ts` 定义 Host 与执行器之间的统一接口

## Monorepo 结构

```text
apps/
  host/        # 本地 Host/API 服务与 remote worker
  web/         # React Web 控制台
packages/
  shared/      # 领域模型、协议、常量、API 合同
  storage/     # SQLite schema 与 repository
  security/    # 认证、风险识别、路径限制、日志脱敏
  executors/   # mock、codex、claude-code、claude API
docs/
scripts/
tests/
e2e/
```

## 模块职责

### `@rac/shared`

负责统一共享定义：

- `Device`
- `Task`
- `TaskEvent`
- `Approval`
- `DiffSummary`
- API 响应结构
- SSE 流信封结构
- 执行器接口

Web、Host、Executors 都围绕这一层对齐，不再各写一套私有类型。

### `@rac/storage`

负责本地持久化：

- `users`
- `projects`
- `devices`
- `tasks`
- `task_events`
- `approvals`
- `diff_summaries`
- `task_templates`
- `push_subscriptions`
- `settings`
- `sessions`
- `session_messages`
- `session_stream_events`
- `session_baselines`
- `agent_permission_rules`
- `agent_permission_hits`
- `agent_commands`
- `agent_session_summaries`
- `agent_usage`
- `provider_capabilities`
- `device_credentials`
- `security_audit_events`
- `tool_invocations`

实现方式是 `better-sqlite3 + repository`，避免 SQL 散落在路由层。远端 worker 会上报 `workRoot` / `workRootExists`；项目按 `(deviceId, path)` 归属设备，避免不同 worker 上的相同路径互相串联。

### `@rac/security`

负责 MVP 安全基线：

- JWT 令牌生成与校验，登录 cookie 和 CSRF 保护
- scrypt 密码哈希与旧明文密码升级
- remote worker credential token 生成、hash 和校验
- 内置和外部 JSON 风险规则
- 工作目录越界识别
- 审批超时
- 日志敏感信息脱敏

### `@rac/executors`

当前已实现：

- `MockExecutor`
- `CodexExecutor`
- `ClaudeExecutor`
- `ClaudeCodeExecutor`

当前没有可用的 Cursor executor；Cursor background agent 仅保留在未来路线图中。

Codex 和 Claude Code 通过本机 CLI 子进程运行，Claude API 通过 `@anthropic-ai/sdk` 运行。真实 provider 的可用性取决于本机 CLI、认证和环境变量。

### `@rac/host`

Host 是本地桥接服务，当前包含：

- 认证路由
- 设备路由
- 任务路由
- 会话/Agent Workbench 路由
- 审批路由
- SSE 路由
- 模型、命令、模板、配置、通知和 remote worker 路由
- 安全审计查询与 remote worker credential 管理
- 任务编排服务
- 会话编排服务
- Host 启动自注册逻辑

Host 启动后会：

1. 初始化 SQLite
2. 恢复卡住的任务/会话
3. 确保管理员用户存在
4. 确保本机设备已注册并标记为在线
5. 探测并注册可用执行器
6. 暴露 API 与事件流接口

### `@rac/web`

Web 控制台当前页面：

- 登录页
- 设备页
- Agent Workbench
- 任务详情页
- 历史任务页
- 模板页
- 配置页
- 设置/通知页

前端通过 REST API 读写数据，通过 SSE 订阅任务、会话和 Agent Workbench 事件流。

## 核心时序

### 创建任务

1. 用户在 Web 选择设备和执行器，提交任务。
2. Host 校验登录态、设备状态、设备信任、工作目录限制。
3. Host 写入 `tasks` 与 `task.created` 事件。
4. Host 调用 `TaskService.executeTask`。
5. TaskService 找到对应执行器并开始执行。

### 执行与事件流

1. Executor 通过 `ExecutorCallbacks.onEvent` 上报统一事件。
2. TaskService 做日志脱敏后写入 `task_events`。
3. TaskService 通过 SSE 将 `task.event` 推送给前端。
4. 前端任务详情页实时追加事件并刷新状态。

### 审批

1. Executor 调用 `onApprovalRequest`。
2. TaskService 在 Host 侧结合 `packages/security` 对命令与目标路径重新做最小风险判定。
3. TaskService 创建 `approvals` 记录，将任务状态改为 `waiting_approval`。
4. Host 推送审批事件，前端展示审批卡片。
5. 用户 approve / reject 后，TaskService 恢复执行。
6. 若超时，TaskService 自动拒绝并将任务标记为失败。

### 完成与 diff

1. Executor 完成后回调 `onComplete(summary, diff?)`。
2. TaskService 更新任务状态为 `completed`。
3. 若存在 diff，则写入 `diff_summaries` 并发出 `task.diff_ready`。
4. 前端展示摘要和 patch 文本。

## 当前数据流边界

- 路由层只做参数接收、鉴权和响应，不承载核心编排逻辑
- 任务状态变更与事件持久化集中在 `TaskService`
- 数据库存取集中在 `packages/storage`
- 风险判断与日志脱敏集中在 `packages/security`
- 执行器通过统一 `Executor` 接口解耦

## Advanced Agent Workbench 架构

进阶版在原 MVP task 链路之上增加一层会话编排，不推翻原有执行、审批、diff 和 SSE 能力。

### 新增领域模型

`packages/shared/src/types/session.ts` 定义：

- `AgentSession`：会话状态、设备、执行器、模型、工作目录、当前 task 和计划摘要
- `SessionMessage`：用户消息、assistant 消息、计划、工具调用、审批、diff、错误和命令结果
- `SessionStreamEvent`：会话级流事件，包含 `message.delta`、`plan.updated`、`tool.started`、`approval.requested`、`diff.ready` 等
- `ModelProfile`：模型注册表条目和能力标签
- `SlashCommand`：可注册化的 `/` 命令描述

SQLite 新增：

- `sessions`
- `session_messages`
- `session_stream_events`
- `tool_invocations`

### 会话执行流

1. Web 在 `/workbench` 创建或恢复一个 `AgentSession`。
2. 用户发送普通消息时，Host 写入 `session_messages` 中的 user message 和 streaming assistant message。
3. `SessionService` 基于当前会话上下文创建一个底层 `Task`，继续交给 `TaskService.executeTask`。
4. `TaskService` 仍负责执行器回调、审批、diff、任务状态和原 task SSE。
5. `SessionService` 订阅该 task 的事件和 partial text，将其映射为会话消息块与 `SessionStreamEvent`。
6. Web 通过 `GET /api/stream?sessionId=...` 或 `GET /api/sessions/:id/stream` 接收会话级 SSE，实时更新消息内容、状态、计划、审批、工具调用和 diff。

### 模型切换

`ModelRegistry` 维护当前可选模型。会话保存的是模型 profile id；创建底层 task 时，`SessionService` 会把 profile 映射为有效模型 ID，并通过 `Task.modelId` / `StartTaskInput.modelId` 传给执行器。Codex、Claude API、Claude Code 执行器会优先使用本次任务的 `modelId`，否则使用环境配置中的默认模型。

### Slash Commands

Slash command 解析集中在 `apps/host/src/services/slash-commands.ts` 和 `SessionService.executeCommand`：

- 会话：`/new`、`/clear`、`/rename`、`/resume`
- 模型：`/model`、`/models`
- 环境：`/device`、`/executor`、`/cwd`、`/status`
- Agent：`/plan`、`/stop`、`/help`、`/native`、`/codex`、`/claude`

`/native <command>` 会把受支持的只读原生命令转发给当前 executor；`/codex <command>` 和 `/claude <command>` 分别固定转发给 Codex CLI 与 Claude Code CLI。Codex / Claude Code 会话中的 `/status` 优先使用原生命令桥接状态。

命令结果会写回 `session_messages`，因此刷新页面后仍可恢复。

## 已知限制

- 会话层当前以“每条用户消息驱动一个底层 task”的方式复用 MVP 执行链路，后续可进一步升级为执行器原生长会话
- 会话消息历史当前默认加载最近 200 条，尚未实现虚拟滚动
- Workbench 已支持移动端基础可用，但左/右侧栏仍是响应式堆叠而非专用 Drawer / Bottom Sheet
- 当前没有可用的 Cursor executor；真实 Cursor background agent 集成仅保留在未来路线图中
- Codex/Claude Code 的运行时工具审批仍以 Workbench preflight/prompt-level gate 为主，尚未接入 provider 原生中途审批协议；capability 状态记录为 `not_supported`
- remote worker 已使用可撤销 credential token；旧 `device.id` token 不再兼容
