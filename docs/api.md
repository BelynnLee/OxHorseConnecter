# API 说明

以下接口均由 Host 提供，默认前缀为 `/api`。

## Auth

### `POST /api/auth/login`

请求体：

```json
{
  "username": "admin",
  "password": "admin123"
}
```

返回：

```json
{
  "ok": true,
  "data": {
    "token": "jwt-token",
    "user": {
      "id": "user-admin",
      "username": "admin",
      "createdAt": "2026-04-12T00:00:00.000Z"
    }
  }
}
```

### `POST /api/auth/logout`

MVP 中为前端本地退出，占位接口。

### `GET /api/auth/me`

需要 `Authorization: Bearer <token>`。

## Devices

### `GET /api/devices`

返回设备列表。

### `POST /api/devices/register`

用于外部 Host 注册设备；当前 Host 启动时也会自动完成自注册。

生产或 HTTPS 模式必须带请求头：

- `x-rac-registration-token: <REMOTE_REGISTRATION_TOKEN>`

返回的 `deviceToken` 是一次性明文 remote worker credential，格式为 `racw_<credentialId>_<secret>`。数据库只保存 hash。

注册请求可以上报 `workRoot` 和 `workRootExists`。Host 自注册会使用本机 `ALLOWED_WORK_DIR`；remote worker 应使用本机的 `RAC_REMOTE_ALLOWED_WORK_DIR`（未设置时回退到 worker 本机 `ALLOWED_WORK_DIR`）。设备列表会返回这两个字段，控制台据此判断 worker 工作区是否可执行。

### `GET /api/devices/:id/credentials`

返回设备 credential 列表，不包含 token hash 或明文 token。

### `POST /api/devices/:id/credentials`

为设备签发新的 credential。返回值中的 `token` 只显示一次。

### `POST /api/devices/:id/credentials/:credentialId/revoke`

撤销指定 credential。被撤销的 credential 不能再访问 `/api/remote/*`。

### `POST /api/devices/:id/trust`

将设备标记为可信。

### `POST /api/devices/:id/untrust`

取消设备信任。

## Projects

### `GET /api/projects`

返回已注册项目。可使用 `deviceId` 过滤。

### `POST /api/projects`

请求体：

```json
{
  "deviceId": "device-id",
  "name": "demo",
  "path": "D:/workspace/demo"
}
```

`deviceId` 是必填项。Host 本机项目会做真实路径和 `ALLOWED_WORK_DIR` 校验；remote worker 项目只在 Host 侧做字符串级校验并绑定到可信设备，最终路径边界由 worker 按本机工作根目录校验。项目匹配键是 `(deviceId, path)`，不同 worker 可以注册相同路径字符串。

## Tasks

### `GET /api/tasks`

支持参数：

- `status`
- `deviceId`
- `page`
- `limit`

### `POST /api/tasks`

请求体：

```json
{
  "deviceId": "device-id",
  "executorType": "mock",
  "title": "Fix build",
  "prompt": "Please fix the build error",
  "workDir": "D:/workspace/demo",
  "autoApprove": false
}
```

### `GET /api/tasks/:id`

返回任务详情对象：

- `task`
- `events`
- `approvals`
- `diff`

### `POST /api/tasks/:id/cancel`

取消任务。

### `GET /api/tasks/:id/events`

返回任务事件列表。

### `GET /api/tasks/:id/diff`

返回任务 diff；若无改动则返回 `null`。

## Approvals

### `GET /api/approvals`

支持参数：

- `status`
- `taskId`

### `POST /api/approvals/:id/approve`

批准审批请求。

### `POST /api/approvals/:id/reject`

拒绝审批请求。

## Security

### `GET /api/security/rules`

返回当前风险规则。

### `GET /api/security/audit`

返回安全审计事件。支持参数：

- `limit`
- `cursor`
- `actorType`
- `severity`
- `eventType`

### `GET /api/security/readiness`

返回云端部署就绪检查，覆盖 HTTPS/proxy/cookie/CORS、`ALLOWED_WORK_DIR`、query token、remote registration token、worker workspace root 和真实 executor 可用性。

## Realtime

### `GET /api/stream`

SSE 接口，支持参数：

- `taskId`
- `token`

返回统一信封：

```json
{
  "channel": "task.event",
  "sentAt": "2026-04-12T00:00:00.000Z",
  "payload": {}
}
```

当前已使用的 channel：

- `task.event`
- `approval.event`
- `device.event`

## Agent Workbench API

These endpoints expose the Agent Workbench protocol for browser clients and for
clients that do not want to depend on raw provider streams or internal task
events.

### `POST /api/agent/sessions`

Request:

```json
{
  "deviceId": "device-id",
  "projectPath": "D:/workspace/demo",
  "prompt": "Fix the failing build",
  "model": "gpt-5.3-codex",
  "mode": "agent"
}
```

Response:

```json
{
  "sessionId": "session-id",
  "status": "running",
  "deviceId": "device-id"
}
```

`deviceId` is required. The device must exist, be online, be trusted, and support
the requested executor. `mode` can be `agent`, `plan`, or `review`.

### `GET /api/agent/sessions/:sessionId/events`

SSE stream. Each `data` frame is an `AgentEvent`, for example:

