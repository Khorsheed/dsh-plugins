# Agent Note: message-tools withdraw cancels running turns and restores interrupted assistant chunks

Status: implemented

English | [中文](2026-08-19-message-tools-withdraw-interrupted-assistant.zh.md)

## Problem

The「测试撤回」session showed two related defects in `packages/message-tools`:

1. **Withdraw did not cancel a running turn.** The edit path already cancels and waits for a running turn before computing the replacement span, but the withdraw path did not. If the user withdraws while the assistant is still streaming, the replacement lands before the remaining assistant chunks/teardown writes, so live assistant content can appear outside the withdrawn span.
2. **Restore could not recover interrupted assistant content.** A turn that is interrupted before finalization may never emit an `assistant/message` surface event; its visible content exists only as `assistant/chunk` rows. The withdrawal replacement's `sourceEventSeqs` only contains shadowed *surface* nodes, so `planRestore` never saw those chunks. The result in the repro was: withdraw left the partial assistant row visible, a hard refresh dropped the ephemeral/live content, and restore only brought back the user message.

## Decision

**Withdraw now uses the same cancel-and-settle choreography as edit** (`src/client/edit-in-place.ts` adds `withdrawInPlace`; `src/client/index.ts` wires it to `withdrawMessage`). When a session has a running turn, withdrawal cancels it and waits for the cancelled turn to fully settle (the same `turn/end`-keyed predicate used by edit) before calling the host `withdraw` RPC. A failed cancel or a timed-out settle rejects without withdrawing, so the replacement never races straggler assistant/tool writes.

**Restore now walks the full withdrawn log interval `[start, seq)` of the replacement, not only `sourceEventSeqs`** (`src/withdraw.ts`). `sourceEventSeqs` remains authoritative for shadowed surface nodes, but interrupted assistant steps only exist as non-surface chunks; the replacement's own `start` and `seq` delimit the complete log interval that was hidden. `replayEntries` now folds `assistant/chunk` rows into assistant replay entries for steps that never finalized as `assistant/message`, preferring text deltas and preserving reasoning-only partials so the restore does not silently drop content the user already saw. Finalized steps still replay from `assistant/message` and do not duplicate their chunks.

## Verification

`tests/withdraw.host.spec.ts` covers restoring text-chunk-only interrupted steps, reasoning-only interrupted steps, avoiding duplication when a final `assistant/message` exists, keeping interrupted assistant entries in original order between user messages, not splitting a chunk run at log-only interleaves, and treating `block-end` as the assembled text instead of duplicating deltas. `tests/edit-in-place.client.spec.ts` covers `withdrawInPlace` ordering (cancel → waitIdle → withdraw), idle no-cancel, cancel failure, settle timeout, and withdraw failure. `pnpm --filter @khorsheed/dsh-client-message-tools test` passes (176 tests); the package build passes with `DSH_HOME` pointed at a writable scratch location in this sandbox.

## Alternatives considered

**Keep restore on `sourceEventSeqs` only.** It is exact for the surface but blind to interrupted assistant chunks; it directly caused the reported restore gap.

**Expand `sourceEventSeqs` at write time to include every chunk.** That would also work, but it makes new withdrawals carry large provenance arrays and does not repair existing withdrawals already persisted without chunk citations. Reading the replacement's own `[start, seq)` interval repairs old and new sessions uniformly.

**Replay reasoning only when no text exists.** This is what shipped: text is the primary assistant reply, but a reasoning-only interrupted step is still preserved rather than lost. Replaying both text and reasoning for partial steps was rejected as noisy for normal interrupted replies with visible text.

## Consequences

Withdrawing mid-turn now behaves like editing mid-turn: it stops the turn first, so the replacement covers all content that belongs to the span. Restoring an old or new withdrawal can recover interrupted assistant partials from the durable chunk log. The cost is a possible cancel/settle delay (bounded by the existing 5s wait) before a withdrawal can land.
