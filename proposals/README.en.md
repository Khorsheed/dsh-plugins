# Proposal Management (Proposals)

English | [中文](README.md)

> This directory is the **capability-proposal ledger** of dsh-plugins: one proposal = the full lifecycle of one **capability intent** (from idea to closure), spanning multiple packages, PRs, and Agent Notes. Proposals are **closed promptly once implemented** — a closed proposal moves to `closed/` and never lingers.

## Division of labor with Agent Notes (read first)

| | Agent Note (`.agents/notes/`) | Proposal (this directory) |
|---|---|---|
| Granularity | One decision / one change | One capability intent (can span packages / PRs / notes) |
| Question answered | Why this change, what we gave up | Is this capability happening, where is it, who owns it |
| Lifecycle | proposed → implemented → rejected (+ archived) | idea → planned → in-progress → verified → done / closed |
| Enforcement | Mandatory per AGENTS.md; pre-commit format gate | Convention only; no machine gate (lightweight docs layer) |

**Integration rules**:

- Every non-trivial change made while implementing a proposal **still requires an Agent Note** (AGENTS.md is unchanged); the proposal's optional `## Implementation log` section records the relevant notes / PRs / package names for audit.
- An Agent Note's `proposed/` is an *unbuilt single decision*; if it serves a proposal, link back to the proposal (and vice versa).

## Goal declaration (the common criterion for every proposal)

Every capability in this repo ultimately ships as a **pluggable plugin**: `dsh plugin add / remove` installs and removes it in one command, with **zero changes to official code** — no modification, no replacement, no hacking of official packages. Three hard rules follow:

1. Every proposal header must truthfully mark its **official dependency**: `pure plugin` / `needs contract extension (upstream candidate)` / `currently depends on patches`.
2. **`done` is bound to pluggable delivery**: a capability only reaches `done` as a standalone plugin package (self-mounting via `dsh.bundle`, hot-removable). A patch-dependent implementation may at most be `verified` (accepted in the patch-stream environment), is not `done`, and must state a **de-patching path**.
3. A capability absorbed upstream (official now ships it) → `closed` with note "absorbed upstream".

## Layout and lifecycle

```
proposals/
  README.md / README.en.md   this file
  active/                    in-flight proposals: idea / planned / in-progress / blocked
  closed/                    closed: done / closed (abandoned / superseded / absorbed upstream)
```

File naming: `YYYY-MM-DD-<slug>.md` (lowercase hyphenated English slug; same convention as Agent Notes). **Path-encoded status is deliberate** — a status change must move the file, so "updated status but forgot to archive" cannot happen.

## State machine

```
idea → planned → in-progress → verified → done (move to closed/)
          ↘ blocked (state the reason; back to in-progress when unblocked)
any state → closed (abandoned / superseded / absorbed upstream; state the reason, move to closed/)
```

| State | Meaning | Directory |
|---|---|---|
| `idea` | Not yet scheduled | active/ |
| `planned` | Scheduled, not started | active/ |
| `in-progress` | Being implemented | active/ |
| `blocked` | Stuck — **reason required** (missing prerequisite / waiting on a seam / waiting upstream) | active/ |
| `verified` | Accepted (probes / real-instance checks green; usable in the patch-stream environment) | active/ |
| `done` | **Shipped as a pluggable plugin and accepted** (zero official changes) | closed/ |
| `closed` | Abandoned / superseded / absorbed upstream (state the reason) | closed/ |

**A status change = edit the file header + move the file + update the README ledger table, in the same commit.**

**Close promptly after implementation**: `verified` should become `done` and move to `closed/` within 7 days; lingering is flagged ⚠️ `stale`. `done` means *closed*, not *starting new work* — once delivered, archive it; follow-up increments get a new proposal or note.

## Anti-stall

- `idea` / `planned` untouched for 14+ days, or `verified` not turned into `done` within 7 days → flag ⚠️ `stale` in the ledger.
- Stale options (pick one): raise priority and split tasks / `closed` with reason / keep with reason.
- Scan the ledger at the start of every working session; handle stale items first.

## Proposal file format

Header (fixed machine-readable keys; keep in sync on any change):

```markdown
# <Capability name> (<slug>)
- **分类 / Classification**: plugin | seam | patch
- **状态 / Status**: <one of the state-machine values> (blocked / closed append the reason in parentheses)
- **最后更新 / Last updated**: YYYY-MM-DD
- **查重结果 / Duplicate check**: <conclusion after searching active/ + closed/ + .agents/notes/ (incl. archived)>
- **官方依赖 / Official dependency**: pure plugin / needs contract extension (upstream candidate) / currently depends on patches (de-patching path: …)
```

