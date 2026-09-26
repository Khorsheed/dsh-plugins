# Agent Note: TaskPilot's Background jobs capsule lists only the jobs the tool announced

Status: implemented

## Problem

The dock's "Background jobs" capsule mirrors the job controller's per-session roster, and that roster mixes two kinds of row that look identical. `tool-bash` registers **every** call as a job — "a foreground call is a job the tool waits on, so the command is visible and killable from the moment it starts" — and deletes a foreground call's record the instant it settles (`registry.remove` in the foreground wait), while a background job's record survives settlement for the owner agent's lifetime. Nothing in the wire distinguishes them: `JobSpec` and `JobView` carry `kind: 'bash'`, a label, an owner, and lifecycle fields, and no background flag exists anywhere on the path.

The capsule inherits both halves of that. A foreground row appears while its command runs and vanishes with it, and capsule visibility is `jobs.length > 0`, so the whole pill blinks out at the end of a command; a command that finishes inside the job controller's 100 ms roster coalescing window is registered and removed before any frame reads the registry, so it never appears at all. In the session that surfaced this (小红书爬虫梦境研究建议, `session-190d5c52`), all nine `bash` calls were foreground — the capsule could only ever blink, and the fast ones were invisible.

A subagent's `bash` jobs are a third, separate case, out of scope here: `registry.list(caller)` fences on owner, so a child session's jobs belong to the child's roster and never reach the parent's capsule.

## Decision

The dock renders a `bash` row only when the session log announced it as a background job. `./src/client/announced-jobs.ts` folds one history page into three facts:

- **ids** — `started background job <id>` is credited **only** when the paired `tool/call` carried `run_in_background: true` (so a foreground command that merely printed the sentence cannot whitelist a job); `moved to background job <id>`, the promotion a foreground call earns at its timeout, is credited even unpaired, because a false positive only shows a row that would otherwise be hidden.
- **since** — the earliest event time the page covered.
- **ambiguousSince** — the earliest background call in the page whose ack was not readable.

A row is hidden iff it is a `bash` row, its `startedAt` is at or after `since`, its id is absent from `ids`, and its `startedAt` precedes `ambiguousSince` when one exists. Every other row renders: non-`bash` kinds never are (no producer removes them), rows older than the page are never are, and a missing window — no history channel, a failed read, an empty page — hides nothing, so every unreadable path degrades to the behavior before this filter existed.

The read is the same capability-probed history channel the detail tab already uses (`remote.session.follow`/`page`), so the bundle gains no RPC surface. It is armed on session mount, before the first row can arrive (which is what keeps a foreground command out of the very first frame), and repeated while a fresh unannounced id appears, for at most `BASH_ANNOUNCE_GRACE_MS`; past that the row is a foreground record and the verdict is final. A status tick inside the same id set reads nothing.

Retirement path: this module is one injected read behind one prop. If the host ever marks a job as background (`JobSpec`/`JobView`) or stops registering foreground calls, the filter collapses to reading that field and the log read goes away.

## Alternatives considered

**Wait for a host field, or ask the host to stop registering foreground calls.** The root-cause fix, and the reason the filter is isolated behind one injected read. Rejected as the *first* step only because it needs an upstream change: the plugin-side verdict is exactly the code that retires when the field lands, and it ships now.

**Show only rows observed in a terminal state.** No new plumbing, and exact in one direction — a foreground record is removed at settlement, so a settled roster row is provably a background or promoted job. Rejected: it makes a running background job invisible for its entire run, which is the one moment the capsule exists for.

**Read the fact from `SessionBinding.eventSource` instead of the history RPC.** The client session binding does expose the event window, but its contract reserves it for Conversation assembly; a plugin reading it directly is out of contract. Rejected in favor of the RPC the detail tab already drives.

**A sticky client-side cache of rows once seen.** Removes the blink but keeps foreground rows in the capsule, and cannot recover the commands that never reached a frame. Rejected: it hides the defect rather than deciding it.

## Consequences

Bought: the capsule stays while the model has background work; every row it lists is a job the model knows (it has an id, `job_output`/`job_kill`, and the detail tab); the stop verb can no longer abort a command the model is merely waiting on; a `run_in_background` call appears immediately (its ack is durable in the same step that registers the job) and a promoted one appears at its timeout, which is exactly when it becomes a background job.

Cost: a foreground command is invisible in the capsule while it runs — it remains visible in the conversation's own tool card; a promoted job is invisible until its timeout; the dock reads one bounded session-log page per session open and per fresh unannounced `bash` id; promotion evidence is a single ack sentence, so a page split that loses it hides that row until the next read; and after a successful read a later unreadable one leaves the last verdict standing, which self-heals on the next `bash` call.

Found alongside, deliberately not fixed here: the detail tab's trajectory fold (`job-trajectory.ts`) pairs a result through `message.content[0].toolCallId`, the pre-0.1.5 shape. The current host puts the call id on `message.toolCallId` and `message.source.callId`, so the fold returns no entries on real logs — verified by folding `session-70b25dac`'s own tool rows, which this change's parser reads correctly. Repairing it is a separate user-visible change with its own decision.

## Testing

`tests/announced-jobs.spec.ts` pins the fold (current and legacy wire shapes, the unspoofable background ack, the unpaired promotion, ambiguity, malformed rows, the empty page), the verdict (hidden/kept/non-`bash`/older-than-page/fail-open/ambiguous), the refresh key, and the loader's never-rejecting contract. `tests/taskpilot-dock.spec.tsx` adds the mount-level cases: a foreground row is hidden and the capsule leaves with it, an announced row keeps its stop verb, an unreadable log shows every row, a non-`bash` job survives beside a hidden `bash` row, a late ack is revealed on a retry, and the retries stop at the grace window. The parser was additionally checked against the real tool rows of `session-70b25dac`, where it finds exactly the two background jobs that session started.

## Related

- [TaskPilot's job detail tab is a page-type right-sidebar tab](../architecture/2026-09-10-taskpilot-sidebar-tab.md) — the tab whose history channel this filter reuses.
- [Host 0.1.7-rc.1 adaptation](../architecture/2026-09-24-host-017-rc1-adaptation.md) — the dual-channel roster read the filtered rows come from.
- [TaskPilot trajectory rows carry the issued command line](../feature/2026-08-21-taskpilot-trajectory-command-lines.md) — the fold named in Consequences as still expecting the legacy wire shape.
