# Agent Note: local-agent-kimi live driver — resident kimi acp (live-driver M3)

Status: implemented

[English](2026-08-22-local-agent-kimi-live-driver.md) | 中文

## Problem

The `kimi-cli` provider drives every delegation round as a fresh `kimi -p`
process: no graceful interrupt (SIGTERM/SIGKILL only) and a mirror that polls
the session's wire.jsonl every 2s. The
[live-driver proposal](../../../../proposals/active/2026-08-20-local-agent-live-driver.md)
schedules kimi third (M3), driven over `kimi acp` — the vendor's Agent Client
Protocol server — with the harness `subagent-acp` package as the reference
implementation. M1 ([dsh](2026-08-22-local-agent-dsh-live-driver.md)) and M2
([codex](2026-08-22-local-agent-codex-live-driver.md)) set the lifecycle
discipline this driver reuses.

## Decision

`live: true` on `@khorsheed/dsh-local-agent-kimi` switches delegation rounds
to one resident `kimi acp` process per member, without touching the facade,
delegation records, resume lock, or member channel contracts.

**Channel**: ACP over stdio, probed against the installed kimi 0.36.1:
`initialize` advertises `loadSession: true` (crash recovery), `session/new
{cwd, mcpServers}` mints the server-assigned session id (the delegation
record's `cliSessionId`, far earlier than exec's settle-time stderr parse),
`session/load {sessionId, cwd, mcpServers}` reattaches after a crash,
`session/prompt` is a turn-length request resolving with the ACP stop reason
(mapped: end_turn→completed, max_tokens→max-tokens, refusal→refusal,
cancelled→aborted, anything else→error — the harness reference's table),
`session/cancel` is the graceful interrupt, and stdin EOF quiesces the server
(reclaim ladder). The handshake REQUIRES `loadSession`; without it the
breaker trips and rounds fall back to exec, because a live mode without crash
recovery is not the live mode. The wire adapter is self-contained (no
`@agentclientprotocol/sdk` dependency): StringDecoder framing, request
correlation, server→client request answering.

**Mirroring deliberately stays file-folded.** kimi's ACP `session/update`
notifications are token-level chunks, NOT the wire.jsonl line fold the exec
mirror owns — and the ACP runtime writes the same wire.jsonl in the same
scoped home (session-view.ts documents this). So pushes only TRIGGER
throttled `mirrorKimiDelta` passes (the exec path's exact offset bookkeeping
via `kimiMirroredLines`), the settle pass stays authoritative, and the two
drivers cannot diverge. `liveMirrorGranularity: 'token'` additionally appends
`assistant/chunk` deltas straight from the chunks (never counted into the
fold offset); the run output accumulates from `agent_message_chunk` text.

**Round correlation**: one member per process and one session per runtime,
plus a per-session turn chain — a cancelled turn's `session/prompt` must
settle (cancelled) before the next round's prompt goes out, so the
stop-then-rephrase gesture cannot interleave two turns' chunk streams (ACP
updates carry no turn id, so serialization is the correlation). Whole rounds
of one member are additionally serialized in the driver (the facade's resume
lock covers resume-vs-resume only).

**Review round (2026-08-23)**: an `end_turn` with no accumulated answer is
now an error, never a silent success (the exec path's empty-output guard);
auth-shaped failures (session errors like Authentication required, or a
mid-run 401 surfacing as a settled error) are reported to the family
registry's auth-failure mark, porting the exec path's post-exit detection to
a process that never exits (duck-typed — older cores skip the mark); and the
two shared fixes — compare-then-delete in the runtime registry's onDead and
per-member round serialization — landed here as in all four drivers.

**Permissions**: `session/request_permission` selects the first
allow_once/allow_always option (cancelled when none) — matching `kimi -p`'s
auto-approve behavior, the proposal's default policy.

**Lifecycle**: M1/M2's discipline verbatim — lazy spawn + handshake, spawn
dedupe per member, idle reclaim (`liveIdleMs`, default 30 min; stdin EOF →
grace → SIGTERM ladder), crash re-spawn with `session/load`, breaker with
5-minute cooldown, `disposeAll` aborting in-flight spawns, cancel honored in
every window (abort listener before any await; the handshake races the abort
signal; a caller-cancelled handshake never trips the breaker; a cancelled
round whose session was never created reclaims the fresh runtime).

## Alternatives considered

- **Depending on `@agentclientprotocol/sdk`** — rejected: the harness
  reference uses it, but the peer is ~100 lines of family-owned code in
  M1/M2's style; a new dependency for a live-only path would land on every
  install. The SDK can replace the peer later without a contract change.
- **Mirroring ACP chunks directly into the child session (push-fold)** —
  rejected: chunks are not isomorphic to the wire.jsonl line fold (tool
  call/result pairing, system-reminder filtering, per-request usage records
  all live in the file fold), so a push-fold would be a SECOND fold to keep
  in lockstep — exactly the divergence the member-state collaboration
  protocol forbids changing unilaterally. Triggered passes over the shared
  file fold keep one source of truth.
- **`session/resume` over `session/load`** — rejected for now: kimi 0.36.1
  advertises both (`loadSession: true` and `sessionCapabilities.resume`), and
  `load` is the classic ACP path the harness ecosystem probes first; the
  handshake gate checks the `loadSession` flag we actually use.
- **Multi-session processes** — rejected: the member bridge token and the
  member's ACP session pin to one process; per-member processes keep M1/M2's
  lifecycle identical.

## Consequences

- `live: true` buys runtime-level graceful cancel (process survives, session
  continuable) and push-triggered mirroring with no 2s polling; default off —
  the exec path is untouched and its tests run unchanged.
- The fold layer's interface did not change at all for kimi: the driver calls
  the existing `mirrorKimiDelta` (now exported) with the same offset
  semantics; there is no new transport-side fold entry to review — the
  member-state partner should confirm the trigger cadence instead.
- ACP's turn-length `session/prompt` has no accept ack, so the turn boundary
  opens before the prompt goes out; a hard prompt failure closes the round as
  error with a boundary the sub-side may lack — the same narrow class exec
  already has (spawn-time boundary, pre-work crash).
- Real-boot probe against kimi 0.36.1 verified: initialize with the full
  capability surface, unauthenticated `session/new` fails cleanly
  (Authentication required), stdin EOF exits 0. A full credentialed
  delegation round is 3080 acceptance work.

## Testing

- `tests/live-driver.spec.ts`: stop-reason mapping, fresh/resume round
  settlement, session reuse across rounds, crash re-spawn with
  `session/load`, cancel via `session/cancel` with process survival,
  stop-then-rephrase prompt serialization, permission auto-answers, token
  granularity, session/new failure hygiene (no dangling boundary, no breaker
  trip), idle reclaim, cancel-during-handshake, the loadSession breaker gate,
  `disposeAll` zombie accounting, provider dispatch (delegation recorded with
  the ACP session id), and the exec fallback.
- The settle-reconciliation test drives a real wire.jsonl fixture through the
  exec path's own `mirrorKimiDelta` and offset bookkeeping.

## Related

- [dsh live driver (M1)](2026-08-22-local-agent-dsh-live-driver.md) and
  [codex live driver (M2)](2026-08-22-local-agent-codex-live-driver.md) — the
  lifecycle discipline and cancel-window design this driver reuses.
