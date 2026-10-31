# Agent Note: file-preview reads diffs from settled PTC dispatches

Status: implemented

## Problem

Code Mode file calls reach the session as `tool/ptc-dispatch`, not ordinary `tool/result` rows. file-preview recorded their paths but ignored their presentation metadata, so the detail view had no change history and turn cards could not report line deltas. The seam registry also described dispatch attribution as a client-side dead end even though the host and client already shared the root-call-derived turn fold.

## Decision

Both folds in `src/fold.ts` consume `tool/ptc-dispatch.meta` with the same strict narrowing used for native result metadata. Official `write` and `edit` presentation metadata supplies the diff hunks; dispatch entries borrow turn and step through `rootCallId` as before. Arguments retain the display path while `meta.path` and the diff paths can be canonical absolute paths, so only diffs whose path exactly equals the top-level `meta.path` are mapped back to the argument's display path; other render-intent paths stay untouched. A create carries `operation: 'create'` and an empty diff list, so its full written content supplies the added-line count and zero removals. An empty non-create diff list contributes no count. Missing or malformed metadata keeps the previous unknown-wins behavior for old logs and third-party tools, and failed dispatches never contribute.

The Remote shape and public result types do not change. S3 is therefore retired by consuming data the host already publishes, and S4 is retired by the existing `rootCallId` attribution shared by the host Remote and client card; neither requires a new rc4 API.

## Alternatives considered

- **Wait for dispatch-specific oldText/newText fields**: rejected. The existing presentation metadata already carries the same diff vocabulary as native results, and the rc4 artifacts confirm it is emitted in the settled dispatch path.
- **Infer creates from an empty diff list alone**: rejected. A no-change update can have the same empty list; only an explicit `operation: 'create'` permits full-content counting.
- **Keep canonical diff paths or recover the display path by suffix matching**: rejected. Raw canonical paths split one file into separate entries, while suffix guesses can merge different files. Exact equality with the dispatch's own top-level `meta.path` defines the safe mapping.
- **Drop support for logs without dispatch metadata**: rejected. Older sessions and tools without a projector retain their previous path entries and unknown counts instead of acquiring fabricated diffs or totals.
- **Add turn and step to every dispatch**: unnecessary. The root call already owns those coordinates, and both presentation layers consume the same derived map.

## Consequences

Code Mode write/edit gains detail history and per-turn line counts without a second data channel. Create and no-change update remain distinguishable. Any dispatch whose metadata is absent or invalid still makes the affected totals unknown, so mixed old/new histories never display a misleading partial sum.

This does not retire S2: bash writes that never pass through the file tools still need the collector. It also does not require every tool to provide presentation metadata.

## Testing

`tests/fold.spec.ts` covers dispatch diffs, create, empty update, legacy and malformed metadata, failure suppression, repeated paths, and root attribution. `tests/ptc-dispatch.integration.spec.ts` executes the official ToolRuntime and file tools through a real PTC bridge, then feeds the emitted session events through both folds. The same integration test runs against the npm rc4 artifacts as well as the source seed.
