# 安全说明

当前实现的是 MVP 级别的最小安全能力，目标是让任务闭环先成立，同时对明显高风险操作具备基础防护。

## 已实现能力

### 1. 用户认证

- 使用 JWT 作为访问令牌，默认写入 HttpOnly cookie
- Web 页面未登录不可访问
- Host 侧 API 路由默认校验 cookie 或 Bearer Token
- 非 GET 请求需要 CSRF 头，避免纯 cookie 会话被跨站提交
- SSE 默认使用 cookie 认证；`ALLOW_QUERY_TOKEN_AUTH=true` 时才允许 query token
- 登录失败有内存限流，生产/HTTPS 模式会强制校验强 secret

### 2. 密码存储

- 新密码使用 Node scrypt KDF 加盐哈希
- 旧的明文/占位密码值只为兼容已有本地安装，登录成功后会升级为 scrypt 哈希
- `ADMIN_PASSWORD` 和 `JWT_SECRET` 在生产或 HTTPS 模式下必须满足强度要求

### 3. 设备信任

- Host 启动时会自动注册本机设备
- 新设备默认 `trusted = false`
- 只有已信任且在线的设备可接收任务
- 远端 worker 使用 `device_credentials` 表中的可撤销 credential；token 形如 `racw_<credentialId>_<secret>`，只在签发时返回明文，数据库仅保存 hash
- 生产或 HTTPS 模式下，`/api/devices/register` 必须携带 `x-rac-registration-token`，其值来自 `REMOTE_REGISTRATION_TOKEN`
- `/api/remote/*` 只接受新 credential token；旧的 `device.id` token 会被拒绝

### 4. 风险识别

`packages/security/src/risk.ts` 当前提供：

- 高危 shell 命令模式识别
- Git 强制操作识别
- `.env` / `pem` / `key` 等敏感文件识别
- 工作目录越界识别
- `RISK_RULES_PATH` 外部 JSON 规则叠加
- `GET /api/security/rules` 查询当前规则

### 5. 审批机制

- 执行器可以发起审批请求
- Host 会将任务状态切到 `waiting_approval`
- 支持 approve / reject
- 超时自动拒绝
- 任务在等待审批时支持取消
- Workbench permission rules 支持 `allow`/`ask`/`deny`，并记录命中历史
- Shell Remote TUI 启动前会按 provider `shell`、input type `tool`、高风险等级走同一套 permission rules；`ask` 结果需要用户显式确认

### 6. 工作目录限制

- 通过 `ALLOWED_WORK_DIR` 配置允许访问的根目录
- 创建任务时会对传入 `workDir` 做越界判断
- 会话 diff/discard 会校验路径保持在 session 工作目录内
- Shell 终端授权会绑定目标设备、项目路径和用户；本机路径会先校验存在并保持在 `ALLOWED_WORK_DIR` 内，远端路径在 worker 侧再次校验

### 7. 日志脱敏

当前会对日志和事件 payload 中常见敏感字段做基础脱敏：

- `api_key`
- `Bearer token`
- `password`
- `secret`
- `access_token`

### 8. 安全审计

- `security_audit_events` 记录登录成功/失败、设备注册、credential 创建/撤销/认证失败、trust/untrust、remote claim/report、审批决策、权限命中和配置变更
- Shell 终端会记录授权请求、授权拒绝、授权成功、终端启动和终端退出审计事件
- `GET /api/security/audit` 支持 `limit`、`cursor`、`actorType`、`severity`、`eventType` 过滤
- 审计 metadata 复用日志脱敏逻辑，不保存明文 token、API key、prompt 全文或完整 stdout/stderr

### 9. Provider strict profile

- `AGENT_SECURITY_PROFILE=strict` 会拒绝 `CODEX_FULL_AUTO=true` 和 `CLAUDE_CODE_SKIP_PERMISSIONS=true`
- Codex plan/review 强制 `--sandbox read-only`；agent 在非 full-auto 时显式使用 `--sandbox workspace-write`
- Claude Code plan/review 使用 `--permission-mode plan`；strict 配置下禁用 bypassPermissions，并传入保守 `--disallowedTools`
- 默认执行路径已接入 provider 原生运行时审批：
  - `ClaudeAgentSdkExecutor` 通过 SDK 的 `canUseTool` 回调把每次工具调用桥接到 Workbench 审批 (`apps/host/src/services/claude-agent-sdk-executor.ts` 第 309-373 行)
  - `CodexAppServerExecutor` 通过 JSON-RPC 的 `approvalPolicy: on-request` 接收审批请求 (`apps/host/src/services/codex-app-server-executor.ts` 第 182-194、728 行)
- 旧版 `claude-code` / `codex` CLI 子进程执行器仍只能依赖 preflight + sandbox 参数，未来逐步淘汰

## Remote Worker Workspace Boundary

- Strict/production Host deployments require `ALLOWED_WORK_DIR`; `/api/browse` only returns directories inside that root and never exposes Windows drives or filesystem roots.
- A remote worker reports `workRoot` and `workRootExists` during registration, heartbeat, and task claim. In strict worker mode, set `RAC_REMOTE_ALLOWED_WORK_DIR`; when unset it falls back to the worker-local `ALLOWED_WORK_DIR`.
- Before starting an executor, the worker resolves `task.workDir`: empty means worker root, relative paths are joined under worker root, and absolute paths must still remain inside worker root. Missing or out-of-root paths fail the task before the executor starts.
- Remote TUI uses the same worker-side path resolver as remote tasks.
- Remote projects and permission rules are matched by `(deviceId, path)` so identical local paths on two trusted workers do not share project state or policy accidentally.

## 当前限制

- 风险识别仍是规则式，不是沙箱级别执行限制
- Shell Remote TUI 的审批发生在打开交互式 shell 前；进入 shell 后，用户键盘输入会直接发送到 PTY，不会逐条命令再审批
- 默认执行器（`ClaudeAgentSdkExecutor` / `CodexAppServerExecutor`）已使用 provider 原生运行时审批；如果通过 `RAC_CLAUDE_AGENT_SDK_DISABLED=1` 或 `RAC_CODEX_APP_SERVER_DISABLED=1` 强制回退到 CLI 子进程执行器，则只剩 preflight 审批
- 本地执行器的实际系统访问边界仍取决于 CLI 自身权限、工作目录和操作系统账号
- `security_audit_events` 当前由 SQLite 保存，生产环境需要配合数据库备份、保留期和外部日志汇聚策略

## 后续增强方向

- 对真实执行器输出做更细粒度的风险标注和审计
- 增加会话失效、刷新令牌与设备令牌体系
- 将审计事件导出到集中日志/SIEM
