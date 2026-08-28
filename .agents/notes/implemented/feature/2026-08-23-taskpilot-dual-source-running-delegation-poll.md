# Agent Note: taskpilot dual-source running for one-shot delegation rows

Status: implemented

[English](2026-08-23-taskpilot-dual-source-running-delegation-poll.md) | 中文

## Problem

The taskpilot dock's interrupt verb only rendered on rows the official session
summary marked as running. One-shot external-CLI rows — the local-agent
family's kimi/codex/claude/dsh delegations — never carry a live agent, so
their summary `running` flag stays false and the stop button never appeared,
even though the host-side stop chain (`/taskpilot-interrupt` →
`/local-agent stop <childSessionId>`) had been ready since the
codex-exec-usage-fallback work. A user watching an in-flight CLI delegation
saw a settled row with no way to abort it from the capsule.

A second, smaller gap: the `/taskpilot-interrupt` command registered no
`input` hint, so a hand-typed invocation with arguments was not intercepted by
the composer (palette selection worked because it dispatches the full line).

## Decision

### 1. Dual-source running from the family's delegation poll

The dock's subagent-row running determination became dual-source:
`summary.running === true || activeSet.has(child.id)`. `activeSet` is polled
from the local-agent family's read-only Remote
(`localAgentGateway.activeDelegations()`, returning the in-flight child
session ids) every 1.5s while descendant rows exist. The dock polls only while
rows are shown, and the injected poll (`pollActiveDelegations` on
`TaskPilotDockInjected`) is wired in the client apply closure through a
duck-typed reader — no import of any local-agent package, no manifest
dependency. Every failure mode resolves to an empty set: channel absent (the
family is not installed — `ctx.get('remote.localAgentGateway')` yields
undefined), a call error, or a non-ok result. With the family absent the
second source is a strict no-op, so behavior is byte-identical to the
single-source dock. The row walk (`collectDescendants`) takes the active set
as an optional third parameter defaulting to empty; the capsule running count
now derives from the dual-source row walk (`runningSubagents.length`), a
strict superset of the official index's count, so the capsule dot and the
popover rows agree for one-shot delegations too.

The stop verb itself is unchanged: the row's interrupt button still dispatches
`interruptSubagent(child.id, child.parentId)` → `/taskpilot-interrupt` →
(no live agent) `/local-agent stop <childSessionId>`.

### 2. `/taskpilot-interrupt` input hint

The command registration now declares
`input: { hint: '<child-session-id> [parent-session-id]' }`, so the composer
advertises and intercepts the free-form argument line exactly like the
`/local-agent` and `/mission` commands.

## Alternatives considered

- **Mounting the family namespace from taskpilot (`$mount`) vs duck-typed
  read**: taskpilot must stay installable alone; `$mount`ing a namespace it
  does not own would fight the family's own mount and tie the two packages
  together. Reading the already-mounted namespace by key keeps the plugins
  independent — the compatibility contract is "absent family = invisible".
- **Polling only while the subagent popover is open vs while rows exist**:
  the popover-only variant polls less, but the capsule's running dot is
  driven by the same dual-source count, and rows are the unit the user asked
  to gate on; polling while any descendant row exists keeps the dot truthful
  without running when the dock has no subagent data at all.
- **Deriving the capsule count from the official index vs the dual-source row
  walk**: the official `runningCount` misses one-shot delegations entirely, so
  a session whose only running work is a CLI run would show no dot; the row
  walk over the same lineage is a strict superset and is the count the
  popover actually renders.
- **Hard failure on a missing channel vs fail-soft**: a taskpilot that threw
  without local-agent would break the boot of every user who never installed
  the family — the degrade-don't-explode rule wins; the poll resolves an
  empty set and the stop verb degrades through the existing seam error.

## Consequences

- One-shot local-agent rows show the interrupt button while their delegation
  is in flight and settle back when it ends, without any new host logic — the
  existing `/taskpilot-interrupt` → `/local-agent stop` chain is reused.
- The two plugins remain fully independent: taskpilot adds no peer/dev
  dependency on the family and imports none of its code; the only coupling is
  the service key string and the duck-typed method name. The plugin-
  independence gate stays green.
- Cost: one Remote call per 1.5s per session while that session has subagent
  rows (the family gateway is read-only and emits no session events, so the
  polls leave no command nodes in the log), and a row's running state lags a
  delegation's start/end by at most one poll interval.
- Typed `/taskpilot-interrupt` with args now resolves through the composer
  like any hint-carrying command; the handler's grammar is unchanged.

## Testing

- `active-delegations.spec.ts`: the fail-soft poll resolves empty for an
  absent channel, a thrown call, a non-ok result, and a missing value; returns
  the ids on ok.
- `taskpilot-dock.spec.tsx`: a one-shot row (summary `running: false`) renders
  the interrupt verb once the poll reports its id, drops it when the
  delegation leaves the active set (fake timers), keeps single-source
  behavior on an empty poll, and does not poll when no subagent rows exist.
  Existing row tests flush the mount tick inside `act` to keep React warnings
  quiet.
- `host-interrupt.spec.ts`: the registration carries the input hint.
- Suites: taskpilot 47/47; hygiene and plugin-independence gates green.
