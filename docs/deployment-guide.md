# Remote Agent Console 部署教程

本文档面向第一次部署 Remote Agent Console（RAC）的维护者，目标是在一台服务器上部署 Web 控制台、Host API、SQLite 数据库和可选 AI service。更偏运维检查清单的内容见 [`production-deployment.md`](production-deployment.md)。

## 1. 部署拓扑

推荐的生产拓扑：

```text
Browser
  |
  | HTTPS
  v
Nginx / Caddy
  |-- serve static files: apps/web/dist
  |-- proxy /api/* and /ws* -> 127.0.0.1:3001
  v
RAC Host (@rac/host)
  |-- SQLite: data/rac.db
  |-- workspace boundary: data/workspaces
  |-- optional AI service: 127.0.0.1:8010
```

关键原则：

- 不要把 Host API 直接暴露到公网，Host 只监听 `127.0.0.1:3001`。
- TLS 在 Nginx 或 Caddy 终止。
- Web 静态文件和 Host API 使用同一个可信域名，例如 `https://console.example.com`。
- 生产环境使用仓库根目录 `.env`，不要创建或部署 `apps/.env`。

### Cloud Host + Remote Worker Path

Recommended personal-cloud shape:

```text
Browser -> HTTPS reverse proxy -> Host/Web on cloud VM (127.0.0.1:3001)
Remote worker on home/office machine -> poll /api/remote/* -> Host
Remote worker -> runs Codex/Claude in RAC_REMOTE_ALLOWED_WORK_DIR
```

Use this shape when the real code checkout lives on a home or office machine. Keep the cloud Host workspace small and controlled; remote project paths are stored as worker-local strings and are finally validated by the worker.

Remote worker setup checklist:

- Cloud Host `.env`: `NODE_ENV=production`, `REQUIRE_HTTPS=true`, `TRUST_PROXY=true`, `AUTH_COOKIE_SECURE=true`, `ALLOW_QUERY_TOKEN_AUTH=false`, `ALLOWED_WORK_DIR=<controlled cloud workspace>`, `REMOTE_REGISTRATION_TOKEN=<strong secret>`.
- Worker `.env`: `RAC_CONTROLLER_URL=https://console.example.com`, `RAC_REMOTE_REGISTRATION_TOKEN=<same registration secret>`, `RAC_REMOTE_ALLOWED_WORK_DIR=<worker-local repo root>`.
- First worker start prints one-time `RAC_REMOTE_DEVICE_ID` and `RAC_REMOTE_DEVICE_TOKEN`; save them on the worker and then remove `RAC_REMOTE_REGISTRATION_TOKEN` if you no longer need registration from that machine.
- Trust the device in the Devices page. The device must report `workRoot` and `workRootExists=true` before it can claim tasks or open Remote TUI.

## 2. 准备服务器

最低要求：

- Node.js 18 或更高版本。
- Corepack 和 pnpm。
- Git。
- 可写的数据目录，用于 SQLite、日志、备份和受控工作区。
- 如果启用真实执行器，服务器上需要安装并登录 `codex` CLI 或 `claude` CLI。
- 如果启用 AI service，需要 Python 和 `uv`。

PowerShell：

```powershell
corepack enable
node --version
corepack pnpm --version
git --version
```

Linux shell：

```bash
corepack enable
node --version
pnpm --version
git --version
```

## 3. 获取代码

在服务器上 clone 或更新代码：

```bash
git clone <your-repository-url> rac
cd rac
```

如果已经部署过，先备份数据库，再更新代码：

```powershell
corepack pnpm db:backup
git pull --ff-only
```

## 4. 生成生产配置

复制生产模板：

```powershell
Copy-Item .env.production.example .env
```

Linux shell：

```bash
cp .env.production.example .env
```

至少修改这些值：

