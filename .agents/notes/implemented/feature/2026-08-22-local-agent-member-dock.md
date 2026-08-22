# Agent Note: local-agent member dock — a contributor-registry projection-row stack

Status: implemented

English | [中文](2026-08-22-local-agent-member-dock.zh.md)

## Problem

The member composer's ambient state was starting to scatter: the stats line (member-channel M2's correction) was the first self-rendered row, a task-list summary is next, and run progress / queue state are plausible after that — and they all share one structural constraint: the official dock panels (`StatsLine` on `conversation.composer.dock`, TodoPanel on `conversation.input.dock`) live INSIDE the composer chain's fallback, which `overlay: true` hides entirely once MemberComposer is elected. Self-rendering is therefore not a one-off fix but a repeating pattern; a second ad-hoc row would have cemented per-row branches in the component. This is milestone M1 of the [member-state proposal](../../../proposals/active/2026-08-22-local-agent-member-state.md).

## Decision

`packages/local-agent/src/client/member-dock.ts` holds a small contributor registry:

- A contributor is a pure function `(projections: MemberDockProjections, t) => MemberDockLine | null` (`line = { id, text }`). The projection bag is sourced from the slot kit's `useProjection` seat — `tokenUsage` now, `todos` / run progress later; an absent unit reads undefined and the contributor drops out whole.
- `memberDockLines(projections, t)` evaluates the registered contributors in registration order, omitting nulls; an empty stack renders nothing. The renderer in `MemberComposer` is branch-free: one `<div>` per line below the composer card.
- Every row shares the official StatsLine metrics (`.dockRow`: centered, `--dsh-chat-content-width`, 12/20 tertiary, ellipsis on overflow).
- The pre-dock stats logic migrated into the `stats` contributor byte-identically (cache-hit share over the three billing buckets + compact input/output totals; drops when no billed input; `formatTokens` / `cacheHitPercent` moved with it). The stats row keeps the `data-member-stats` test hook; every row also carries the generic `data-member-dock-row="<id>"`.
- The degraded read-only branch renders no dock, staying visually identical to the official read-only panel.

The tasks contributor is deliberately NOT in M1: the `todos` projection seat is not yet part of this package's type surface, and the task-list translation (proposal §2) that would feed it lands per provider in M2–M5. The registry is ready for it: add the projection to the bag, register one contributor.

## Alternatives considered

- **Ad-hoc rows in MemberComposer** (the pre-dock shape) — rejected: the fallback-hiding constraint guarantees more ambient rows (tasks are already planned), and per-row branches in the component scatter one rule ("no data, no row") across call sites.
- **A dynamic register/unregister API with plugin-time contributors** — rejected as speculative: all foreseeable contributors live in this package; a static ordered array (`MEMBER_DOCK_CONTRIBUTORS`) is the whole registry, and `memberDockLines` takes an injectable contributor list only so tests exercise the contract without mutating it.
- **Contributors returning preformatted strings without the locale seat** — rejected: copy must localize; `t` is a parameter, not a projection, so the signature carries it explicitly.
- **Waiting for the `todos` seat to land the registry with two contributors** — rejected: the stats row's migration stands alone, and the seat's absence is exactly the degrade path (undefined → null) the registry already implements.

## Consequences

- Member sessions get a single styled region for ambient state; the next state kind (tasks) is one pure function plus one projection-bag entry.
- The dock is composer-owned, so any future official change to the dock slots stays invisible to member sessions — same maintenance class as the composer skin itself.
- The stack orders by registration; contributors that want a different order move in the array, and the registry unit tests pin the contract.
- Red line recorded from the proposal: the dock collects only "what the human needs to know about the member right now"; dsh-agent-only concepts (turn/step counts, ttft/decode) stay out.

## Testing

`packages/local-agent/tests/member-composer.client.spec.tsx` (19 tests): the pre-dock stats cases pass unchanged through the preserved `data-member-stats` hook; new cases pin the dock placement (rows render inside `[data-member-dock]` after the card, with `data-member-dock-row` ids), the degraded branch carrying no dock, and the registry contract — null contributors omitted, registration order kept, empty stack renders nothing, the stats contributor's byte-identical formatting. Suites: local-agent 143/143, family untouched (kimi 62/62, codex 35/35, claude-code 28/28, dsh 37/37, dsh-headless 21/21, tool-subagent 10/10).

## Cross-references

- [Member-state proposal](../../../proposals/active/2026-08-22-local-agent-member-state.md) — the milestone plan this implements (M1).
- [Member channel M1+M2](2026-08-19-local-agent-member-channel.md) — the composer host; its Consequences record the fallback-hiding correction this dock generalizes.
