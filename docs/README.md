# 项目文档目录

语言：简体中文 | [English](README.en.md)

本文档把“当前实现事实”和“历史规划材料”分开维护。日常开发、部署和排查问题时，优先从本文件和根目录
[`README.md`](../README.md) 开始。

当前项目状态是 WIP / Alpha。文档中的部署、生产配置和 release readiness 内容用于说明目标边界和准备清单，不代表项目已经完成正式上线测试。

## 当前事实

- [架构说明](architecture.md)：当前 monorepo 结构、运行模块和数据流。
- [API 说明](api.md)：REST、实时流、Workbench 和 remote worker 接口。
- [安全说明](security.md)：已实现的安全边界、部署要求和当前限制。
- [中文部署教程](deployment-guide.md)：从服务器准备到启动、备份和回滚的部署步骤。
- [生产部署 runbook](production-deployment.md)：生产门禁、备份、监控和回滚。
- [Agent Workbench](agent-workbench.md)：Workbench 行为和会话能力。
- [Agent Workbench 验收](agent-workbench-acceptance.md)：Workbench 行为的手工验收场景。
- [开发路线](roadmap.md)：当前状态和后续建议。
- [更新记录](../CHANGELOG.md)：公开仓库时使用的更新记录、未发布事项和已知问题。
- [文档维护规则](documentation-guide.md)：双语文档命名、同步和状态标注规则。

## 运行辅助

- [Claude Code Workbench quickstart](claude-code-workbench-quickstart.md)：新 clone 后启动 Workbench 的详细指南。
- [Workbench regression matrix](workbench-regression-matrix.md)：发布信心和覆盖关系矩阵。
- [Nginx 示例](nginx.conf.example) 和 [proxy snippet](nginx-rac-proxy.snippet.conf)：反向代理配置。
- [Caddy 示例](Caddyfile.example)：另一种反向代理配置。
- [AI service README](../apps/ai-service/README.md)：可选 Python 服务说明。
- [E2E README](../tests/e2e/README.md) 和 [integration README](../tests/integration/README.md)：测试套件说明。

## 发布材料

- [Claude Code Workbench MVP 发布材料](releases/claude-code-workbench-mvp/README.md)：MVP 里程碑的 release notes 和 acceptance record。
