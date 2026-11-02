# Agent Note: One mirror-step writer for the local-agent providers

Status: implemented

## Problem

Every local-agent provider mirrors its CLI's output into the member's child session with the same host events: an `assistant/message` (blocks, model stream, usage, `interrupted`), then each tool's `tool/call` + `tool/result` (interrupted placeholder, `isError`, `sourceEventSeqs`, the `localAgentTiming` meta), inside a `step/start`…`step/end`. The claude, codex and kimi packages each carried their own near-identical copy of that writer — claude twice (exec line and group folds), plus the live drivers' stream finals and the kimi orphan tool — together with three copies of the `request/header` dedupe, eight `turn/end` three-way branches, three occupancy writers, four identical `*_INTERRUPTED_TOOL_RESULT` constants and two `*StreamFromLines` helpers. The copies had drifted: claude's live path wrote one step per transcript line while its exec path wrote one step per API call, so Context Lens counted a different number of requests for the same round depending on the path; claude and codex attributed every message to the hardcoded models `claude` / `codex` while kimi wrote the model its wire observed.

## Decision

`packages/local-agent/src/mirror-step.ts`, exported from the core's package root (next to `persistChildSession`, which every provider already imports; no new subpath — the `./types` subpath is also compiled for the browser face and must stay free of runtime host imports), owns the host-shaped write:

- `MirrorBlock` — `{ kind: 'think' | 'text'; text; generation? }` or `{ kind: 'tool'; id; name; args?; result?; failed?; timing?; generation? }`. Claude and codex transcript lines are structurally `MirrorBlock`s and pass straight through; kimi maps its merged wire step.
- `MirrorSource { provider; model }` — one provider id for the message source and the tool timing meta. `model` is required: each provider resolves its own fallback label.
- `MirrorUnit { blocks; usage?; interrupted?; stream? }` — an explicit `stream` wins over the one derived from block generations (kimi's comes from the wire step's timing; its live finals and orphan tool pass `[]`).
- `appendMirrorStep` (step boundary + content), `appendMirrorContent` (content only — for steps a live driver already opened), `mirrorStreamRecords` (replaces `claudeStreamFromLines` / `codexStreamFromLines`, also used by the read-time `harness.timing` reconstruction), `mirrorAssistantMessage`, `appendRequestHeaderIfChanged`, `closeMirrorTurn(session, turn, stopReason, errorMessage)`, `recordContextOccupancy(session, reading, { force })` (codex forces after an auto-compaction), and the one `MIRROR_INTERRUPTED_TOOL_RESULT`.

What stays in each provider: stream parsing and timing capture, grouping (claude by message id, codex by item, kimi by wire step), step-coordinate allocation (kimi reservations, `nextWrittenKimiStep`), hold rules, usage carriers, and the dsh provider's verbatim copy. `local-agent-dsh` only aliases `DSH_INTERRUPTED_TOOL_RESULT` to the shared constant; its live path and `local-agent-dsh-headless` are untouched.

Two deliberate behavior changes ride the migration:

- **Claude live groups by API call.** A stream records its call (the open `message_start` id); the call's first stream opens the step, its later streams join it (a publisher sub-item, or a durable snapshot carrying every opened block of the call); `mirrorUpTo` folds whole calls once the call ended and every tool resolved, writing one message with all blocks and the call's final usage once; leftover streams finalize per call at settle. Lines without a message id keep their one-step shape.
- **`source.model` is the observed model.** Claude: the round's init-event model, else the requested model, else `claude`. Codex (its stream never names a model): the requested model (exec argv, live `configuration.model`, else the runtime's spawn-bound model), else `codex`. Kimi: unchanged (wire model or the runtime's current model, else `unobserved`).

Zombies removed with proof by `git grep` across `packages/` (no caller outside tests): the drivers' `setLiveMirrorGranularity` no-ops and ignored `liveMirrorGranularity` driver option, claude/codex `persistIfStandalone`, codex `appendCodexLine`, kimi `mirrorKimiSession`, the claude live driver's optional `recordRoundSettled` probe, and the per-provider placeholder constants, `assistantEvent` / `codexAssistantEvent`, request-header writers and occupancy helpers. The `liveMirrorGranularity` **settings key** stays: existing profiles carry it and the reference docs promise it is accepted and ignored.

## Testing

Before the refactor, snapshot specs locked one fixed CLI input per path to the exact child-session event sequence (types, data, append options, `seq`; the clock frozen through a fake `Date`, random message ids normalized): claude exec and live (completed with live streams, cancelled on the durable-snapshot path), codex exec and live (same pair), kimi wire fold at settle and a cancelled live round (from-live-text finals plus an ACP-only orphan tool). Every migration commit passed them unchanged; the two behavior changes updated them in their own commits (model: only `source.model` moved; claude live: four steps became two). `packages/local-agent/tests/mirror-step.spec.ts` covers the writer directly.

## Alternatives considered

**A `./mirror` subpath or the `./types` subpath.** `./types` is compiled into the client face too, and the writer imports host runtime (`createAssistantMessage`, `createToolResultMessage`); a new subpath would add an export, a gen-typert surface and a build entry for something every provider reaches through the root already.

**Optional `MirrorSource.model` with a core default.** The fallbacks differ per provider (`claude`, `codex`, `unobserved`); a core default would either be wrong for two of them or hide a provider-specific choice in the core.

**Keeping per-provider wrappers (`appendClaudeTranscriptLine`, `appendCodexTranscriptLine`).** Claude's per-line wrapper is gone (the live path now folds calls); `appendClaudeTranscriptGroup` and `appendCodexTranscriptLine` survive as one-line adapters because they own a provider decision (the per-call usage carrier, the model) and the specs drive them directly.

**Grouping claude live only at fold time, previewing everything until then.** Simpler, but a call's step would no longer open while it streams, so the live checkpoints (`local-agent/stream`) that make a partial survive a crash would wait for the whole call; joining the call's open step keeps them.

**Deleting the `liveMirrorGranularity` settings key.** Existing profiles and the documented migration note carry it; removing it from the schema could break profile validation for no runtime gain.

## Consequences

Across the three provider packages' sources the change removes about 790 lines and adds about 380 (most of the addition is the claude live call ledger), and a change to the mirrored event shape (a new field on `assistant/message`, the timing meta, the placeholder text) is one edit in the core. Context Lens now counts one request per claude API call on both paths, and the read-time `harness.timing` reconstruction (which already keyed claude steps by call group) matches live child logs. Claude/codex messages name a real model when one is known.

Costs: a claude live call's step stays open from its first streamed block until its last tool result, so the call's blocks are written once at the end of the call instead of block by block (the live preview and checkpoints still show them as they stream); a cut-off call's single message is marked `interrupted` as a whole even when its earlier blocks completed. The codex "observed" model is the requested one — codex reports the model it actually ran only in its rollout file at settle, too late for the live writes. The snapshot specs pin exact event sequences, so any deliberate shape change must update them visibly.
