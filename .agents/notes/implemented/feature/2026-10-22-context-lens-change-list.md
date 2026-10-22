# Agent Note: Context Lens change list

Status: implemented

## Problem

The cache section compared consecutive requests only up to the first difference. It printed "prefix of message 000 changed" plus a character diff, which left the reader to work out what the change was, why it happened, and whether anything else moved. A real case made the gap concrete: in one session a message edit (message-tools) was followed by a 0.9% cache hit, and the panel showed only a 139-character insertion into message 000. The actual sequence was a system-prompt update appended mid-history two turns earlier (cache intact), then folded back into the head when the edit's surface replacement started a new request series. A tool-description change showed nothing but "tool definitions changed", and no filter appeared, because the `tool-change` category only exists for the host's add/remove `developer` message.

## Decision

The request view's `prefix` carries a full change list next to the existing first-difference fields:

- **`changes`** — every message-level change. Messages pair by durable id (content hash for id-less ones). Each entry's `kind` names the host fact behind it, never an interpretation:
  - `replace`: a `surfaceOp: replace` event, with the shadowed rows, the replacing row, its producer `kind · op` verbatim, and the log seqs.
  - `compaction` / `prune`: a replacement immediately preceded by `compaction/summary` / `compaction/prune` (the host's shadow-price contract makes that adjacency reliable). Prunes keep the message id; only the text shrinks.
  - `remove` / `add`: id-level differences with no replacement fact to pair them (captures from before the facts were recorded, or an evicted window).
- **System grouping** — every all-system change folds into one entry, diffed head against head, with its constituent events listed as `parts`, the assemble section holding the diff start when the live lane attributed it, and `sameAs` when the new head equals a removed in-history system message in full. That is a checkable equality. The note never claims the update "moved".
- **`toolChanges`** — tool definitions pair by name: added, removed, or modified (separate description and parameter diffs). `owner` comes from the capability-catalog origin tag (`Symbol.for('dsh.tool.origin')`) on the live registry, when the tool is tagged.
- **`tail`** — unexplained additions after the last kept or replaced row are the ordinary append, summarized as a count plus sources. System rows never fold into the tail.
- **`configChanged`** — provider or model differs from the previous request.
- **Break** — the change containing the first differing message index carries `isBreak`. With an unchanged message prefix, the first changed tool carries it instead.

Replacement facts live in a bounded per-session registry (`InspectorStore.noteReplacement`, 2048 facts). The live `session/event` lane resolves shadowed seqs through `session.eventAt`. Main-session backfill scans the whole log (`replacementFactsOf`). Both read the same row shape: step events nest the message under `data.message`, while user messages are `data` itself.

The panel (`ChangeList.tsx`) shows one break line, then cards. The break card is outlined and opens by default; jumps go to the owning module: the composition filter for system and tools, the compaction request, and the request before pruning. Captures that predate `changes` keep the old first-difference view.

## Alternatives considered

**A ruler diagram of both requests with the break drawn through it.** It was prototyped in three rounds (`proposals/prototypes/context-lens-cache-explain.html`). It tried to show both where the break is and what changed. The block widths need per-segment token counts the provider never reports, and the tool position relative to messages is provider-internal. The user found it hard to read without prose. It lost to one break line plus a list.

**Interpretive change types (`moved`, `modified`, "edit trigger").** These were in an earlier prototype round. The host emits two independent replacements for a consolidation and a new id for every replacement, so "moved" and "modified" are conclusions, not data. The list names event kinds and shows producer fields verbatim; equalities stand in for conclusions.

**Diff against a shifted alignment (LCS over text).** Durable ids already identify messages exactly. Text alignment would invent pairings the host never made.

**Inferring the tool/message wire order from hit counts.** The data can corroborate an order, but cannot establish it. The break line states that the provider decides it.

## Consequences

- The list is exact where the host recorded facts. Without them it degrades to id-level remove/add, and still never claims a pairing.
- The registry is memory-bounded. A request whose replacements fell out of the 2048-fact window shows remove/add.
- `segmenter` now carries `messageId` on unattributed system rows too, which system grouping needs.
- Provider-side cache loss with an unchanged prefix (expiry, or routing on aggregator providers) shows as "no break" beside a red usage strip. The panel does not guess the cause.

## Testing

`tests/changes.spec.ts` covers the following:
- an edit-then-consolidate fixture mirroring a real log, both with and without facts;
- a plain append, prune and compaction typing, and real event shapes;
- tool diffs, section attribution, store integration, and model switches.

`tests/client-config.spec.tsx` renders the list, the default-open break card, and the system jump. A one-off run over the 3080 session logs reproduced the motivating session: request #12 shows the mid-history prompt append with no break, #16 shows the system group as the break with `sameAs`, and #20 shows a tool break.
