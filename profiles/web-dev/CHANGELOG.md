# Changelog

## 2026-09-27 —— 23 个成员全部上架，README 重构

- 全部 23 个成员已在 npm 发布（local-agent 家族为 `0.1.0-rc` 预发布线）；依赖区间对齐到各成员最新发布线（local-agent 家族用 `^0.1.0-rc.1` 容纳预发布）。
- README 重构为「插件列表（可复制包名 + 版本兼容）→ 功能展示（local-agent / worktrees / room + 元包打包装）→ preset → 运维」;安装指南折叠至文末，单包安装推荐官方「添加插件」对话框；新增 bundle-local-agent 详情页截图。
- 成员分层修正：12 个与 dsh-basic 共享 + 11 个本包独有。

## Unreleased

- 首个版本：21 个成员的开发模式 profile（基础体验 12 + 开发能力 8 + 运维守护 1）。
- 同端口交接脚本 `restart-into-web-dev.sh`，走 ankh-guard 守卫通道。
- 成员清单以「已合 main 且 3080 验收过」为准；`mission` 待上 3080 后加入。
- M4'③：mission / datasets / eval 拆成 core + companion（core 不再注册模型工具与提示词段）。**开发模式 preset 刻意不引用这三条伴生行**：三个 core 不在本 pack 的成员清单里（孵化中），而伴生包运行时要 import core 的 `./tool` 工厂——缺行会让整个 dev preset 报 broken。等它们上架、并加进 `package.json` 的 dependencies 之后再补三行；本 pack 的 dev preset 现在与拆分前逐字等价。
- 首版不自带 agent preset，使用官方 `standard`——preset 无 patch 语义，复制即快照漂移，差异化需求明确后再做。
