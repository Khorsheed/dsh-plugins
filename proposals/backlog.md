# 能力缺口池（Backlog：待插件化能力）

> **来源**：2026-08-18 对个人历史提案档案（dsh-salvage-2026-08-16 快照的 personal-plugins-proposals/，本仓库外）的完整能力盘点。
> **规则**：backlog 只登记"还没以可插拔插件交付的能力"，**不占正式提案生命周期**（不设状态机，认领后才建提案）。
> **认领**：建 `active/YYYY-MM-DD-<slug>.md` + README 总表加行 + 本文件该项标注「已认领 → 提案 `<slug>`」。
> **目标**（与本仓库提案体系一致）：所有能力最终以可插拔插件交付、零官方代码改动；标注"patch 依赖"的项，认领时提案必须写明**去补丁化路径**。

## A 组：个人 setup 已实现 / 已验证，但未进社区仓库（迁移 + 去补丁化缺口）

| 能力 | 历史状态 | 当前实现形态 | 官方依赖 / 补丁 | 备注 |
|---|---|---|---|---|
| 会话记忆库（memory-plugin：增量抽取 + 图谱检查器/纠偏） | verified | 个人 `memory` 包（host+browser，零补丁） | 纯插件：`conversation.view` list 槽 + `ctx.llm` + `node:sqlite` | 零补丁，迁移成本最低 |
| composer 图片附件（image-attach：上传 → 真实路径文本随正文发送） | verified | 个人 `conversation-ux` 包内（零补丁） | 纯插件：`conversation.input.left/.dock/.overlay` 槽 + `ctx.httpServer` 路由 | 零补丁；conversation-ux 其他成员已拆出（→ taskpilot / message-tools） |
| 子 Agent Profile 注册表（agent-profiles：`invoke_agent`/`catch_up` + 审批继承） | verified | 个人 `agent-profiles` 包（零补丁） | 纯插件：`settings.section` + `ctx.subagents` + `ctx.httpServer` + `ctx.storageDomain` | 零补丁；与 harness-auth 的 `-cont` 续聊有交集 |
| 插件启停体系（plugin-toggle：设置页开关 + 热卸载 `Entry.update`） | verified | 个人 `plugin-toggle` 包（零补丁） | 纯插件：`settings.section` + `ctx.loader` Entry.update | 零补丁；hot-first-toggle-semantics 依赖它 |
| 代码库检索 + 评估任务（dataseek） | —（proposals 目录外，docs 总览有） | 个人 `dataseek` 包（纯 host 路由，零补丁） | 纯插件：`ctx.httpServer` 路由 | 零补丁 |
| 跨 harness 会话召唤（recall-session-summoner） | in-progress（M0/M1 完成） | 个人 `recall-core`（零依赖核心库）+ `recall`（host 组合层零补丁 + client 补丁） | patch：ui-workspace "按来源"分组 | 去补丁化：官方 group-modes seam 注册表已存在，可改纯插件 |
| 侧边栏"按项目"分组（project-folder-ui） | in-progress | 个人 `project` 包 + 四层补丁 | patch：apiproxy/connection/runtime/ui-workspace | 去补丁化：group-modes seam 注册表可承载 |
| 会话取消归档（session-unarchive） | in-progress（4 补丁落地） | 个人补丁流 | patch：workspace 注册表/apiproxy/runtime/ui-workspace | 需官方 `unarchiveSession` seam（upstream 候选）；archive-status-filter 依赖它 |
| 全分组模式拖拽重排（group-reorder-generalize） | in-progress（实施完成） | 个人补丁（group-modes seam `rowMove` 布尔 → 通用 move） | patch：ui-workspace | seam 已存在，可插件化 |
| 排队消息编辑 + 插队重排（queue-edit-in-composer） | implemented | 个人补丁（patch-ui-conversation 域） | patch：ui-conversation（QueueDock + 输入提交路由） | 与官方 QueueDock 强耦合，去补丁化成本高 |
| skill 传播控制（skill-mcp-propagation） | in-progress（v1-v3 已交付） | 个人 `skill-propagation` 包 + 最小补丁 | patch：tool-skill `catalog-scope` 最小锚点 | 官方若开放 scope 参数则补丁退役 |
| 文件版本化 + fork（workspace-versioning-fork） | in-progress（M1 已交付） | 个人 `files` 包 version-store | 需官方 turn/tool 事件 seam | M1.5 diff 查看器 + undo rewind 排后 |
| 会话列表性能（session-list-pagination / perf） | in-progress（M0/M1 落地） | 个人 `perf` 包（title-warmup 插件内）+ list 冷读预算补丁 | T2 插件（预热队列）+ patch（冷读预算） | M2 真分页留方案待确认 |
| 子 agent 完成通知（subagent-completion-notify） | implemented | 个人 `subagent-notify` 包 | 纯插件：`subagent/start+end` 事件 + 父 followup | 与 taskpilot 监控面正交；wakeup-per-session-toggle 承接 |
| 子 agent 编排（subagent-orchestration：状态可探/完成必报/中途可干预） | in-progress（L1 skill + L2 wakeup 生效） | 个人 skill + overlay `reportDelivery: wakeup` 配置 | 部分 seam：`agent.steer` / `subagentTiming` 投影 / per-call 区分待官方 | L3 依赖官方 seam |
| 归档升格筛选 + nav seam 抽包（archive-status-filter） | in-progress（D1-D5 拍板，M1 开工） | 个人设计（新包 workspace-nav-seam 计划中） | patch：ui-workspace nav seam | seam 抽包是插件化的前置 |

