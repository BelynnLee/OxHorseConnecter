# 文档维护规则

语言：简体中文 | [English](documentation-guide.en.md)

本文档定义本仓库的双语文档维护方式。当前以中文文档作为事实源，英文文档用于 GitHub 公开展示和非中文读者快速理解项目状态。

## 命名规则

- 中文文档使用原文件名，例如 `README.md`、`roadmap.md`。
- 英文文档使用 `.en.md` 后缀，例如 `README.en.md`、`roadmap.en.md`。
- 每个双语文档顶部都要有语言切换链接。
- 归档目录 `docs/archive/` 默认不要求翻译，除非它重新成为当前事实的一部分。

## 同步范围

修改以下文档时，应同步检查英文版本：

- 根目录 `README.md`
- 根目录 `CHANGELOG.md`
- `docs/README.md`
- `docs/roadmap.md`
- `docs/security.md`
- `docs/deployment-guide.md`
- `docs/production-deployment.md`
- `docs/api.md`

如果暂时不能同步完整英文版，应在英文文件顶部标注：

```md
> Translation status: may lag behind the Simplified Chinese version.
```

## 维护原则

- 中文文档是当前 source of truth。
- 英文文档不需要逐字直译，但必须保留项目状态、风险提示、运行命令、安全边界和已知限制。
- WIP / Alpha、未上线测试、非生产可用等状态提示必须在中英文文档中同时出现。
- 命令、路径、环境变量和 API 路径应保持一致，不要在翻译时改写。
- 新增重要章节时，同时更新文档入口 `docs/README.md` 和 `docs/README.en.md`。

## 当前英文覆盖

- [`../README.en.md`](../README.en.md)
- [`../CHANGELOG.en.md`](../CHANGELOG.en.md)
- [`README.en.md`](README.en.md)
- [`roadmap.en.md`](roadmap.en.md)
- [`documentation-guide.en.md`](documentation-guide.en.md)

其他详细文档可以逐步补齐英文版。
