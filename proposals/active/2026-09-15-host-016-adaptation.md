# 宿主 0.1.6 适配（host-016-adaptation）

- **分类**：plugin
- **状态**：planned
- **最后更新**：2026-09-15
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
- inline-html-render / message-timeline / context-guard / ui-shortcuts / session-title-edit / whalesong 不动（0.1.6 无影响面）。

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