## B 组：计划 / 想法，未动手（纯缺口）

| 能力 | 历史状态 | 官方依赖 | 备注 |
|---|---|---|---|
| 多屏工作台（multiview-workbench：中栏 2×2 四格并行） | planned | 需契约扩展（grid 多实例渲染 + 多选）+ 补丁 | 与 shortcut-manager 同批立项，键位已解耦 |
| 审批上浮 + YOLO 开关（yolo-subagent-approval-float-up） | planned | 纯插件候选（`approval/request` waterfall + `respond_approval` 工具） | `respond_approval` 是官方吸收候选 |
| per-session 唤醒开关（wakeup-per-session-toggle） | planned | 纯插件（subagent-notify 内 per-session 配置） | 承接 subagent-completion-notify |
| 外部 agent 多级子 agent 面包屑（external-agent-breadcrumbs） | idea | T1/T2（recall / task-dock / ui-subagent 扩展） | 2026-08-09 用户提出 |
| 文件抽屉 diff 懒加载 + host 缓存（file-drawer-diff-optimization） | idea（DiffBlock 复用已交付） | T2（host 路由缓存）+ 补丁（懒加载） | 剩余懒加载 + host 缓存待做 |
| AB 双槽运维切换（harness-ops-ab-rotation） | idea | 运维体系（非功能插件） | 独立仓库开发候选；补丁流结构性适配负担 |
| 社区发布门禁（community-publish-blockers） | idea | 体系（发布准备） | 插件 tab 社区兼容 + 重启自动化 + 防膨胀设计 |
| 包结构规范 v1（plugin-package-conventions） | idea | 体系（规范文档） | manifest v1 + bundle/profile 分域 + 迁移防丢 |
| hot-first 启停语义（hot-first-toggle-semantics） | in-progress | 体系（plugin-toggle 依赖） | 任务 1/2/5 已落地，3/4 待二期 |
| 特性可插拔补丁体系（feature-pluggable-patches） | in-progress | 体系（补丁基础设施） | 随全部能力去补丁化后退役 |
| 挂载收敛官方 bundle/profile（bundle-profile-convergence） | in-progress | 体系（插件化基础设施） | 批 3（补丁流包）/ 批 4（脚本退役）待做 |
| 等待内容（catnap → whalenap：等待状态机 + 分档趣味内容） | closed（被 whalenap 取代，但 whalenap 未进社区仓库） | 纯插件（`agent/status` 事件 + 投影缝） | 与 whalesong（状态氛围/提示音）不重叠 |

## 已插件化对照（防重复提案——这些不要再建提案）

| 能力 | 落点 |
|---|---|
| 聊天区标题内联编辑 | ✅ `@khorsheed/dsh-client-session-title-edit` |
| 状态鲸（favicon 喷水 + 提示音） | ✅ `@khorsheed/dsh-whalesong` |
| 回撤 + 撤销（undo-rewind） | ✅ `@khorsheed/dsh-client-message-tools`（撤回 + 尾部重放恢复） |
| 快捷键注册表（shortcut-manager） | ✅ `@khorsheed/dsh-ui-shortcuts`（`ctx.shortcuts` + 重绑 + 持久化） |
| 文件预览（file-preview-plugin-migration） | ✅ `dsh-file-preview` + `dsh-client-ui-file-preview` |
| 同伴 harness 互调 + 续聊（peer-call / harness-auth） | ✅ 意图由 `dsh-local-agent` 家族覆盖（子 agent seam + resume + 记账） |
| task-dock / conversation-edit（conversation-ux 成员） | ✅ `dsh-taskpilot` / `dsh-client-message-tools` |
| 关闭类：details-drawer / multi-agent-chat / subagent-approval-mode / plugin-consolidation / plugin-ecosystem-agent / catnap | ✅ 已关闭（被取代 / 放弃 / 留 private） |
