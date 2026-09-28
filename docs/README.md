# docs 导航

[English](README.en.md) | 中文

本目录是仓库的文档层。按读者分四类：

## 协作文档（人怎么一起改这个仓）

| 文档 | 内容 |
| --- | --- |
| [development.md](development.md) | 协作模型：worktree 开发、三条路径（worktree → main → 3080、宿主跟踪、npm 波）、冲突规则 |
| [ops.md](ops.md) | 部署与运维：三环境（link / tarball / npm)、`deploy:3080` 自助流程、ankh-guard 重启闸、部署卡住的处置手册 |
| [publishing.md](publishing.md) | npm 发布最佳实践：staged publishing、新包首发的 device flow、失败对照表 |
| [plugin-visibility.md](plugin-visibility.md) | 插件可见性规范：会话绑定面随 preset 自隐、跨会话面由安装层决定 |
| [tool-origin-guide.md](tool-origin-guide.md) | 模型工具 origin 标注指南（`setToolOrigin`) |
| [host-migration-playbook.md](host-migration-playbook.md) | 宿主版本迁移 playbook（跨宿主线的适配步骤） |

## 专项协议与登记

| 文档 | 内容 |
| --- | --- |
| [dataset-authoring-protocol.md](dataset-authoring-protocol.md) | 数据集出题协议（eval 线的题库/条件/计划格式） |
| [upstream-seam-registry.md](upstream-seam-registry.md) | 上游接缝登记处：插件依赖的宿主接缝逐条编号，宿主审计按此走查 |
| [roadmap.md](roadmap.md) | 产品路线图（上位文档）：分层模型、domain 与优先级；proposal 立项先在这里找落点 |

## 机器生成（勿手改）

| 文档 | 生成命令 |
| --- | --- |
| [packages.md](packages.md) | `pnpm map:packages`——权威包地图（包数、形态、profile 归属） |
| [release-status.md](release-status.md) | `pnpm release:status`——各包 npm/仓内版本与宿主兼容矩阵 |

## 工作区子目录

| 目录 | 内容 |
| --- | --- |
| [acceptance/](acceptance/) | 功能验收记录（按日期归档，各次上线前的活体验证） |
| [upstream-proposals/](upstream-proposals/) | 给上游（deepseek-harness）的提案与设计稿，含 HTML 原型 |
| [screenshots/](screenshots/) | 文档引用的截图素材池（git add -f 跟踪） |
