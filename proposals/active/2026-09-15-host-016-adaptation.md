# 宿主 0.1.6 适配（host-016-adaptation）

- **分类**：plugin
- **状态**：in-progress
- **最后更新**：2026-09-18
- **查重结果**：已搜 `proposals/active/` + `proposals/closed/` + `.agents/notes/`。最近邻：host-015-adaptation（第一~三批已完成，第四批余量见该提案；本提案承接其 readByteRange 与 guard 租约两项欠账）、message-tools-projection-restore（本波子项，独立提案）、local-agent-dsh-sdk-resume（S8 仍堵，不排）、room-composer-parity / context-clearing（波后讨论，不进本波）。无「0.1.6 整体适配」提案，新建。
- **官方依赖**：纯插件。所有切换走官方 0.1.6-alpha.1 已发布的扩展面，不含新 seam 请求。

## 目标

把全仓插件对齐到宿主 0.1.6：完成 breaking 适配、落地 S12 projection 恢复、承接 host-015 第四批两项欠账。审计基线：`0.1.5-rc.1 (183f08e9c6) → 0.1.6-alpha.1 (0a15e36e7f)`，区间约 804 commits；rc.2（反馈对话框/文件图标 backport）已含在 alpha.1 内。

全程 **probe + degrade 单代码线双兼容**：0.1.6-only 能力一律运行时探针，0.1.5 宿主上回退现状行为；**minHost 地板不动**（development.md 原则），等 npm latest 前滚再评估标注前移。

## 现状（0.1.6-alpha.1 源码实测结论）

### seam 台账核对（11 条未落地条目逐条核对，证据见 seam registry）

- **S12 🟡 部分落地（本轮唯一开闸）**：新增 `ctx.sessions.registerMessageProjection()`（`packages/core/session/src/index.ts:923`）+ `@messageProjection` 事件机制（`surface.ts` `SessionMessageProjection`）——插件可声明自有事件并以纯 `project()` 改写既有 surface 消息、不限制 role；首个一方实例 `image/offload`（compaction-image-offload）。`assertMessageEventShape` 未松绑，但 projection 通道不需要它。→ 立项 message-tools-projection-restore。
- **S2/S3/S4/S8/S10/S11/S13/S14/S15 全部未落地**：tool-bash 输出 schema 无写入路径；`PtcDispatch*` 仍无 diff/turn-step（仅 `error` 结构化增强）；SDK wire 仍 `initialize/session/prompt/shutdown` 四方法、官方 README 仍明写 "No mid-turn cancel"；`skills.register()` 仍不强制 source；`repair.ts` 零改动；`ToolSchema` 仍三字段；`AgentStatus` 仍二元；`establishCatalogChild` 仍未导出。绕行全部保留，不排退役。
- **S5 维持**：`dsh-typert-generator@0.1.6-alpha.1` 已上 npm，exports 与 rc.1 一致；「monorepo 耦合、社区仓不可独立跑」的实测结论维持（`scripts/gen-typert.mts` 头注）。

### 新能力面（本波只收编、不消费）

terminal-controller（`terminalRemote` + 默认行进组合）、`permissionPresetsRemote` + `conversation.input.permission` 槽、`sidebar.right.tab.guide.entry` 槽、`SkillSummary.path`、`openSkill(name)`、MCP resources 三工具、`read_image`、headless `--json`/stdin、`engines.dsh` + `manifestVersion` 声明、`ui-settings-unarchive-sessions`、`image/offload`。消费各自另立提案或波后讨论（terminal → eval 候选；permission → room-composer-parity 顺接；mode-switcher 主路径与 permission 面无关，不动）。

### Breaking（实测命中面，不改即坏）

