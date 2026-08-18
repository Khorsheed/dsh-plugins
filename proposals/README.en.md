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
  backlog.md                 capability-gap pool (to-be-pluginified list; not a formal proposal)
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
- **查重结果 / Duplicate check**: <conclusion after searching active/ + closed/ + backlog.md + .agents/notes/ (incl. archived)>
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

Before creating a proposal, search: `active/` + `closed/` + `backlog.md` + `.agents/notes/` (incl. archived). If found → append to the existing file instead of creating a new one (same-intent increments update the same file; only a changed intent gets a new one); if unsure whether to open or extend → ask one line, it costs nothing.

## Claiming from the backlog

`backlog.md` is the **to-be-pluginified capability pool** (sedimented from a historical audit; see its header). To claim:

1. Create `active/YYYY-MM-DD-<slug>.md` (format above, status `planned` or `idea`);
2. Add a row to the README ledger table;
3. Mark the item in `backlog.md` as "claimed → proposal `<slug>`" and move it out of the claimable area.

## Relationship to other mechanisms

- **Proposal ≠ issue**: implementation bugs / acceptance feedback go to the package's `issues/` or are fixed in the implementing PR — not into proposals.
- **Proposal ≠ Agent Note**: see the division-of-labor table at the top.
- **Proposal ≠ release plan**: release batches / version lines follow per-package versions and the `dsh plugin` flow; proposals only track whether a capability exists and in what form.

## Ledger

> Empty at start (this system was established 2026-08-18). Historical capability gaps are registered in `backlog.md`; new proposals add a row here after being claimed.

| 分类 | 提案 | 状态 | 官方依赖 | 前置 / 依赖 | 备注 | 最后更新 |
|---|---|---|---|---|---|---|
| — | (new proposals go here) | idea | — | — | — | — |
