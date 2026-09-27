# Changelog

## 2026-09-28 —— room-tool 回并 room 的 `./tool` 子路径

- room-tool 并入 room 的 `./tool` 组合入口（0.2.0，preset 行 id `room-tool` 不变、组合状态不受影响；worktrees 0.3.0 同款回并）。成员计数 22（13 共享 + 9 独有）；安装自检的行数口径不变（room-tool 从不挂 profile 根行）。

## 2026-09-27 —— 更名 dsh-dev；quote / mobile 加入；预览与工具面合并

- 整合包仓与 profile 名 dsh-web-dev / web-dev → **dsh-dev / dev**（脚本 `restart-into-dev.sh`，profile 目录 `$DSH_HOME/profiles/dev`）；GitHub 旧名保留重定向
- quote、mobile 加入，与 dsh-basic 完全对齐
- 合并包落地：ui-file-preview 并入 file-preview（0.4.0，行 id 合一）；worktrees-tool 并入 worktrees 的 `./tool` 子路径（0.3.0，preset 行 id `worktrees-tool` 不变）。成员计数最终 23（13 共享 + 10 独有）

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
