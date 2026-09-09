# Agent Note: 0.1.2-rc.1 基线迁移——compat 分支合并、rc.1 差量适配波、minHost 地板前移

Status: implemented

[English](2026-09-09-012-rc1-baseline-migration.md) | 中文

## Problem

`deepseek-harness` 于 2026-09-03 把 `0.1.2-rc.1` 以 `latest` 发上 npm，满足了 [0.1.2 评估笔记](../../proposed/architecture/2026-08-28-host-0.1.2-alpha1-assessment.md)记载的合并条件：`feat/host-0.1.2-alpha1-compat` 分支（86 个提交的双线适配，已在 3091 端口做过活体验收）可以落地。剩余两个缺口：该分支对的是 `0.1.2-alpha.1`，而 npm 线又前进了四个 alpha（`Session.events` 删除、`SessionSeq` 品牌化、`settingsNamespace()` 删除、`JsonValue` 迁包、错误码命名空间化）；且 main 自分支部后漂移了 558 个提交。既定目标：主线基线钉到 `0.1.2-rc.1`、部署 3080、做一轮发布。

## Decision

- **合并而非重适配。** compat 分支经 worktree `feat/baseline-0.1.2-rc1` 合入 main；84 个冲突文件按同一条原则解决——main 的功能工作为准，分支的 API 迁移重放到其上。分支的活体验收证据（三轮只在线上可见的断裂排查）完整保留。
- **合并之上再做 rc.1 差量适配波**，依据是对 `dsh-v0.1.2-alpha.1..dsh-v0.1.2-rc.1` 与全仓命中面的机械审计：`session.events` → `snapshotEvents()`/`eventAt(SessionSeq(…))`（room、message-tools、file-preview、local-agent-dsh-headless 及测试）；`session.append` 的 surface op 一律 `SessionSeq()` 包装（message-tools）；7 个包删掉 `settingsNamespace(…)` 调用改传字面量（官方 ui-locale/ui-chat 同款）；`JsonValue` 导入迁 `@deepseek-ai/dsh-util-values`（5 个包）；session-title-edit 同时接受 `title-invalid` 与命名空间化的 `session/title-invalid`；file-preview 的 dispatch fold 同时识别 `tool/code-dispatch` 与 `tool/ptc-dispatch`（rc.1 仍发旧名——双名识别是前向兼容，不是版本嗅探）。
- **基线文件翻线**按[基线同步笔记](2026-09-09-012-baseline-sync.md)：全部 `@deepseek-ai/*` devDeps 升 `^0.1.2-rc.1`；workspace `overrides`/`minimumReleaseAgeExclude` 按 lockfile 实解重新生成（73 个包，`0.1.1-rc` 零残留）；CI gates 种子 tag 改 `dsh-v0.1.2-rc.1`；`dsh-client-runtime` 彻底清除含 peer 声明（留着会被 auto-install-peers 装回 `0.1.0-rc.8` 并拖入 0.1.2 未发布的 `dsh-host-apiproxy`）。
- **minHost 地板整体前移 `0.1.2-rc.1`——有意为之。** 以往各波不动地板是因为产物保持双线；这一波在宿主删掉座席的地方拆了 rc.2 臂（`useChat` 单座席、`sessions.create/open`、`snapshotEvents`、ui-primitives 必填 labels），再声称兼容 rc.2 是未经核实的谎言。旧宿主用旧发布线。全包 `verifiedHost: 0.1.2-rc.1`；README Compatibility 节与 `docs/release-status.md` 同步再生成。
- **新降级项如实登记，不藏**：ui-file-preview / local-files / worktrees 在 0.1.2 上隐藏 external-open 按钮（host description 不再携带 `canOpenPath`；恢复 follow-up 走 `remote.session.canOpenWorkspacePath` RPC 探测）；whalesong 的 blocked 铃改订阅 `ctx.uiSession.pendingInteractions`，服务缺席时静默降级。
- **台账重编号**：重复的 S9（runtime skill `source`）改为 S10，其后条目顺移一位；AGENTS.md、proposals、笔记中的交叉引用同步更新。

## 源码有改动的包（按合并窗口规则点名通知 owner）

行为层面受影响：room、message-tools、file-preview、local-agent（core + kimi + claude-code + codex + dsh + headless）、taskpilot、message-timeline、worktrees、ui-file-preview、local-files、ui-shortcuts、whalesong、session-title-edit、capability-catalog、datasets。仅导入/元数据：mission、eval、context-guard、inline-html-render、local-agent-tool-subagent。未触及：lab、ankh-guard（它迭代的 `session.events` 是自有 `PersistedPresetSource`，非宿主 Session）。各 owner 拉取后基于新基线开发；功能 worktree 的合并窗口在本分支落回 main 后解除。

## Alternatives considered

- **在 main 上从零重适配，不合 compat 分支**——否决：分支有 86 个提交、含三轮编译器发现不了的纯运行时断裂实证，丢掉等于重新买一遍这个风险。
- **产物无限期保持双线**——否决：rc.2 座席已被上游删除，rc 臂在目标线上是死代码，每处探测都让下次升级的审计面翻倍。
- **minHost 留在 `0.1.0-rc.6`/`rc.8` 并声称降级运行**——否决：适配后的代码硬调 0.1.2 API（rc.2 宿主上没有 `snapshotEvents`），诚实的地板就是我们验证过的线。

## Consequences

- 全仓在 rc.1 基线上全绿：2814 测试通过、构建干净、`pnpm install` 退出 0（taskpilot 的 `prepare` 是最后一块红）、`check:plugins`/`check:builds`/`check:hygiene` 全净、233 对翻译配对同步。
- prod 3080 的宿主翻线走 guard 的 `reconfigure` 路径：0.1.2 无法 tsx 从源码启动（`const enum FiberState` 在构建产物中被擦除），启动命令改为 `node apps/cli/lib/bin.js web --no-open`，preflight surface 从 `source` 改 `built`，检出 reset 到 rc.1 且 build+test 跑绿后重录凭证。会话数据无需动作（两条线都是格式 v0；SQLite 后端移除无关——本 HOME 是 jsonl）。
- 本波**有意不做**的事：采用任何 0.1.3/0.1.5-alpha 能力（sidebar-right tabs、message-tools 恢复走 surface op、open-in-app）。那些属于预研分支，预研分支生成的 typert 产物永不回并主线。
- 已知遗留：S10(b) 单文件 zstd 帧损坏拖垮 `session.list` 的上游隐患仍在（隔离修复 playbook 保留）；`composeProfile` 仍未导出（ankh-guard 的 preflight-runner 自镜像与漂移绊线保留）；external-open 恢复 follow-up 在三个包的 `dsh.compat.notes` 里跟踪。
