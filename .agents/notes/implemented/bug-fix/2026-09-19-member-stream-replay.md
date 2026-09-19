# Agent Note: Member stream replay and Room output

Status: implemented

## Problem

The live browser had complete Kimi output while its stored child log stopped at the first `local-agent/stream` checkpoint. The real persistence backend refused this unregistered vocabulary on the next read, preventing subsequent suffix synchronization. Fake persistence tests did not exercise the host's vocabulary validation. Room also showed only a running row until the final answer, and the DSH stream combined reasoning and visible text in one item.

## Decision

The core registers `local-agent/stream` in both the installed and source host catalogs, using the existing Room compatibility seam. Both core and Room also resolve their event catalogs through the mounted loader during startup: a linked development package can otherwise register its own npm peer while the running backend uses a different host checkout. Registration remains for the process lifetime so previously written logs remain readable. Real JSONL and Zstandard integration tests read an initial checkpoint and then append and replay the remaining turn.

The shared live publisher supports distinct native content items within one step and explicit durable closing checkpoints. DSH preserves reasoning and text separately. All four live providers carry the earliest unflushed delta arrival into the shared output channel instead of dating it at publication. Identical snapshots do not fabricate a new arrival.

Room's running rows use the optional core output renderer and its shared member subscription. The run start excludes retained output from earlier rounds. Navigation and targeted Stop remain separate from the Markdown output. Removing the run releases the subscription; native member history remains the authoritative final transcript.

The live renderer keeps at most 256 local paint-delay samples per mounted content item. It samples after two animation frames while the document is visible, retains callbacks across newer updates to avoid discarding slow paints, and cancels them on unmount. This is a conservative same-clock diagnostic for loopback acceptance, not remote-host clock synchronization or a latency guarantee.

Kimi attaches the new round's output sink only after ACP session loading and configuration. Historical chunks emitted by `session/load` must not become a new answer or stream checkpoint. The native session remains loaded with its original context.

The Room client re-elects its composer when the first successful state read changes an unknown verdict to Room, as well as after an in-place promotion. Transport failures leave the verdict unknown, so a subsequent live notification can retry. This removes the need to switch tabs to activate the coordinator composer after a cold page load.

All four live providers enqueue and await a final child-store synchronization after their turn boundary and closing checkpoints, before their result resolves. A real Kimi round otherwise stored 87 of 88 events, omitting `turn/end` even after graceful shutdown. Stream-time persistence failures are logged without poisoning the queue; the final synchronization can retry the missing suffix. This preserves the existing best-effort persistence error contract, rather than misreporting a native generation failure when storage is unavailable.

Room retains nonempty output after cancellation or failure in its speech journal, with an optional `interrupted` status. Cold replay shows the partial text, explicit status, duration and member-session link. Partial replies do not produce trailing-line notification relays. An earlier explicit cancellation keeps its terminal state when the native result arrives, while retaining the partial output for the correlated delivery report.

## Alternatives considered

**Accept a final Room answer as proof of persistence.** Rejected by the real Kimi run: the answer existed in memory while the stored transcript was incomplete.

**Render only inside the child session.** This forces users to leave their default coordinator conversation to see generation progress.

**Mark events ignorable at append.** The inspected host's public `Session.append` does not accept that envelope option. Registering vocabulary uses the existing plugin seam without editing the host.

**Remove repeated answer prefixes after generation.** Rejected: identical text may be legitimate new output. Suppressing the historical load phase preserves native content boundaries without text heuristics.

## Consequences

The regression tests cover the actual storage reader and distinguish native subitems on replay. Browser latency still requires measured acceptance; the timestamp changes and 50 ms transport cadence alone do not establish P95 ≤ 200 ms. Existing lab records interrupted by the missing registration require recovery from a verified complete live snapshot or native transcript before restart; registration cannot recreate events never persisted.

Additional tests cover ACP load replay exclusion, cold composer election and retry after a transport failure. The Kimi and Room suites pass 244 and 272 tests respectively; real cold-start and busy-control acceptance remain separate checks.

An asynchronous storage regression for each live provider verifies that the resolved result already has a complete durable transcript ending in `turn/end`. Provider suites pass: DSH 187, Codex 224, Claude 232 and Kimi 245. A failed write is still diagnostic-only; storage availability is not guaranteed by a successful model answer.

Room tests cover cancellation and failure partials, suppression of unfinished relay directives, and a cold-replayed partial's status and child link. Empty cancelled output remains hidden. The Room suite passes 275 tests.
