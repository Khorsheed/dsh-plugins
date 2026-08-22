# Agent Note: local-agent-codex live driver — resident codex app-server (live-driver M2)

Status: implemented

[English](2026-08-22-local-agent-codex-live-driver.md) | 中文

## Problem

The `codex-local` provider drives every delegation round as a fresh
`codex exec` process: no graceful interrupt (SIGTERM/SIGKILL only), no mid-run
steering, and mirroring folds a polled stdout NDJSON stream. The
[live-driver proposal](../../../../proposals/active/2026-08-20-local-agent-live-driver.md)
schedules codex second (M2), driven over `codex app-server --stdio` — the
vendor's experimental JSON-RPC runtime channel — with the harness
`subagent-codex` package as the reference implementation. M1's
[dsh live driver](2026-08-22-local-agent-dsh-live-driver.md) set the
lifecycle discipline this driver reuses.

## Decision

`live: true` on `@khorsheed/dsh-local-agent-codex` switches delegation rounds
to one resident app-server process per member, without touching the facade,
delegation records, resume lock, or member channel contracts.

**Channel**: `codex app-server --stdio` (per-member process — the member
bridge's per-process `-c` TOML override and the scoped `CODEX_HOME` both pin
to one member, so the app-server's multi-thread capability is deliberately
unused). The wire adapter (`src/live-driver.ts`'s `CodexWirePeer`) is
self-contained — line framing with a StringDecoder for split UTF-8 tails,
request correlation, and server→client request answering — following M1's
no-new-dependency choice. Protocol facts were probed mechanically against the
installed codex-cli 0.144.0 (`app-server generate-json-schema`): `initialize`
→ `thread/start {cwd, ephemeral: false, approvalPolicy: 'never', sandbox}` (a
persisted thread, so crash recovery can `thread/resume {threadId}`) →
`turn/start {threadId, input}` → notifications `turn/started`,
`item/completed`, `item/agentMessage/delta`, `item/reasoning/textDelta`,
`thread/tokenUsage/updated`, `turn/completed {status:
completed|interrupted|failed}`; `turn/interrupt {threadId, turnId}` for
graceful cancel; no shutdown method exists, so reclaim is stdin EOF → grace →
the SIGTERM ladder.

**Fold**: app-server `item/completed` ThreadItems map onto the exec fold's
`CodexTranscriptLine` via `codexAppServerItemToLine` (reasoning → think,
agentMessage → text, commandExecution → Bash tool with aggregated output,
webSearch/mcpToolCall/plan → tool/think lines), appended through the same
`appendCodexTranscriptLine` core with the same hold-back rule (the volatile
last line waits for `turn/completed`, which carries the round's usage from
`thread/tokenUsage/updated`). The prompt lands as `user/message` when the
turn opens. Token granularity (`liveMirrorGranularity: 'token'`) additionally
appends `assistant/chunk` deltas per streaming item. Final-answer selection
follows the harness wire: `final_answer` phase beats unphased; commentary is
dropped from output selection.

**Approvals**: server→client approval/elicitation requests are auto-answered
unattended (cancel-preferred decline, empty permission grant, empty answers,
elicit decline — the harness reference's tables), matching exec behavior and
the proposal's default policy; the human-approval relay hook stays a later
increment.

**Round correlation**: turn ids are server-assigned, so rounds correlate by
turn id, not a caller round number — a round accepts only notifications for
its own turn id (observed early via `turn/started` while the accept ack is in
flight), retired turn ids tag out a cancelled turn's late unwind (the
stop-then-rephrase gesture), and settlement clears the round's sink. The
parent-side `turn/start` boundary opens only after the accept ack, so a
definitive reject leaves no dangling boundary. Rounds of one member are
additionally serialized in the driver (the facade's resume lock covers
resume-vs-resume only; a resume racing an in-flight fresh round would
overwrite the runtime's single notification sink).

**Review round (2026-08-23)**: the accept-window cancel now uses the early
`turn/started` turn id when the response has not landed (the turn/interrupt
can no longer be skipped mid-accept); an aborted or failed round flushes its
held-back lines with the usage already observed (the exec settle-mirror's
partial-work contract — M2's initial no-reconciliation choice dropped them);
auth-shaped failures (401-class messages) are reported to the family
registry's auth-failure mark, porting the exec path's post-exit detection to
a process that never exits (duck-typed — older cores skip the mark); the
endpoint info log moved before the drive-mode branch so live rounds report
it; and the runtime registry's onDead delete is compare-then-delete (a
crash-then-respawn interleave can no longer evict the new runtime's entry —
the same two fixes landed across all four live drivers).

**Lifecycle** (M1's discipline verbatim): lazy spawn + initialize handshake,
one in-flight spawn per member, idle reclaim (`liveIdleMs`, default 30 min),
crash re-spawn with `thread/resume` of the delegation record's thread id, a
channel breaker with 5-minute cooldown (per-round exec fallback), `disposeAll`
aborting and waiting out in-flight spawns on unload, and cancel honored in
every window (abort listener before any await; the handshake races the abort
signal; a caller-cancelled handshake never trips the breaker).

**Delegation identity**: unlike dsh, the thread id is server-assigned; the
fresh round records the delegation (`cliSessionId = thread id`) at
`thread/start` response time — earlier than exec's settle-time stdout parse.

## Alternatives considered

- **Depending on `@deepseek-ai/dsh-sdk-protocol`'s `JsonRpcLineTransport`** —
  rejected: the transport is ~80 lines of family-owned code in M1's style,
  and the published `0.0.1-rc.1` line would pin a young official package into
  every install for a live-only code path; self-contained keeps the exec
  users untouched.
- **One shared app-server process for all codex members** — rejected: the
  member bridge config is a per-process `-c` override carrying one member's
  token, and `CODEX_HOME` is scoped per member; per-member processes keep
  both correct by construction. The wire addresses threads by id, so sharing
  later is an optimization, not a redesign.
- **Reconciling mirrors from the rollout files on disk** — rejected for M2:
  the app-server pipe delivers each event exactly once in order, and the
  hold-back flush at `turn/completed` closes the round; rollout-file parsing
  would be a second fold to maintain against an undocumented file format.
- **Mapping `approvalPolicy` from the provider's `sandbox` config into an
  on-request mode** — rejected: unattended delegation must not prompt; the
  exec mode's effective policy is never-ask, so threads run
  `approvalPolicy: 'never'` + the configured sandbox.

## Consequences

- `live: true` buys runtime-level graceful interrupt (process survives, thread
  continuable) and push-mode mirroring with no stdout polling; default off —
  the exec path is untouched and its tests run unchanged.
- The fold contract is unchanged: `CodexTranscriptLine` +
  `appendCodexTranscriptLine` are shared verbatim; the app-server item mapper
  is a new transport-side entry point for the member-state partner to review.
- The app-server wire is explicitly experimental upstream; protocol drift is
  pinned by the driver tests plus the schema probe method (`generate-json-schema`),
  and the breaker + exec fallback contain a broken channel.
- A turn that fails mid-flight in a way that drops `turn/completed` would hang
  the round until reclaim — mitigated by the interrupt/converge ladder and the
  process-death watch; no separate round watchdog exists (accepted, same as
  exec's reliance on process exit).
- Real-boot smoke against codex-cli 0.144.0 verified: initialize handshake,
  persisted `thread/start`, `turn/start` accept, `turn/interrupt` closing the
  turn as `interrupted`, and clean exit on stdin EOF. A full credentialed
  delegation round is 3080 acceptance work.

## Testing

- `tests/live-driver.spec.ts`: the item→line fold mapping, fresh/resume round
  settlement, thread reuse across rounds, crash re-spawn with `thread/resume`,
  interrupt with thread/turn ids, failed/interrupted terminal mapping,
  stop-then-rephrase turn-id tagging, unattended approval auto-answers, token
  granularity, idle reclaim, cancel-during-handshake, `disposeAll` zombie
  accounting, provider dispatch, and the exec fallback on handshake failure.
- Real-boot smoke: the real `codex app-server --stdio` over a scoped
  `CODEX_HOME` (handshake, thread, turn, interrupt, EOF exit 0).

## Related

- [dsh live driver (M1)](2026-08-22-local-agent-dsh-live-driver.md) — the
  lifecycle discipline and cancel-window design this driver reuses.
