# Agent Note: the 3080 disappearing side-chat message — unrouted agents and the silent pre-journal turn death

Status: implemented

English | [中文](2026-09-17-side-chat-agent-options.zh.md)

## Problem

On 3080, sending a message in the side chat made it **disappear permanently**: the composer cleared, no user row ever landed, no error showed, and the conversation never happened. The chat was unusable, and the UI gave the user every sign of success.

The mechanism, traced in the host source: `SideChatService.spawnAgent` called `ctx.agents.create`/`ctx.agents.resume` **without `agentOptions`** (provider/model). The agent loop's `prepareRequest` (`packages/core/agent-loop/src/agent.ts`) throws `agent has no provider/model` when the seed route is empty, and `step()` runs `prepareRequest` BEFORE `session.append('user/message')` — so the turn died before the message ever reached the journal, closing with `turn/end` kind `error` while the agent returned to idle. The client's success path cleared the composer and rendered the projection (which, faithfully, contained no user row). Message gone, error invisible. The control cases confirm the contract: webhook and sdk/server pass provider/model explicitly at agent creation; `api/session-controller` uses `ctx.agentDefaultModel.currentSelection()`.

A second-order gap made it worse: even if the turn error had been projected, nothing in the UI would have shown it, and between a send and the next 1.2s poll there was a window in which a HEALTHY send also looked lost.

## Decision

**Every create and resume now carries `agentOptions`, resolved by inheritance, never by inject.** `agentOptionsOf(calling)` builds the route from (1) the CALLING session's folded request header — `calling.session.requestHeader()?.config` → `{ provider, model, reasoningEffort? }`, so the side chat talks to the same model as the conversation it hangs off — then (2) the probed `agentDefaultModel` face (`ctx.get('agentDefaultModel')` → `currentSelection()`, the session-controller's own fallback, probe-with-degrade per repo convention), then (3) nothing at all — in which case the turn's failure is at least VISIBLE now (below). Resume gets the same options: a cold resume rebuilds the agent world with no logged header yet, so the seed route comes from the options alone.

**Turn errors project.** `projectTurnError` folds `turn/end` closers: an error-ended turn contributes its `reason.error.message`, and the first non-error `turn/end` after it clears the slate (aborted/blocked/max-tokens/interrupted all read as clean). `SideChatState.lastError` carries it over the wire, and the panel renders a dismissible error bar under the header — a turn that fails before its message lands no longer impersonates success. (The dismissed bar re-raises only on a NEW error text.)

**Sends echo optimistically.** The doSend success path appends `{ kind: 'user', text, refs: <pending refs>, time: Date.now() }` locally when the returned state's transcript does not already end with the same user text — closing the 1.2s poll window in which even a healthy send looked lost. The next poll replaces the whole state, so no dedupe logic is needed.

No data repair: the "lost" messages were always in the durable inbox (`agent/inbox/spliced` had already landed), so the next turn after this fix claims them automatically.

## Alternatives considered

### Why not require the model route in plugin config instead of inheritance?

A configured route goes stale the moment the user switches models in the conversation, and it makes the side chat answer with a DIFFERENT model than the conversation it is attached to — surprising in exactly the way this plugin exists to avoid. Inheritance follows the user's own current route; the deployment default is only the fallback for a calling session without a header (e.g. a fresh conversation before its first turn).

### Why not surface the turn error only via status (e.g. a red status dot) instead of a bar?

The failing turn carries a specific, actionable message (`agent has no provider/model`, a provider outage, a rate limit) that a status adjective would hide. The error bar shows the message itself, dismissible, self-clearing on the next clean turn — the minimal honest escalation from "silent".

### Why not retry the send automatically after fixing the route?

The durable inbox already IS the retry: with the route present, the loop's next turn claims the queued message by itself (the task note's own observation, verified against the loop's inbox splice). A plugin-level replay would double-send on exactly the path the inbox already covers.

## Consequences

- `src/service.ts`: `agentOptionsOf` + `AgentDefaultModelProbe`; `spawnAgent` passes `agentOptions` to BOTH `agents.create` and `agents.resume` (conditional-spread, absent when unresolvable). `stateOf` wires `lastError` for live and cold reads.
- `src/journal.ts`: `projectTurnError` (turn/end fold). `src/types.ts`: `SideChatState.lastError` (wire-additive).
- `src/client/SideChatPanel.tsx`: the dismissible turn-error bar (+ `errorBar*` styles, `error.dismiss` locale key in both dictionaries); the optimistic send echo with the pending refs attached.
- `package.json` 0.2.1 → 0.2.2 (bugfix line); `docs/packages.md` regenerated. No dependency changes, no API-signature changes.
- Debugging note, for the next inheritance of this kind: the first attempt read `calling?.session.requestHeader()?.config`, which throws a bare TypeError on any session-shaped object lacking the method (every test fake) — optional-call needs the method itself guarded (`requestHeader?.()?.config`), and the 12 cascading spec failures were the cheapest possible place to learn it.

## Testing

- `packages/sidechat`: **74 tests green** (was 63): `tests/service.spec.ts` (+5 — create inherits the calling header's route incl. reasoningEffort, fallback to the probed agentDefaultModel, header preferred over the default, no agentOptions when neither exists, resume carries the route too), `tests/journal.spec.ts` (+3 — latest error message, clearing on the next clean turn/end, non-error closers read clean), `tests/client.spec.tsx` (+3 — optimistic echo appended when the wire answer lacks it, no double row when it echoes, the error bar renders and dismisses).
- `pnpm --filter @khorsheed/dsh-sidechat build` (gen-typert → tsc → tsdown), `pnpm check:hygiene -- packages/sidechat`, `pnpm check:plugins`, `pnpm check:packages` are green.
- NOT done: a live 3080 re-walk of the original repro (the mechanism chain — options passed on both paths, error projection, optimistic echo — is spec-covered; the model actually answering on a real route is the deploy walk's business).

## Deferred

- None specific to this fix. The previously recorded upstream candidates (plugin-authored forwarded Remote events, the user-message action seat, the transcript-selection quote seam, hidden/folded session presentation) remain open and unaffected.

## Related

- [side-chat M1](../feature/2026-09-16-side-chat-m1.md) (the lazy create/resume lifecycle this fix threads the route through).
- [side-chat M3](../feature/2026-09-16-side-chat-m3.md) (the surfacing milestone; the error bar reuses its panel).
