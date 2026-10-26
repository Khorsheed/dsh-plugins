# Agent Note: message-tools hides group container rows, not just member rows

Status: implemented

## Problem

After editing (or withdrawing) a message on host ≥ 0.1.7-alpha.1, the pre-edit tool-call fold headers (「已调用工具」…) still rendered above the edited bubble — the withdrawn span's content "bled through". The DOM hider's rules target each chat row's `data-chat-flow-key`, and ChatNodeSeat stamps that attribute with the NODE key. But 0.1.7-alpha.1's definition-owned conversation groups (ChatGroupSeat) wrap a turn's process rows in a container stamped with the GROUP key: the member rules hid every row inside the group body, while the container — the fold header itself — matched no rule and stayed visible. User messages kept hiding (the shadowed renderer checks spans itself), which made the leak look like "only the tool rows survive".

## Decision

The rule set now covers the grouped rendering's two extra row shapes (`hiddenGroupFlowKeys` in `packages/client-message-tools/src/client/dom-hider.ts`):

- **A group container hides when every member's node key is hidden.** Membership is read from the typed public group contract (`uiConversation.binding(sessionId).snapshot.getSnapshot().views.grouped('chat')` — entries plus per-group sources), not from the DOM. A group straddling a span boundary keeps its header for the members that remain visible.
- **A hidden member's composite groupPart row key (`["<nodeKey>","<part>"]`, e.g. the reasoning pane) is always added**, whether or not its group hides as a whole — ChatNodeSeat stamps part rows with that composite key, which the plain node-key rule never reaches. The `'response'` part needs no rule: it reuses the plain node key.

The grouped reader is resolved per apply pass and guarded twice — `views.grouped` absent (pre-group hosts) and the binding read throwing (unknown session) both degrade to the plain node-key rules, which already cover those hosts' ungrouped rows. The rewrite signature gained the group keys so a grouping-only delta still rewrites the stylesheet; the assembler runs group definitions inside the same publish the chat snapshot reports, so the reader is current at apply time.

## Alternatives considered

**A CSS `:has()` rule (hide a group container containing no visible member).** Rejected: "member is hidden" is itself expressed by this stylesheet, and `:not(:has([data-chat-flow-key]:not(<every hidden key>)))` would embed the full key list a second time and re-match it against every group row on each DOM change. The JS read of the grouped view is exact, cheap, and unit-testable.

**An upstream suppression seam in the conversation projection.** The assembler deliberately offers none (the hider's module doc and README carry this), and the undocumented surface here is only the `data-chat-flow-key` attribute the hider already probes for; the group contract itself is typed public API.

## Consequences

- Edit and withdraw spans hide the「已调用工具」fold headers again on host ≥ 0.1.7-alpha.1; pre-group hosts (minHost 0.1.5-rc.1) are byte-identical in behavior.
- Partially hidden groups keep their header; the fold title's summary may still count hidden members — cosmetic, and the same trade the host's own folding makes.
- Tests: `packages/client-message-tools/tests/dom-hider.client.spec.ts` covers the pure fold (full/partial/empty/missing groups, composite part keys) and the installed hider (group keys in the written rules, the pre-group degrade, a throwing snapshot read).