| # | 变化 | 命中 |
|---|---|---|
| 1 | `agent/session-start` 删除；`agent/created` 变 `@mode serial`：负载 `{agent, source, signal}`、创建事务等全部监听器完成、监听器内禁止 `await agent.whenIdle` | **ankh-guard**（全仓唯一 `agent/created` 监听方，`src/index.ts:673`，重启续跑 deliver 在里面；spec 20+ 处 `ctx.emit('agent/created')` 桩）——本波最高风险项 |
| 2 | `code-runtime` 家族删包 → `ptc-runtime`（行 id `code-runtime`→`ptc-runtime`，包 → `@deepseek-ai/dsh-ptc-runtime-node`） | **local-agent-dsh-headless**（dep + `cordis.patch.yml:38` 行 + `patch.spec.ts` 钉 + README/invariant）与 eval 测试 fixture（`tests/capability-probe.spec.ts:36`） |
| 3 | `PermissionSelect` → `PermissionCatalog` | mobile 的 DOM anchor 注释引用旧名（`packages/mobile/src/client/composerActions.ts:30`），活体核对 |
| 4 | base bundle `tool-ralph` 默认 `disabled: true`；新增默认行 `image-offload`/`mcp-resources`/`terminal-controller`/`ui-sidebar-terminal`/`ui-settings-unarchive-sessions` | profiles 收编：web-dev 有显式 ralph 行需确认覆盖关系；新默认行随 base 自动进组合，3080 部署前验收 |
| 5 | 零命中编译期复核项 | e2b 删除（全仓零引用）、provenance→source 类型改名（不 import 这些类型）、`ComposerBarInjected.command` / `insertSessionBefore` / `MessageFeedbackInjected` 删改（零消费）、会话历史直读 API deprecated（存量豁免）、`dsh-client-store` 缺依赖缺陷 0.1.6 未修（消费方 devDeps 绕行保留） |

## 方案

### 策略

- worktree `.worktrees/host-016-adaptation` 迭代；`DSH_HARNESS` 指向 0.1.6-alpha.1 独立检出（共享 `~/code/deepseek-harness` 留在 0.1.5 至合线——多 agent 共用，升线是 mainline 编排步骤，沿用 `deepseek-harness-alpha` 双检出先例）。
- 包级协调：ankh-guard 有在飞 worktree（`fix/ankh-guard-test-lifecycle`），动手前核 `git log --oneline -3 -- packages/ankh-guard` 与近期 notes，必要时排队。

### 批次

1. **基线**：devDeps 升 0.1.6-alpha.1 + lockfile 重生成 + 全量 build/test 摸底（红单即适配清单，复核上表第 5 行零命中项）。
2. **breaking 五项**：ankh-guard `agent/created` serial 化（deliver 路径长 await 审计 + spec 桩改写）→ headless ptc-runtime 改名五处 → eval fixture → mobile anchor 核对 → profiles 收编。
3. **S12**：message-tools projection 恢复（独立提案；两轮探针后形态定为「投影模块 + fold 语义三道闸」**暗态交付**——0.1.6-alpha.1 的 fold 对 surface 产出型事件不组合投影与节点成员，点亮等上游修复；双线行为逐字节不变）。
4. **存量两项**（承接 host-015 第四批）：local-files / file-preview 大文件分页 → `ctx.fs.readByteRange`（**已落地**，2026-09-15，commit `5ce025ef`：有界窗口读 + Remote offset/nextOffset 管道，客户端分页 UI 转波后）；ankh-guard 借写所有权租约（`SessionOwnershipLostError`）→ **sizing 后转 rc 后评估**：租约逻辑是内核态跨进程锁，接入点在重启关键路径的 resume 流上，属设计任务而非机械适配（0.1.6 不要求它，0.1.5 租约已在会话层自动生效），且 ankh-guard 有在飞分支（`fix/ankh-guard-test-lifecycle`），波中动重启关键路径风险不值；sizing 结论与接入点候选记在本提案实现记录。另：ankh-guard spec 的 20+ 处 `agent/created` emit 补 `source` 字段的保真打磨同样留到 rc 轮（与在飞分支同文件，避免波中撞车）。
5. **合线**：worktree `pnpm gate` 全绿 → 合 main → 共享 harness 检出升线 → `deploy:3080` 验收 → 观察期（默认 3 天）→ **与官方 rc 同波 npm**：0.1.5 欠发与本波成果合在同一版本（双兼容，避免「0.1.5-only 版本发出来几天即过时」的空转）；版本号发布前 `npm view` 核对。

### 明确不做

