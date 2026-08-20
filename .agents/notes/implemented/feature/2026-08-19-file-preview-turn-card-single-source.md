# Agent Note: Turn card and products tab share one host source

Status: implemented

English | [中文](2026-08-19-file-preview-turn-card-single-source.zh.md)

## Problem

The turn-tail mutation card ("N files changed") and the products tab (产物) read two independent pipelines, so they could diverge: the tab folds the session log host-side (`filePreview.list` — read/write/edit + Code Mode dispatches + the bash-write collector), while the card was a CLIENT-side `ConversationNodeDefinition` fold over `write`/`edit` tool calls plus the official deliverables union. A file written via `bash` appeared in the tab (after the S2 collector) but never in the card. Client-side bash parsing was a dead end for a second reason beyond missing env/stat: the conversation-event fold's `match` contract allows no Context or history access, and `tool/code-dispatch` events carry no turn field — the client can never attribute nested mutations to a turn. The host is the only correct home for per-turn attribution.

## Decision

Make the HOST the single source of truth for per-turn mutations, and turn the card into an async thin shell that reads it — then retire the client fold and the deliverables union, so "tab has it, card doesn't" becomes structurally impossible.

- **Host `filePreview.turnFiles(agent)`** (new Remote method): folds the session log **per turn** — `foldFilePreviewByTurn` — keeping a path in EVERY turn that touched it (write/edit calls with their own turn, Code Mode dispatches borrowing the enclosing root call's turn, and render-intent paths registered from `tool/result` diff meta with the result's turn), summing per-turn line deltas from the diffs (removed unknown for creates/overwrites). The bash collector's verified writes merge by their own turn. The by-turn fold is cached per session and invalidated by the log watermark, so repeated card fetches do not refold; the response carries the watermark for the client cache.
- **Prerequisite fold change**: `tool/result` diff meta now REGISTERS its paths in the `list` fold too (previously skipped when no write/edit call recorded them) — the render-intent vocabulary (non-write/edit mutation tools, the official deliverables' follow-along locations) so both surfaces cover it.
- **Client card** (`TurnFileRow`): claims every turn unconditionally (`selectTurnFiles` returns a non-null marker; priority -1 unchanged, so the official produced-files row never mounts), fetches `turnFiles` on mount through a **session-level cache** (`createTurnFilesLoader` — one RPC warms every turn rendered so far; a card for a newer turn refetches once, host-side cheap), and renders nothing until the fetch settles, for an empty turn, or on failure. Flicker is confined to the first card per session.
- **Retired**: the client `turnFilesDefinition` conversation-event fold, the `filePreviewMutations` Turn-data key, the deliverables union in the card's select, and the `conversationEvents` inject. The card's line deltas now come from the host's diff-meta sums instead of the client diff call view.

## Alternatives considered

- **Reusing `list` and filtering by turn client-side** (the "one fetch per card" variant). Rejected: `list` dedupes a path to its LAST occurrence, so a file touched in turns 2 and 5 would vanish from turn 2's card — the card is exactly the surface that must not lose turn attribution; and one fetch per card is N RPCs on a long session. The per-turn fold answers both.
- **Client-side bash parsing in the card fold.** Rejected twice over: the client has no environment (`$DSH_HOME` cannot expand) and no `fs.stat` verification, and the fold's `match` contract bars Context/history access while code-dispatch carries no turn — attribution is impossible client-side.
- **Keeping the deliverables union.** Rejected: the host fold's diff-meta registration covers the same vocabulary, so the union is dead weight once the card reads `turnFiles`.

## Consequences

One pipeline, two surfaces: the card and the tab read the same host data, so today's divergence class is gone. The card's data is exact per turn (repeated touches included) and includes bash-written and render-intent files for the first time. The client bundle shrinks (no conversation-event fold, no deliverables merge) and the `conversationEvents` inject disappears. The card is now asynchronous: the first card per session does one RPC (the host watermark cache answers repeats cheaply). The tab's diff history still shows only write/edit diffs (bash/render-intent entries have no per-file history) — unchanged from the S2 design. Tests: host by-turn fold (repeated touches, render-intent registration, dispatch turn borrowing, delta sums), the `turnFiles` RPC with collector merge, the client loader cache, and the rewritten async card; both suites green.
