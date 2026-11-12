# Agent Note: reuse official totals without erasing collaboration-specific views

Status: implemented

English | [中文](2026-11-12-official-stats-and-collaboration-boundaries.zh.md)

## Problem

The rc.2 host has native whole-log projections, background Jobs, and Team task boards. The community suite also has per-request analysis, external CLI execution, Room coordination and long-lived member sessions. Similar names do not make those models interchangeable.

## Decision

Context Lens reads `sessionStats` and `tokenUsage` through the real projection registry and adds a separate whole-log totals line to the existing request trend. It covers native turns, steps, disjoint input/output token buckets and model/tool wall time. Filtered scope views do not inherit a global total, and a missing Session or projection omits the line. Session lookup uses optional `ctx.get` probes, with the Agent registry as a fallback; a native-projection failure logs a warning and returns the original trend rather than suppressing it. Per-request composition, cache breakpoints, external CLI records, Room attribution and `meta.localAgentTiming` stay unchanged.

TaskPilot already consumes the official job-controller roster through `JobsChannel` and stops Jobs through `ctx.jobs.kill`. No Goal or Schedule model is imposed on external CLI or Room execution records, and no duplicate job source is added.

Message Timeline already uses `turnOutline` and history pagination. There is still no public `scrollToTurn`, so its existing DOM scrolling remains.

Room keeps its external CLI providers, cross-room help, reporting gate, coordinator transitions, durable task/goal rules and long-lived member sessions. Official Team tasks belong to one root subagent tree and do not express these responsibilities. Native member creation continues through the official Agent/subagent services; Team is not forced in as a replacement backend.

## Alternatives considered

**Replace Context Lens with the official Stats panel.** Rejected: the official whole-log totals cannot reconstruct each request's composition, cache boundary or external CLI timing. The two views now share a native total where it is meaningful, not a fake per-request aggregate.

**Put Room or external CLI executions into Goal or Schedule.** Rejected: their lifecycle, ownership and evidence semantics differ. TaskPilot stays a navigation and control surface over real Jobs and delegations.

**Retire Room in favor of Team.** Rejected: Team does not provide the Room's provider bridge, cross-room messaging or coordination and review policy.

## Consequences

The added statistics are native facts, never a sum over a loaded window. The integration changes no existing capture or collaboration lifecycle and does not claim that Team subsumes Room. Real `SessionStats`/`TokenMeter` events drive the acceptance test, including the filtered-scope absence case. A real rc.2 Loader/Remote/Chromium regression now proves that request bars remain visible beside the native totals; it reproduced `cannot get property "sessions" without inject` before the optional lookup fix. Separate fallback tests cover missing services and a failed projection without losing the original trend.

## Related

- [Host 0.2.2-rc.2 adaptation](../process/2026-11-12-host-022-rc2-adaptation.md)
- [Official-capability roadmap](../../../../proposals/active/2026-11-12-host-022-rc2-official-capabilities.md)