Body skeleton (bespoke technical sections may be added in between):

```markdown
## 目标 / Goal
## 现状 / Current state (measured official contracts / existing implementation)
## 方案 / Approach
## 里程碑 / Milestones (optional)
## 实现记录 / Implementation log (optional: related Agent Notes / PRs / package names, appended as work lands)
## 验收标准 / Acceptance criteria (done verdict, bound to pluggable delivery)
## 风险 / Risks & trade-offs
```

## Duplicate-check rule

Before creating a proposal, search: `active/` + `closed/` + `.agents/notes/` (incl. archived). If found → append to the existing file instead of creating a new one (same-intent increments update the same file; only a changed intent gets a new one); if unsure whether to open or extend → ask one line, it costs nothing.

## Relationship to other mechanisms

- **Proposal ≠ issue**: implementation bugs / acceptance feedback go to the package's `issues/` or are fixed in the implementing PR — not into proposals.
- **Proposal ≠ Agent Note**: see the division-of-labor table at the top.
- **Proposal ≠ release plan**: release batches / version lines follow per-package versions and the `dsh plugin` flow; proposals only track whether a capability exists and in what form.

## Ledger

> Empty at start (this system was established 2026-08-18). The historical proposal archive stays in its original snapshot (dsh-salvage-2026-08-16, outside this repo) and is not imported; new proposals add a row here per the process above.

| 分类 | 提案 | 状态 | 官方依赖 | 前置 / 依赖 | 备注 | 最后更新 |
|---|---|---|---|---|---|---|
| plugin | [通用数据集存储 + 任务管理（datasets / mission）](active/2026-08-18-datasets-mission-bench.md) | planned | 纯插件 | bench 私有仓库（题库 + run 模板） | 通用能力；agent 经模型工具读写，评测用法单立一章 | 2026-08-18 |
| plugin | [local-agent 公开委派 API（start / resume / cancel + 进度事件）](active/2026-08-18-local-agent-delegation-api.md) | planned | 纯插件 | 无（原 codex 持久化 note 第 1 条已吸收进 M4） | room note 的供给侧立项；M1–M4 代码已落地（未推送），待真实 profile 验收 | 2026-08-19 |
| plugin | [local-agent 成员双向通道（可写 composer + promptMember + 成员互通知）](active/2026-08-19-local-agent-member-channel.md) | planned | 纯插件 | local-agent-delegation-api（底座 M1–M4） | room 二轮评审立项；替代不可行的 prepareContinuable 路线（§0 存档）；M3 = CLI→CLI 成员互通知（room 高频场景） | 2026-08-19 |
| plugin | [local-agent provider 长驻驱动模式（live driver）](closed/2026-08-20-local-agent-live-driver.md) | done | 纯插件 | delegation-api M1–M4（对 facade 透明） | 四家全落地+验收齐全+真机矩阵+3080 canary PASS；exec 保留为 fallback | 2026-08-23 |
| plugin | [local-agent 成员会话结构化状态（member dock + 任务清单翻译）](active/2026-08-22-local-agent-member-state.md) | planned | 纯插件 | member-channel（宿主）；与 live-driver 并行（顺序约定见其 §3） | member dock 统一投影行 + 任务翻译进共享折叠层；dsh → claude → kimi/codex（各带 spike） | 2026-08-22 |
| plugin | [移动端接入（mobile-access）](active/2026-08-19-mobile-access.md) | planned | 纯插件 | 无 | 随时随地访问完整 Web UI（保留全部插件能力）；M1 网关认证 / M2 PWA+推送 / M3 移动 UI 适配 / M4 bot 通道 | 2026-08-19 |
| plugin | [撤回可选回滚文件状态（withdraw-file-rollback）](active/2026-08-21-withdraw-file-rollback.md) | planned | 需契约扩展（upstream 候选） | 官方 rc 能力评估（当前 rc.8 无） | 社区 v1 纯插件子集（fs 日志后端 + git 基线 + 覆盖判定护栏）可先行；bash 捕获需上游原语 | 2026-08-21 |
| plugin | [文件视图 HTML 渲染能力增强（file-view-html-rendering）](active/2026-08-21-file-view-html-rendering.md) | planned | 纯插件 | none (research report in scratch, 2026-08-21) | shared file-view/drawer/deliverables channel; Tier0/Tier1 layering + large-file tiers; M0 3D test pages delivered &amp; verified via playwright | 2026-08-21 |
