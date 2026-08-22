# Agent Note: message-tools withdraw cancels running turns and restores interrupted assistant chunks

Status: implemented

English | [中文](2026-08-19-message-tools-withdraw-interrupted-assistant.zh.md)

## Problem

The「测试撤回」session showed related defects in `packages/message-tools`:

1. **Withdraw did not cancel a running turn.** The edit path already cancels and waits for a running turn before computing the replacement span, but the withdraw path did not. If the user withdraws while the assistant is still streaming, the replacement lands before the remaining assistant chunks/teardown writes, so live assistant content can appear outside the withdrawn span.
2. **Restore could not recover interrupted assistant content.** A turn that is interrupted before finalization may never emit an `assistant/message` surface event; its visible content exists only as `assistant/chunk` rows. The withdrawal replacement's `sourceEventSeqs` only contains shadowed *surface* nodes, so `planRestore` never saw those chunks. The result in the repro was: withdraw left the partial assistant row visible, a hard refresh dropped the ephemeral/live content, and restore only brought back the user message.
3. **Restore also skipped a reasoning-only `assistant/message`.** In the「统计今天12点前后token用量与价格」session the withdrawn assistant message was an interrupted `assistant/message` whose content was only `reasoning`. `replayEntries` only joined `text` blocks, so even when the surface event existed, restore still omitted it.
4. **The divider count double-counted restored rows.** After restoring a user message and withdrawing it again, the span contained one restored user row plus its hidden `context` duplicate; `countHiddenInSpan` counted both, showing「已撤回 2 条消息」even though only one user message was actually visible/withdrawn.

## Decision

**Withdraw now uses the same cancel-and-settle choreography as edit** (`src/client/edit-in-place.ts` adds `withdrawInPlace`; `src/client/index.ts` wires it to `withdrawMessage`). When a session has a running turn, withdrawal cancels it and waits for the cancelled turn to fully settle (the same `turn/end`-keyed predicate used by edit) before calling the host `withdraw` RPC. A failed cancel or a timed-out settle rejects without withdrawing, so the replacement never races straggler assistant/tool writes.

**Restore now walks the full withdrawn log interval `[start, seq)` of the replacement, not only `sourceEventSeqs`** (`src/withdraw.ts`). `sourceEventSeqs` remains authoritative for shadowed surface nodes, but interrupted assistant steps only exist as non-surface chunks; the replacement's own `start` and `seq` delimit the complete log interval that was hidden. `replayEntries` now folds `assistant/chunk` rows into assistant replay entries for steps that never finalized as `assistant/message`, preferring text deltas and preserving reasoning-only partials so the restore does not silently drop content the user already saw. Finalized steps still replay from `assistant/message` and do not duplicate their chunks.

**Reasoning-only `assistant/message` is restored too** (`src/withdraw.ts` adds `joinAssistantMessageText`). Normal replies prefer `text` blocks; an interrupted `assistant/message` that contains only `reasoning` now falls back to that reasoning instead of being treated as empty.

**The divider count counts user-visible messages, not UI chrome** (`src/client/withdrawn-node.ts`). `countHiddenInSpan` now mirrors `collectWithdrawnEntries`: context injections, tool calls, turn tails, and edit-trigger rows are not counted, while restored/edited rows and reasoning-only assistant steps are. This makes the count stable across withdraw → restore → re-withdraw instead of over-reporting the first span (e.g. 5 due to context/turn-tail) and then under-reporting or double-counting later.

**The divider expand also understands plugin rows.** `collectWithdrawnEntries` now reads `message-tools-restored`, `message-tools-restored-assistant`, and `message-tools-edited` rows, and `joinAssistantText` falls back to reasoning-only assistant steps. Re-withdrawing a restored/edited row therefore expands to its actual content instead of「没有内容」.

**Every message-tools context row is hidden, not only known duplicates.** The DOM hider now hides any `context` row whose source plugin is `message-tools`. This prevents the official runtime's context-injection row for a restore/trigger from leaking even when the corresponding plugin row is not currently materialized in the node store.

**Only the latest active restore point is offered.** `isRestoreSuperseded` disables restore on an earlier divider once its restore rows have themselves been re-withdrawn into a later span. This prevents the duplicate restore entries seen in「列出当前可用技能-撤回测试」when the user toggles withdraw → restore → withdraw and both the original divider and the re-withdrawal divider offer restore.

## Verification

`tests/withdraw.host.spec.ts` covers restoring text-chunk-only interrupted steps, reasoning-only interrupted steps, reasoning-only `assistant/message`, avoiding duplication when a final `assistant/message` exists, keeping interrupted assistant entries in original order between user messages, not splitting a chunk run at log-only interleaves, and treating `block-end` as the assembled text instead of duplicating deltas. `tests/withdrawn-node.client.spec.ts` covers counting user-visible messages rather than UI chrome, excluding duplicate restore context rows and edit-trigger context rows from the divider count, collecting restored/edited rows plus reasoning-only assistant steps in the divider expand, and detecting superseded restore spans. `tests/divider-restored.client.spec.tsx` covers disabling restore on a superseded divider without showing the restored badge. `tests/dom-hider.client.spec.ts` covers hiding every `message-tools` context row, not only rows with a currently materialized plugin counterpart. `tests/edit-in-place.client.spec.ts` covers `withdrawInPlace` ordering (cancel → waitIdle → withdraw), idle no-cancel, cancel failure, settle timeout, and withdraw failure. `pnpm --filter @khorsheed/dsh-client-message-tools test` passes (180 tests); the package build passes with `DSH_HOME` pointed at a writable scratch location in this sandbox.

## Alternatives considered

**Keep restore on `sourceEventSeqs` only.** It is exact for the surface but blind to interrupted assistant chunks; it directly caused the reported restore gap.

**Expand `sourceEventSeqs` at write time to include every chunk.** That would also work, but it makes new withdrawals carry large provenance arrays and does not repair existing withdrawals already persisted without chunk citations. Reading the replacement's own `[start, seq)` interval repairs old and new sessions uniformly.

**Replay reasoning only when no text exists.** This is what shipped: text is the primary assistant reply, but a reasoning-only interrupted step is still preserved rather than lost. Replaying both text and reasoning for partial steps was rejected as noisy for normal interrupted replies with visible text.

**Count every context row in the divider.** It would match the surface span exactly, but it does not match what the user sees: the DOM hider already hides restore-duplicate and edit-trigger context rows, so the divider would over-report hidden messages.

## Consequences

Withdrawing mid-turn now behaves like editing mid-turn: it stops the turn first, so the replacement covers all content that belongs to the span. Restoring an old or new withdrawal can recover interrupted assistant partials from the durable log (including reasoning-only `assistant/message` or chunk content). The divider count now reflects the user-visible hidden message count instead of including hidden context duplicates. The cost is a possible cancel/settle delay (bounded by the existing 5s wait) before a withdrawal can land.
