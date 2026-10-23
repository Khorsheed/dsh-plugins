# Agent Note: External-agent child sessions log request/header with the request's real config

Status: implemented

## Problem

Context Lens's config card for an external-agent (kimi / claude-code / codex) child session showed 未记录 for everything: the requests run inside the member's own CLI, so the child session log carried no `request/header` events and the lane's fallback read only `provider`/`model` from the message source. The natural read — "the upstream never sends it, so it can't be shown" — turned out wrong on inspection:

- kimi's wire declares the full config per request: every `llm.request` event carries `model`, `thinkingEffort`, `maxTokens` (verified on the real fixture).
- claude-code's wire carries the model (init/result events) but never effort or maxTokens; the effort's authoritative fact is the `CLAUDE_CODE_EFFORT_LEVEL` env the PROVIDER itself sets at spawn.
- codex's stream carries neither; the authoritative facts are the provider's own launch parameters (exec argv `-m` / `-c model_reasoning_effort=…`, live `turn/start`'s `{model, effort}`).

The parameters we set ourselves are facts we can record without inventing anything.

## Decision

Each external-agent child session now logs the host-native `request/header` event (`header.config`: `provider` + `model`, plus `reasoningEffort` / `maxTokens` when known), so Context Lens's log lane reads the child config exactly like a main session's.

- **kimi** (`session-view.ts` + `session-mirror.ts`): the transcript reader snapshots each `llm.request`'s declared config onto the lines it accounts for; the wire-step fold writes the header in the wire's own words.
- **claude-code**: the exec live-mirror writes it at the first fold from the init event's observed model (falling back to the launch `--model`) plus the spawn-time effort env; the live driver writes it at turn open from the session configuration.
- **codex**: exec writes at turn open from the spawn argv; live writes at turn open from the `turn/start` request parameters.
- Everywhere: write-on-change — the first header is `initial`, a differing one `change`, an identical config is skipped (the host logs changed snapshots, not per-call duplicates). The header contract requires provider AND model: a round whose model is genuinely unknown records nothing rather than inventing one.
- The messages' `source.provider/model` placeholders (`claude`, `codex`) stay as they are this round; making them the observed model is a separate cleanup the header lands first.

## Alternatives considered

- **「上游没给」不做**:wrong for kimi (the wire declares everything) and defeatist for claude/codex (the launch parameters are our own facts). Recorded so the next reader doesn't re-learn it wire by wire.
- **Write `reasoningEffort` without `model`**: the session format's `LlmCallConfig` requires `model` (and the relationships validator requires `provider`), so a partial header is not a legal one — rounds without a known model skip the write instead of bending the contract.
- **A shared family helper**: the three packages are independent by rule; the write-on-change helper is fifteen lines duplicated per package, cheaper than a cross-package edge.

## Consequences

- New child sessions show provider/model/思考强度/输出上限 in Context Lens with real values. Old logs are unchanged (they carry no headers; the lens's source fallback still covers them).
- kimi headers are per wire step (its config can genuinely change per request); claude/codex headers are per round (their config is fixed at launch). A config change mid-session logs a `change` header and the lane tracks it.
- Reading semantics, stated for consumers: **a round without a header means "unchanged from the previous header"; a session without any header means unrecorded.** The residual ambiguity (a round whose model changed but was not observed reads as the previous config) needs a prior known header AND an unknown-model round AND an unobserved switch to misfire — family members pin a default model, so the window is accepted, not widened by a contract-bending placeholder header.
- `reasoningEffort` values cross the session boundary as the branded `ReasoningEffortId`; the cast happens at the extraction point (wire words / launch config), never re-validated downstream.

## Testing

`pnpm --filter @khorsheed/dsh-local-agent-kimi test` (284), `--filter @khorsheed/dsh-local-agent-claude-code test` (262), `--filter @khorsheed/dsh-local-agent-codex test` (247): the kimi wire-step fold spec asserts the header event and its `initial` reason; the claude/codex exec settle specs assert the launch-fact header. All run the released-log validator over logs that now contain `request/header`.
