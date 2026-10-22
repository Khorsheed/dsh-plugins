# Agent Note: Context Lens agent views

Status: implemented

## Problem

A turn's work can spread over the main conversation, dsh subagents, external agents (Claude Code, Codex, Kimi brought in by local-agent), and compaction calls. Context Lens showed them in disconnected places:
- Subagents appeared as plain chips.
- External agents a user invited into a room had no view at all on backfill. The log lane only built child views for catalog rows paired with a delegating tool call.
- Compactions were separate pseudo-turns in the turn stepper, unrelated to the turn they interrupted.
- A child session opened on its own did not say whose child it was.
- A compaction replayed from the log showed only the compacted messages, although the host's summarize call also carries the system head and the header's tools.

## Decision

- **One row of grouped views per turn.** Groups are main, external agents, subagents, and compaction (`AgentTabs.tsx`, the "B" grouped-capsule design from the local, untracked design prototype). A group with more than three entries shows two (the selected one always among them) and folds the rest behind "+N". "+N" opens the whole group in delegation order, with the delegating request number and the request count. A relation line under the row says how the selected view relates to the main conversation, with a jump back where a link exists.
- **External vs subagent** comes from the child's `subagent/descriptor` provider. `dsh*` means subagent; anything else (`codex-local`, …) is an external agent. The provider is read live from the child's session events and, on the log lane, from the child log.
- **Catalog-only children are views.** A `subagent/catalog` row that no pending delegation call claims becomes a delegation with `callId: ''`. Its status is `ok`, since the absence of a tool result is not evidence of failure, and it has no `delegatedBy`.
- **Delegation provenance.** A child view bound to a tool call carries `delegatedBy`, the main request whose response issued that call. Main requests carry `delegates` (the child views their calls started), which the trend draws as a dot.
- **Compactions attach to their turn.** A compaction pseudo-turn attaches to the turn named by `compaction/start`. Without a turn (between turns), it attaches to the next turn to begin. It disappears from the turn list and appears as that turn's `compaction:<pseudo turnSeq>` view, with `replacedCount` and the main request it followed. Every link to a compaction request — composition provenance, change-list jumps, the request view's own `scopeId` — goes through one `addressOf`, so navigation lands on the new address. The trend draws a dashed divider where it happened.
- **Compaction replay** prepends the surface-node-0 system message and the latest header's tools to the compacted region, matching compaction-basic's `buildSummarizationInput`. Only the trailing instruction, which lives in host code, stays missing; it is labelled as not recorded, and the request keeps `inputPartial`.
- **Parent link.** On backfill, a session whose log header names `parentSession` reads the parent log once for its title, the turn whose catalog row started it, and the catalog label. `ListTurnsResult.parent` carries these, and the panel prints them above the views.
- **Trend.** Bar width fits the panel: available width ÷ request count, clamped to 2–7px; below 2px the strip scrolls. Turns are separated and labelled at their start. The current turn is outlined rather than filled. The hit-ratio encoding is unchanged.

## Alternatives considered

**Underline tabs (design "A").** They are lighter, but lose the grouping between external agents and subagents, and scroll sideways when many children exist. The user picked the grouped capsules.

**A session-wide compaction tab on the far right.** It would detach compactions from the turn stepper and from the trend divider that marks where each happened. Attaching to the turn keeps the three in agreement.

**Classifying external agents by "no tool call".** A provider may start a child from a tool call too. The descriptor's provider is the recorded fact.

**Encoding cache misses as absolute red segments in the trend.** It was proposed and rejected by the user as visually odd. The existing hit-ratio fill stays.

## Consequences

- Compaction requests no longer have a turn of their own in `listTurns`. Callers that addressed them by pseudo-turn still resolve through `getTurn`/`getRequest`, but the panel only reaches them through the owning turn.
- The tab row drops the `#scopeSeq` prefix from child labels; ordinals remain in the overflow list as delegating request numbers.
- Parent resolution costs one extra log read per child session opened on its own, once per process.
- The trend no longer supports drag-to-scroll. It only scrolls natively when bars would fall under 2px.

## Testing

`tests/agent-views.spec.ts` covers:
- compaction replay with the system head and tools;
- catalog-only children;
- `delegatedBy` and `delegates`;
- compaction attachment and link readdressing, including the trend;
- the parent link.

`tests/client-agent-tabs.spec.tsx` covers grouping, the "+N" overflow with the selected entry kept visible, the relation lines, and the parent line. Existing panel and compaction specs were updated for tab roles and the new turn list.

A run over 3080 logs gave these results:
- The room session "邀请Claude、Kimi和Codex打招呼" now shows Kimi Code, Codex, and Claude Code views in turn 1; before this change it showed none.
- A session with compaction and pruning attaches its compaction to turn 5, after request #23, with a 9,253-character system head and 15 tools.
