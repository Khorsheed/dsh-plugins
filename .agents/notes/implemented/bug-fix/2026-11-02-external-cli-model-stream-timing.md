# Agent Note: External CLI model streams and historical timing

Status: implemented

## Problem

External CLI mirrors wrote `assistant/message.stream: []`. Context Lens therefore placed first-token waits, reasoning, text and argument generation into `other`, even after tool execution metadata had recovered the real execution interval. Its request bounds also came from mirror append times: batched writes could overlap a later model request, while old mirror step numbers did not always match the CLI's native step numbers.

## Decision

- `packages/local-agent/src/model-stream.ts` converts observed model blocks into the host's standard `AssistantStreamRecord` block-start/end records. Kimi, Claude Code and Codex write these records into new mirrors, so native Deepseek and external CLIs share Context Lens's `readStream → requestLanes → scopeTiming` classification rather than a separate presentation algorithm.
- Kimi uses request dispatch, first-token latency and content-part times. Claude Code uses first-delta time or adjacent stream-json event times. Codex uses item start/completion times and starts a tool-argument block at the preceding event, never at tool execution. Post-hoc parsing without timing does not invent it.
- Each provider exposes an optional `LocalAgentTimingAdapter`. It returns model streams, request starts when recorded, and tool intervals from the original CLI records. `LocalAgentRegistry.memberModelTiming` resolves the member's delegation and scoped home; Context Lens probes this capability structurally and keeps independent installation and legacy fallback.
- Historical reconstruction is read-only. It fills only missing streams and tool metadata; an existing mirror stream or `tool/result.meta.localAgentTiming` wins. Native request and block bounds replace mirror append bounds only when the original record supports them. Kimi reads its wire, Claude Code reads stream-json or native JSONL (`queue-operation.dequeue` and `api-request`), and Codex reads rollouts, preferring `event_msg.item_completed` identities and tool `duration` over coarse `response_item` intervals.
- Missing streams first try the native turn/step coordinate, then tool-call identity or a unique ordered text match. A shared original stream is projected onto the blocks in the current mirror message, so a split reasoning/tool message is counted once. Conflicting or ambiguous matches are ignored. Mirror-only annotations with neither a native stream nor usage stay in message history without becoming model requests.

## Alternatives considered

**Rewrite historical mirror logs.** Rejected: original records are not uniformly present, in-place migration would be partial and risky, and read-time reconstruction needs no downtime or mutation.

**Add a second timing classification in Context Lens.** Rejected: the standard stream path already expresses the required categories; a parallel calculation would drift from native Deepseek.

**Require token-level parity for every CLI.** Rejected: Claude Code and older Codex records expose only coarser intervals. Unknown time remains in `other`; no precision is invented.

**Match history only by step number.** Rejected: old mirrors insert content-only steps and can split one wire step. Coordinates alone attach valid timing to the wrong message.

## Consequences

The timing categories and aggregation semantics now match native Deepseek, while the underlying precision remains provider-specific. The earlier execution metadata and tool-exec-over-`other` rule remain necessary. Missing original records, incomplete intervals and unmatched content retain the legacy estimate. The S23 standard `tool/result.execution` proposal remains the retirement path for transitional tool metadata; no upstream host change is required by this implementation.

## Testing

Provider suites cover live stream conversion, incomplete timing, native transcript/rollout boundaries and original tool identities. Context Lens suites cover request starts, shifted steps, split streams, annotation suppression and legacy fallback. Read-only acceptance against real records recovered the Kimi child turn 49 tool union of 37.812s, preserved its model timing instead of charging it to `other`, and exercised native Claude Code and Codex history at their available granularity.
