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

- **The session map first, the turn's participants under it.** The trend sits above the tabs, fills the panel width on one baseline, and always shows the main conversation; it picks the turn. Each turn is a cell (wider when it holds more requests); the current turn is a tinted band with its number in bold. The turn's question follows, prefixed with its turn number. Under it, one flat row of underline tabs that forms the header's bottom edge (`AgentTabs.tsx`) lists the main conversation and every participant of the selected turn: external agents, subagents, and compactions, with no grouping and nothing that did not take part. Past four participants beside the main conversation, three stay visible (the selected one always among them) and the rest fold behind "+N". "+N" lists them all in start order, with the delegating request number and request count. The main conversation is selected by default. Header blocks sit 12px apart.
- **The relation note holds only facts with a jump**: the delegating request and a compaction's position, at the end of the tab row. It carries no provider names or explanations, and the main conversation has none. A failure shows only as the tab's ✗ and the failure card below; success carries no mark.
- **A turn no human started names its trigger.** When a turn has no human message, its first message from a non-ambient producer becomes `TurnListItem.trigger`. Ambient producers are runtime context, skills, reminders, and checkpoints. The panel shows the trigger's source tag and last paragraph instead of an empty query line. Injected triggers lead with standing instructions and end with this turn's delivery, so the last paragraph is the part that differs between turns.
- **External vs subagent** comes from the child's `subagent/descriptor` provider. `dsh*` means subagent; anything else (`codex-local`, …) is an external agent. The provider is read live from the child's session events and, on the log lane, from the child log. The tab row does not group by it; it stays on the view for consumers that need the distinction.
- **Catalog-only children are views.** A `subagent/catalog` row that no pending delegation call claims becomes a delegation with `callId: ''`. Its status is `ok`, since the absence of a tool result is not evidence of failure, and it has no `delegatedBy`.
- **Delegation provenance.** A child view bound to a tool call carries `delegatedBy`, the main request whose response issued that call. Main requests carry `delegates` (the child views their calls started), which the trend draws as a dot.
- **Compactions attach to their turn.** A compaction pseudo-turn attaches to the turn named by `compaction/start`. Without a turn (between turns), it attaches to the next turn to begin. It disappears from the turn list and appears as that turn's `compaction:<pseudo turnSeq>` view, with `replacedCount` and the main request it followed. Every link to a compaction request — composition provenance, change-list jumps, the request view's own `scopeId` — goes through one `addressOf`, so navigation lands on the new address. The trend draws a dashed divider where it happened.
- **Compaction replay** prepends the surface-node-0 system message and the latest header's tools to the compacted region, matching compaction-basic's `buildSummarizationInput`. Only the trailing instruction, which lives in host code, stays missing; it is labelled as not recorded, and the request keeps `inputPartial`.
- **Parent link.** On backfill, a session whose log header names `parentSession` reads the parent log once for its title, the turn whose catalog row started it, and the catalog label. `ListTurnsResult.parent` carries these, and the panel prints them above the views.
- **Trend.** Bar width fits the panel: available width ÷ request count, clamped to 2–7px; below 2px the strip scrolls. Turns are separated and labelled at their start. The current turn is outlined rather than filled. The hit-ratio encoding is unchanged. A dashed line marks a compaction and opens it. The map carries no participant marks: a dot under a delegating request and a mark on turns with other agents were tried and dropped, because they repeated what the tabs already show and their meaning was not readable from the map.

## Alternatives considered

**Grouped capsules with external agents kept in every turn.** This shipped first: groups for main, external agents, subagents, and compaction above the trend, and every external agent's tab kept in every turn, dimmed where it did not run. In use it inverted the reading order (the trend sits under a view selector it also depended on) and left many tabs that opened onto nothing. Putting the turn map first and listing only the turn's participants removed both, at the cost of following one agent across turns from its tab; the turn marks on the map show where other agents ran.

**Underline tabs (design "A").** They are lighter, but scroll sideways when many children exist.

**A session-wide compaction tab on the far right.** It would detach compactions from the turn stepper and from the trend divider that marks where each happened. Attaching to the turn keeps the three in agreement.

**Keeping every child's tab in every turn.** It leaves tabs that open onto nothing. Only the selected turn's participants are listed.

**Previewing a trigger by its opening text or by its difference from the previous trigger.** Room deliveries open with an identical coordinator prompt and roster. A common-prefix cut breaks as soon as the roster changes. The last paragraph matched the delivery in every turn of the real room session.

**Classifying external agents by "no tool call".** A provider may start a child from a tool call too. The descriptor's provider is the recorded fact.

**Encoding cache misses as absolute red segments in the trend.** It was proposed and rejected by the user as visually odd. The existing hit-ratio fill stays.

## Consequences

- Accent color (selection, the current turn, the tab underline, focus) is `--dsw-alias-state-business-primary`; links use `--dsw-alias-link`; compaction marks use the panel's `--ri-compaction` violet. `--dsw-alias-brand-primary` is the theme's neutral emphasis (near-black in light, near-white in dark), not an accent: using it rendered black outlines and gray bands in light mode.
- Surface fills use the panel's `--ri-fill-1` (`bg-module-platform`) and `--ri-fill-2` (`button-ghost-active-fill`), never `bg-layer-2/3` directly: the host's light theme paints all three layers white, which erased the segmented switch, the timeline track, and every gray card body. The timeline draws idle stretches as a hatched span, labelled before the first request, between requests, or after the last one, so the bar accounts for the whole turn.
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

`tests/client-agent-tabs.spec.tsx` covers the flat participant row, the "+N" overflow with the selected entry kept visible, the relation lines, and the parent line. Existing panel and compaction specs were updated for tab roles and the new turn list.

A run over 3080 logs gave these results:
- The room session "邀请Claude、Kimi和Codex打招呼" now shows Kimi Code, Codex, and Claude Code views in turn 1; before this change it showed none.
- A session with compaction and pruning attaches its compaction to turn 5, after request #23, with a 9,253-character system head and 15 tools.