```dotenv
NODE_ENV=production
HOST_HOSTNAME=127.0.0.1
HOST_PORT=3001
PUBLIC_BASE_URL=https://console.example.com
REQUIRE_HTTPS=true
TRUST_PROXY=true
CORS_ORIGINS=https://console.example.com
AGENT_SECURITY_PROFILE=strict

ADMIN_USERNAME=admin
ADMIN_PASSWORD=<strong-admin-password>
JWT_SECRET=<strong-random-secret-at-least-32-chars>
PROVIDER_SECRET_KEY=<strong-random-secret-at-least-32-chars>
REMOTE_REGISTRATION_TOKEN=<strong-random-secret-at-least-32-chars>

AUTH_COOKIE_SECURE=true
ALLOW_QUERY_TOKEN_AUTH=false
DB_PATH=./data/rac.db
ALLOWED_WORK_DIR=./data/workspaces

VITE_API_URL=https://console.example.com
VITE_SSE_URL=https://console.example.com/api/stream
VITE_WS_URL=wss://console.example.com
```

生成随机密钥：

```powershell
-join ((48..57) + (97..122) | Get-Random -Count 64 | ForEach-Object {[char]$_})
```

Linux shell：

```bash
openssl rand -hex 32
```

注意：`VITE_API_URL`、`VITE_SSE_URL` 和 `VITE_WS_URL` 是构建时变量，必须在构建 Web 前写好。

## 5. 安装依赖和构建

安装依赖：

```powershell
corepack pnpm install --frozen-lockfile
```

运行构建和基础验证：

```powershell
corepack pnpm verify:mvp
corepack pnpm lint
```

如果要执行完整 release gate：

```powershell
corepack pnpm run ci
```

说明：

- `verify:mvp` 会构建共享 packages、Host 和 Web。
- `build:web` 会读取 `.env` 中的 `VITE_*` 变量并写入前端 bundle。
- AI service 是可选组件，不启用 RAG、评估或失败分析时可以不部署。

## 6. 准备运行目录

创建数据库、日志和工作区目录：

```powershell
New-Item -ItemType Directory -Force data, data\logs, data\workspaces, data\backups
```

Linux shell：

```bash
mkdir -p data/logs data/workspaces data/backups
```

如果希望 Host 写文件日志，在 `.env` 中启用：

```dotenv
LOG_FILE_PATH=./data/logs/rac-host.log
LOG_FILE_KEEP_DAYS=30
```

## 7. 配置反向代理

项目提供了两个示例：

- Nginx: [`nginx.conf.example`](nginx.conf.example)
- Caddy: [`Caddyfile.example`](Caddyfile.example)

### Nginx

将 Web 构建产物复制到静态目录：

```bash
sudo mkdir -p /var/www/rac-web
sudo rsync -a --delete apps/web/dist/ /var/www/rac-web/
```

复制代理 header snippet：

```bash
sudo cp docs/nginx-rac-proxy.snippet.conf /etc/nginx/snippets/rac-proxy.conf
```

将 `docs/nginx.conf.example` 复制到站点配置，替换 `console.example.com` 和证书路径后检查配置：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### Caddy

将 `docs/Caddyfile.example` 复制到 Caddy 配置，替换域名和静态目录后启动：

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## 8. 启动 Host

前台试运行：

```powershell
corepack pnpm --filter @rac/host start
```

看到 Host 正常监听后，访问：

```text
https://console.example.com/api/health
```

Linux 生产环境可以用 systemd 管理进程。示例：

```ini
[Unit]
Description=Remote Agent Console Host
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/rac
Environment=NODE_ENV=production
ExecStart=/usr/bin/corepack pnpm --filter @rac/host start
Restart=on-failure
RestartSec=5
User=rac
Group=rac

[Install]
WantedBy=multi-user.target
```

保存为 `/etc/systemd/system/rac-host.service` 后：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rac-host
sudo systemctl status rac-host
```

Windows 服务器可以用 NSSM、PM2 或 Windows Task Scheduler 托管同一个启动命令，工作目录必须指向仓库根目录。

## 9. 可选 AI Service

只有在使用 RAG 索引、评估或失败分析接口时才需要启动：

```powershell
python -m uv run --project apps/ai-service pytest
python -m uv run --project apps/ai-service uvicorn app.main:app --host 127.0.0.1 --port 8010
```

然后在根目录 `.env` 中配置：

```dotenv
AI_SERVICE_URL=http://127.0.0.1:8010
```

重启 Host 使配置生效。

## 10. 首次登录和设备信任

1. 打开 `https://console.example.com`。
2. 使用 `.env` 中的 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 登录。
3. 进入设备页，确认本机设备已注册。
4. 信任本机设备。
5. 在 Workbench 中选择受控工作目录、执行器和模型。

