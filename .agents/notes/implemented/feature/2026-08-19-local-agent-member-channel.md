# Agent Note: local-agent member channel — gateway remotes + writable member composer (M1+M2)

Status: implemented

English | [中文](2026-08-19-local-agent-member-channel.zh.md)

## Problem

A family CLI member's dsh child session was read-only: the official composer pipeline rejects every send path for a one-shot subagent session, and ui-subagent's chain entry (`conversation.composer`, priority -10) renders a static read-only panel for it. The [member-channel proposal](../../../proposals/closed/2026-08-19-local-agent-member-channel.md) turns the member session into a two-way channel: a human opening the member session gets a writable composer whose send continues the SAME CLI session (facade resume), with Stop for the in-flight run — without touching the host. This is milestones M1 (channel) and M2 (composer) of that proposal.

## Decision

**M1 — channel (`packages/local-agent` host side).** Three new remotes on `LocalAgentGateway` plus one registry accessor:

- `LocalAgentRegistry.getDelegation(childSessionId)` — a read-only, never-throwing lookup over the existing `delegations` map. Unlike `resolveDelegation` it performs no ownership assertion: the human opened the real child session, so the record itself is the authorization source, and there is no model-forged handle surface (the resume handle never enters the prompt text).
- `memberOf(childSessionId)` — the composer's membership check: the delegation view `{ childSessionId, provider, parentSessionId, harnessDisplayName? }` or null. The CLI-session resume handle (`cliSessionId`) deliberately stays off the wire.
- `promptMember(childSessionId, text)` — composes `getDelegation` with the unchanged facade `resume(record.parentSessionId, record.provider, childSessionId, [{ type: 'text', text }])`. Every facade failure (unknown member, parent not live, resume locked, …) maps to a structured `{ ok: false, error }` — raw exceptions never cross the wire — so the composer renders the reason inline (v1: fail loud, "open the parent session first").
- `stopMember(childSessionId)` — straight to the facade `cancel`, returning the boolean.

The wire types (`LocalAgentDelegationView`, `LocalAgentPromptResult`) live in `src/types.ts`, the public non-root subpath the typert wire-schema generator requires; the generated `lib/typert.remote-client.d.ts` picks the methods up on the next build.

**M2 — composer (`packages/local-agent` client side).** A chain entry on `conversation.composer`:

- **Two-stage membership check** — a direct consequence of the chain-slot contract that a selector must be a PURE function of the owner props. `selectCliMember` coarse-filters on the session snapshot only: `session.subagent?.address.mode === 'one-shot'` elects, carrying `{ childSessionId }`. Wide on purpose: the elected `MemberComposer` then queries `memberOf`, and a session the family never delegated renders the same read-only panel the official takeover shows (visually aligned with ui-subagent's `SubagentReadOnlyComposer`, same tokens and metrics) — never a writable box for a non-member session.
- **Priority -20 election** — ui-subagent's read-only takeover sits at -10 and chain election is ascending, first non-null wins, so the member selector runs first. Electing first is safe because the degraded branch renders exactly what the takeover would have.
- **Writable composer** — textarea + send + stop, styled after `InputBar`'s skin (same card/input/primary tokens) but with its own state: the draft is local state, send calls `promptMember` (NEVER `inputActions.submit()`), structured errors render inline, and while the member run is in flight (the session's own `running` flag, driven by the mirrored transcript events) the input is disabled and Send swaps to Stop (→ `stopMember`). The official input machine is deliberately not wired: `InputBar`'s send path is hardwired to the host prompt pipeline (`inputActions.submit()` plus the machine's adjudication), and its disable judgment belongs to that machine — the skin can be copied, the shell cannot be wrapped.
- Copy lives in the plugin's own `local-agent` locale namespace (zh source of truth, en mirrored).

## Alternatives considered

- **Wrapping or reusing the official `InputBar`** — rejected: its send path is hardwired to `inputActions.submit()` on the official input machine, and the official pipeline rejects one-shot subagent sends at every layer (client-local `subagent-not-resumable`, the host subagent-lineage fence). Only the visual skin transfers.
- **Implementing the official `prepareContinuable` so members become continuable sessions** — rejected (proposal §0, verified against harness source): the continuation manager drives an in-process dsh Agent for the follow-up, discarding the CLI's scoped home, credentials, and session chain. The family seam (facade resume) is the only path that continues the real CLI session.
- **Tightening the selector with a membership probe** — impossible by contract: chain selectors are pure and synchronous; an async registry lookup cannot live there. The two-stage check (pure coarse filter, component-time confirmation with read-only degradation) is the consequence, not a choice.
- **A `resume`-specific registry method bundling record lookup + resume for the gateway** — rejected as redundant surface: the gateway composes the existing `getDelegation` + `resume`, and ownership semantics stay in exactly one place (the facade).
- **Returning the full delegation record from `memberOf`** — rejected: `cliSessionId` is the resume handle and never belongs on the wire; the view projects exactly what the composer needs.