- 任何依赖 S2/S3/S4/S8/S10/S11/S13/S14/S15 的改造（未开闸，绕行保留）。
- 流式评估（`assistant-stream` follow frames）、context-clearing 开工、room-composer-parity、local-agent-dsh-sdk-resume M1、terminal / permission / guide.entry 等新面消费——**本波完成后与用户对齐排期**，各自走提案。
- inline-html-render / message-timeline / context-guard / ui-shortcuts / session-title-edit / whalesong 不动（0.1.6 无影响面）。【2026-09-18 修订：此条被 alpha.2 推翻，见下节】

## alpha.2 重钉（2026-09-18 用户拍板）

官方 2026-09-17 未发 rc、改发 0.1.6-alpha.2（887 commits / 2622 文件，七路并行审计已完成）。用户拍板：**wave 目标从「alpha.1 基线等 rc」改为「直接适配 alpha.2 并上 3080 作固定版本」**；共享 `~/code/deepseek-harness` 检出与 3080 在用户明确放行前均不动，调试走 `~/code/deepseek-harness-alpha` 独立检出 + 本地实例。

alpha.1 已适配的 breaking 六项在 alpha.2 复核**全部仍成立**（零返工）。alpha.2 新增 breaking 与处置：

| # | breaking | 打中 | 处置 |
|---|---|---|---|
| 1 | `SessionSnapshot.queue` / `QueuedMessage` 删除，队列迁 `inbox` 投影 | room（RoomComposer）、mobile（MobileQueue/SubmissionFocus） | 迁 `useProjection('inbox')` 读 `InboxState['next-turn']`（投影 alpha.1 已有，双线兼容，0.1.5 探测回落） |
| 2 | `conversation.chat.turnTail` chain→list：注册强制 `id`、`select` 失效 | ui-file-preview（抢占式注册） | **用户拍板：共存**——改 list 注册补 `id`，与官方 DeliverablesTail/PlanCards 并存对比效果，退役后定 |
| 3 | `ISessions.open/openSubagent/clear` 与 `SessionListState.current/currentAddress` 删除 | room/eval/ui-shortcuts/mobile/mission/datasets/message-timeline 等 8 包 | 迁移 `ctx.uiWorkspace.openSession`；「当前会话」无公开 selection reader，root 级消费者（全局快捷键、chrome.show）需找新锚点——本波最大待解项 |
| 4 | `SessionPendingInteractionSnapshot`→`SessionStatusSnapshot` | whalesong | 类型迁移，读取改 `.pendingInteraction` |
| 5 | `settings.plugin.item` 槽删除 | context-guard（连带 capability-catalog 设置呈现路径） | 迁 `plugins.bundle.config` / `plugins.row.config` / `settings.plugins.tab` |
| 6 | `ModelDirectory.select()` 不再 reject，返回 `RemoteResult` | room（RoomModelPicker 失败路径死）、message-tools（恒判成功） | 两处改判 `result.ok` |
| 7 | `sessions.scope()/binding()` 对非 retained 代际收紧 | message-tools/quote/session-title-edit/mobile/room 各 1–5 处 | 逐个复验（`?.` 兜底语义已变） |
| 8 | `data-composer-stats` DOM 锚删除 | mobile | 换锚或接受官方默认样式 |

行为变化须知：hmr 默认开（profile 配置热重载，`watchUserPatches` 已删——ankh-guard 需对 alpha.2 重跑 preflight-drift 绊线）；resolution mode 默认 link→runtime（prod tgz 无感，link dev 实例需显式参数）；subagent 容量钳制 `maxActiveSubagents: 8` / `maxDepth: 1`（local-agent 家族知晓）；3080 宿主升 alpha.2 前确认 Node 在 22/24/26 矩阵。

同波顺带优化（小项）：local-agent 成员会话侧栏聊天官方机制认领（零改动，README/发版说明）；inline-html-render `openLink` 探测改道 `openTab('browser')` 回落 `window.open`。

alpha.2 修订上文「明确不做」清单：ui-shortcuts / message-timeline / context-guard / whalesong 在 alpha.2 均有影响面（上表 3/5/4 项）。S12 fold 组合语义 alpha.2 一字未改，projection 维持暗态；browser-pane 2026-09-18 闭卷（用官方 Sidebar Browser）；room-composer-parity 补「工厂路线」选项（见其提案）。