```json
{
  "type": "assistant.delta",
  "id": "message-id",
  "delta": "Partial assistant text",
  "createdAt": "2026-04-29T00:00:00.000Z"
}
```

The stream replays the session snapshot first, then sends live updates.
Known event groups include `session.*`, `user.message`, `assistant.*`,
`step.*`, `tool.*`, `file.changed`, `diff.updated`, `approval.requested`, and
`debug`.

### `GET /api/agent/sessions/:sessionId`

Returns the persisted session and messages.

### `POST /api/agent/sessions/:sessionId/cancel`

Cancels the active Codex run for the session.

### `GET /api/agent/sessions/:sessionId/diff`

Returns the latest persisted diff for the session.

### `GET /api/agent/sessions/:sessionId/logs`

Returns task log events and a terminal-friendly text stream.

### `POST /api/agent/sessions/:sessionId/open-file`

Request:

```json
{
  "path": "src/App.tsx"
}
```

The host validates that the target stays inside the session working directory,
then opens/selects it in the OS file manager.

### `GET /api/agent/models`

Returns model profiles.

### `POST /api/agent/settings/model`

Persists the default model for new `/api/agent/sessions` runs.

### `POST /api/agent/native-terminal/authorizations`

Creates a short-lived authorization for opening a new native terminal. This is
only required for provider `shell`; `codex` and `claude-code` return an allowed
result without an authorization id.

Request:

```json
{
  "provider": "shell",
  "projectPath": "D:/workspace/demo",
  "deviceId": "device-id",
  "sessionId": "session-id",
  "confirm": false
}
```

Response when an explicit confirmation is still required:

```json
{
  "authorized": false,
  "decision": "ask",
  "riskLevel": "high",
  "reason": "No permission rule matched; high-risk input requires approval."
}
```

Response after approval, or when a matching rule allows Shell terminals:

```json
{
  "authorized": true,
  "authorizationId": "authorization-id",
  "expiresAt": "2026-05-13T12:00:00.000Z",
  "decision": "ask",
  "riskLevel": "high",
  "reason": "No permission rule matched; high-risk input requires approval."
}
```

The authorization id is bound to the requesting user, target device, project
path, and optional session id. It expires quickly and is consumed once by the
terminal WebSocket connection.

### `WS /api/agent/native-terminal`

Browser WebSocket endpoint for the Remote TUI panel.

Query parameters:

- `provider`: `shell`, `codex`, or `claude-code`
- `projectPath`: working directory
- `deviceId`: optional target device; omitted or host id means local Host PTY
- `sessionId`: optional Workbench session to mirror provider runtime state
- `terminalId`: optional existing terminal id to reattach
- `authorizationId`: required only when creating a new `shell` terminal
- `arg`: repeated launch arg for `codex` or `claude-code`; rejected for `shell`
- `cols`, `rows`: terminal size

Client messages:

```json
{ "type": "input", "data": "pwd\r" }
{ "type": "resize", "cols": 120, "rows": 36 }
{ "type": "kill" }
```

Server messages include `ready`, `output`, `state`, `exit`, and `error`.
`state` is currently used for Codex native runtime mirroring.

## Remote Worker

These endpoints are used by a paired machine running `pnpm --filter @rac/host remote:dev`.
The worker authenticates with:

- `x-rac-device-id`
- `x-rac-device-token`

The token must be the `racw_...` credential returned by `POST /api/devices/register`
or `POST /api/devices/:id/credentials`. Legacy `device.id` tokens are rejected.
The device must be trusted in the console before it can claim tasks, but heartbeat
continues to be accepted for status reporting when a valid credential is present.

### `POST /api/remote/heartbeat`

Updates remote device `lastSeenAt`, online status, executor probe results, and
workspace fields:

```json
{
  "status": "online",
  "executors": ["codex", "claude-code"],
  "workRoot": "/srv/rac-worker/workspaces",
  "workRootExists": true
}
```

### `POST /api/remote/tasks/claim`

Claims the next queued task assigned to the remote device and supported by its
available executors. The device must be trusted and must report `workRoot` with
`workRootExists=true`; otherwise claim returns a conflict and no executor is
started. The worker performs final `task.workDir` validation against its local
workspace root before running Codex/Claude.

### `POST /api/remote/tasks/:id/events`

Streams task logs and tool events back to the controller.

### `POST /api/remote/tasks/:id/approval-request`

Creates a controller-side approval and blocks until approve/reject/timeout.

### `POST /api/remote/tasks/:id/complete`

Marks a remote task completed and persists optional diff data.

### `POST /api/remote/tasks/:id/fail`

Marks a remote task failed.

### `GET /api/remote/tasks/:id/status`

Lets a worker observe cancellation while the local Codex process is running.

### `WS /api/remote/native-terminal`

Remote worker WebSocket bridge for native terminal sessions. The worker
authenticates with the same `x-rac-device-id` and `x-rac-device-token` headers
as `/api/remote/*` HTTP endpoints, using a credential with terminal scope.

The controller sends `create`, `input`, `resize`, `kill`, and `ping` control
messages. The worker starts the requested provider in a local PTY and sends back
`ready`, `output`, `state`, `exit`, or `error` messages. Shell terminals are
authorized by the controller before the `create` message is sent.
