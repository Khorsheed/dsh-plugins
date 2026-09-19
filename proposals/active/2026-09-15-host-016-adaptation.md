# 宿主 0.1.6 适配（host-016-adaptation）

- **分类**：plugin
- **状态**：planned
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
3. **S12**：message-tools projection 恢复（独立提案，M0 持久化探针先行）。
4. **存量两项**（承接 host-015 第四批）：local-files / file-preview 大文件分页 → `ctx.fs.readByteRange`；ankh-guard 借写所有权租约（`SessionOwnershipLostError`）巩固重启接管。
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

### 遗留与放行条件（2026-09-18 晚，用户拍板）

- **3080 合线等官方 rc**：适配已完成（wave 分支全量 build/test 绿、本地实例冒烟通过），但用户体验 alpha.2 后判定该版本问题仍多，拍板 **rc 发布前不合 3080、不动共享检出**；wave 分支（feat/host-016-adaptation）保持全绿待 rc 复验后重钉收尾。
- **ankh-guard 测试生命周期分支已删除（2026-09-18，用户确认无人维护）**：`fix/ankh-guard-test-lifecycle`（tip `480f3cdb`，2026-09-05 后静默）与 main 两点 diff 达 1680 文件 / +1.7万 / −19万行（过期树，合并即大面积回滚）；其首个 test 提交单独 cherry-pick 即与 main 冲突 6 文件（main 已自长出等效机制 `e2f6f042`），无抢救价值；tip SHA 在此留档（配套 docs 分支 `docs/ankh-guard-test-lifecycle-proposal` tip `e1abf97e`），两个 worktree 与两条分支已删。遗留：EADDRINUSE watchdog 测试在 gate 并发下（load>11）的 flake 在 main 上无人认领——wave 实测安静环境连绿两次、与 alpha.2 无关；rc 波 gate 若再 flake 按此记录现修（tolerance 级调整即可，无需复活分支）。wave 的三代际探测修复（3d88a3a8）与该分支无涉，不受影响。
- **3080 宿主升 0.1.6 前置验证项**：ankh-guard `runPreflight` 的 boot 路径在 0.1.6 线未挂 `PluginPackages`（runtime 解析代际不进试启动），含裸 specifier 的 profile 条目会被 preflight 误报 FAIL（方向偏严、非放行坏树）；当前 profile 全是 `file:` tgz + 官方 bundle 不触发，但 3080 宿主升 0.1.6 前必须实测 preflight 或补齐挂载（补齐需与上一条的在飞分支协调）。
- **rc 复核项：形态 C「家族 bundle」按新外部 bundle 模型复审**（2026-09-18 用户要求记录）。我们的 profile 目前 = 官方 bundle + 24 个独立 @khorsheed 行（单成员 bundle 合法但缺套件层）；alpha.2 官方化了 `dsh.profile.bundles` 清单、`OPTIONAL_BUNDLES`（可选 bundle 默认关 + 安装引导）与外部 bundle 隔离——`proposals/active/2026-08-21-package-management.md` 形态 C 薄元包此前卡在 `reconcilePlugins` 只调和直接依赖，rc 发布后按新模型复审可落地性（含「一个插件属于哪些 profile」的跨 profile 展示诉求）。
- **ui-file-preview 共存对比的用户初判（2026-09-18，rc 波终定）**：改动记录/会话产物维度维持我方机制——官方 workspace-changes 为内存态（宿主重启即失）、git-only（非 git 工作区不覆盖）、不记 read，用户判定草率；内容预览维度官方可覆盖（大文件分页 + office 渲染），届时可退。技术结论：① office 文件无需「拿来」——我们的 `canOpen` 对二进制本就 fallthrough 到官方 document tab，`office-to-pdf` 是公开 client Remote（`convertBytes(bytes, extension)`），要在我们视图内嵌也可行但需自带 PDF 渲染面，价值一般，且 3080 宿主需有 libreoffice-kit；② 大文件「滚动分页」不是公开件（官方 TextPreview 分页为组件内部态），我方自补是小特性——宿主半 M4a 已有 `readByteRange(offset, length)` 有界读，加 offset 窗口 + 客户端加载更多即可，或超大文件 fallthrough 官方 tab。

## 里程碑

- **M1** 基线绿（devDeps/lockfile 0.1.6-alpha.1，全量 build+test 红单收敛）。
- **M2** breaking 五项全绿。
- **M3** S12 projection 恢复（双通道）。
- **M4** 存量两项。
- **M5** 合线 + 共享检出升线 + 3080 验收。
- **M6** npm 波（前提：官方 rc + 账号解封；预期与官方 rc 同周）。

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