## Consequences

- Any family delegation (room member or main-agent tool delegation) gets the writable composer with zero room changes; a human's message continues the same CLI session in the same dsh child session, and the transcript mirror lands it as `user/message` — the composer writes no message events itself, avoiding doubles.
- A one-shot session the family never delegated (selector false positive) shows the official-looking read-only panel; the misprediction surface degrades safely by construction.
- A future official entry with priority below -20 would reorder the election — visible but safe (the chain falls through to this entry, then the read-only takeover).
- The composer copies `InputBar`'s skin, so an official input redesign must be followed by hand — accepted, same maintenance class as message-tools shadowing the official renderer.
- Parent-offline sends fail loud with the facade's error text; cold-starting the parent agent loop stays future work.
- Member-to-member notification (the duck-typed `room.receiveMemberMessage` probe edge, the bridge MCP server, and the per-run token) was reserved for M3 at this note's writing and has since landed — see the [member-notification note](2026-08-19-local-agent-member-notification.md); the local-agent → room edge stays duck-typed, so `check-plugin-independence` needs no sanction.
- **Correction (2026-08-20): the stats line does NOT survive election.** The M2 plan assumed the official `StatsLine` rides the `conversation.composer.dock` list slot independently of the composer chain; real-world feedback showed the dock is passed as the fallback InputBar's `footer` prop (harness `ConversationRoot.tsx:154-156`), and with `overlay: true` an elected entry hides the whole fallback — member sessions showed no stats line. The proposal's documented fallback is now the shipped path: MemberComposer self-renders a compact stats dock BELOW the writable card (a separate centered strip with the official StatsLine metrics: chat-content width, centered, 12/20 tertiary) from the `tokenUsage` projection (cache-hit share over the three billing buckets + compact input/output totals; the line drops out whole when the session has no token activity, and shows the last settled usage while a run is in flight). The degraded read-only branch deliberately stays visually identical to the official panel — no stats there. Turn/step counts and timing groups are dsh-agent concepts and stay out for CLI members.

## Testing

`packages/local-agent/tests/gateway.spec.ts` gains a member-channel suite (7 tests): `memberOf` hit/miss; `promptMember` full path against a fake subagents provider (facade resume receives the record's parent/provider, the prompt carries only the human text and never the CLI-session handle), structured errors for an unknown child, a parent without a live agent, and an in-flight resume; `stopMember` hit/miss with the abort signal observed. `packages/local-agent/tests/member-composer.client.spec.tsx` (14 tests): selector purity (one-shot elects / continuable declines / plain or absent session declines), read-only degradation when `memberOf` returns null, send calls `promptMember` with the child id and trimmed text and clears the draft, the structured error and RPC-failure fallback render inline, a running member disables input and routes Stop to `stopMember`, and the stats line: hidden with no usage, cache-hit percent over the three billing buckets, compact token formatting, and absent on the degraded read-only branch. Suites: local-agent 138/138, local-agent-tool-subagent 10/10.

## Cross-references

- [Member-channel proposal](../../../proposals/closed/2026-08-19-local-agent-member-channel.md) — the milestone plan this implements (M1+M2).
- [Delegation facade](2026-08-18-local-agent-delegation-facade.md) — the resume/cancel facade the gateway composes.
- [Run progress](2026-08-19-local-agent-run-progress.md) — the progress channel the composer's running state will consume (M3 live mirror).
- **Correction (2026-08-23): pending interactions must decline the election.** The official `ApprovalPanel` (question/approval popups) is itself a `conversation.composer` chain entry at priority 1; this entry elects at -20 and would shadow it — a pending ask-user-question in a member session could never render. `selectCliMember` now returns null whenever `owner.interactions` is non-empty, letting the interaction UI elect. General rule for takeover composers, now pinned by a test: interactions pending → decline; run Stop → own it (member: `stopMember`).