## 里程碑

- **M1** ✅（2026-09-15）：基线绿——devDeps/lockfile 升 0.1.6-alpha.1（commit `cf02cfc5`），全量 build+test 在 `DSH_HARNESS=deepseek-harness-alpha`（完整构建的 detached worktree）下双线绿。红单 5 个全部收敛进 M2。
- **M2** ✅（2026-09-15）：breaking 五项全绿（`7a0a1b18` ankh-guard / `d5a243e1` local-agent / `c99dee43` headless ptc / `b299bc0a` guide id / `cd23f4cc` profiles）。mobile anchor 静态核实零改动。
- **M3** ✅（2026-09-15，`40665c34`）：S12 投影模块 + fold 语义三道闸暗态交付；12 测试；双线行为逐字节不变。
- **M4** 部分：M4a readByteRange ✅（`5ce025ef`）；M4b guard 租约 → rc 后评估（见方案第 4 批）。
- **M5** 合线 + 共享检出升线 + 3080 验收（等周四 rc 复验后）。
- **M6** npm 波（前提：官方 rc + 账号解封；预期与官方 rc 同周）。

## 实现记录

- 2026-09-15 M1+M2：基线升线与五处 breaking（Agent Note `implemented/architecture/2026-09-15-host-016-breaking-adaptation.md`）。
- 2026-09-15 M3：S12 暗态交付（Agent Note `implemented/feature/2026-09-15-message-tools-restore-projection.md`）；两轮探针修正见 seam registry S12。
- 2026-09-15 M4a：大文件有界读取（Agent Note `implemented/bug-fix/2026-09-15-bounded-preview-reads.md`）。
- 2026-09-15 M4b sizing（guard 租约）：租约 = 内核态跨进程写锁（`session-persistence-jsonl/src/lease.ts`， contention → `SessionAlreadyOwnedError`，持有期失联 → `SessionOwnershipLostError`）。接入点候选：restart-continuity 的 resume 流驱动 `agent.followup`/重建 agent 时捕获这两个错误，把「租约被持」读作「旧实例未死透」→ 不唤醒、不双驱，与 S14 的 parked 过滤同层。等 rc 后连同 spec emit 保真一起做，动手前核 `fix/ankh-guard-test-lifecycle` 合并状态。

## 验收标准（done 判定）

- 0.1.6-alpha.1（及周四实际 rc tag）与 0.1.5-rc.1 **双线**下，触及包 build+test 全绿、0.1.5 行为逐字一致（degrade 路径有测试钉住）。
- 每包 `dsh plugin add/remove` 可用、可热卸载；README Compatibility 与 `dsh.compat` 同步（minHost 不动，notes 记 0.1.6 实测结论）。
- seam registry：S12 随 M3 转「已退役」并写退役版本；其余条目登记 0.1.6-alpha.1 核对结论。
- 3080 走标准 `pnpm deploy:3080` 验收门；npm 波前过 `docs/publishing.md` checklist（含 peer range `^0.1.0-rc.6` 对 0.1.5/0.1.6 prerelease 的严格 semver 覆盖复核——pnpm 现仅警告，发布前定夺）。

## 风险 / 放弃的东西

- **alpha → rc 之间官方仍可能回退个别面**（消息编辑在 0.1.5 alpha.2 被 revert 的前科）：M2/M3 以周四实际 rc tag 复验为准，不以 alpha.1 为最终依据；probe+degrade 策略本身即对冲。
- **ankh-guard 他人在飞改动撞车**：动手前协调；若冲突未解，ankh-guard 两项（serial 化 + 租约）可与其他项解耦分批。
- **rc 跳票 / 解封提前**：0.1.5 线已可发的包可先行发波，但 ankh-guard 与 local-agent 家族（在 0.1.6 宿主上有真 breaking）必须等双兼容版本，宁晚不错发。
- **放弃「minHost 随适配前移」**：0.1.6 在 npm 是 alpha tag，社区默认装 0.1.5-rc.1；前移会把用户关在门外。等 latest 前滚再标。