如果使用真实 Codex 或 Claude Code 执行器，先在服务器上确认 CLI 可用：

```powershell
codex --version
claude --version
```

## 11. 健康检查和监控

本地探测：

```powershell
corepack pnpm health:check
```

探测生产域名：

```powershell
corepack pnpm health:check -- -BaseUrl https://console.example.com
```

外部监控可以直接检查：

```text
https://console.example.com/api/health
```

## 12. 数据库备份

手动备份：

```powershell
corepack pnpm db:backup
```

保留 30 天并压缩：

```powershell
corepack pnpm db:backup -- -KeepDays 30 -Compress
```

上传到对象存储或 rclone 目标：

```powershell
corepack pnpm db:backup -- -Compress -S3Bucket s3://your-bucket/rac/
corepack pnpm db:backup -- -Compress -RcloneTarget remote:rac-backups
```

建议在每次部署前和每天凌晨定时备份 SQLite 数据库。

Backup these separately:

- SQLite database (`DB_PATH`) with `pnpm db:backup`.
- Host `.env`, including `JWT_SECRET`, `PROVIDER_SECRET_KEY`, and `REMOTE_REGISTRATION_TOKEN`.
- Remote worker `.env` or secret store containing `RAC_REMOTE_DEVICE_ID` and `RAC_REMOTE_DEVICE_TOKEN`.
- Code repositories under each worker workspace. Do not treat `ALLOWED_WORK_DIR` or `RAC_REMOTE_ALLOWED_WORK_DIR` as disposable cache directories unless the repositories are backed up elsewhere.

## 13. 更新部署

标准更新流程：

```powershell
corepack pnpm db:backup
git pull --ff-only
corepack pnpm install --frozen-lockfile
corepack pnpm verify:mvp
corepack pnpm lint
```

重新发布 Web 静态文件，然后重启 Host：

```bash
sudo rsync -a --delete apps/web/dist/ /var/www/rac-web/
sudo systemctl restart rac-host
```

验证：

```powershell
corepack pnpm health:check -- -BaseUrl https://console.example.com
```

## 14. 回滚

1. 停止接收新任务或会话。
2. 停止 Host 进程。
3. 回到上一个应用版本。
4. 恢复部署前的 SQLite 备份。
5. 重新发布上一版 Web 静态文件。
6. 启动 Host。
7. 检查 `/api/health` 并登录控制台确认核心页面可用。

不要在不了解当前会话工作区状态的情况下批量删除 `ALLOWED_WORK_DIR` 下的文件。

## 15. 常见问题

**登录后接口 401 或 cookie 不生效**

检查 `PUBLIC_BASE_URL`、`CORS_ORIGINS`、`AUTH_COOKIE_SECURE` 和反向代理的 `X-Forwarded-*` header。生产 HTTPS 场景应设置 `TRUST_PROXY=true` 和 `AUTH_COOKIE_SECURE=true`。

**Web 能打开但 API 请求指向了旧地址**

`VITE_API_URL` 是构建时变量。修改 `.env` 后需要重新执行 `corepack pnpm build:web`，并重新发布 `apps/web/dist`。

**SSE 无实时输出**

确认反向代理对 `/api/stream` 禁用了 buffering，并设置了较长的 read timeout。参考 Nginx 和 Caddy 示例配置。

**真实执行器不可用**

检查 `CODEX_COMMAND` 或 `CLAUDE_CODE_COMMAND` 是否在运行 Host 的系统账号 `PATH` 中可用，并确认 CLI 已登录。

**生产启动失败并提示 secret 强度不足**

替换 `.env` 中所有 `<CHANGE_ME_*>` 占位符，确保 `ADMIN_PASSWORD` 至少 12 位，`JWT_SECRET`、`PROVIDER_SECRET_KEY` 和 `REMOTE_REGISTRATION_TOKEN` 至少 32 位随机值。
