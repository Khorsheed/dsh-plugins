# Agent Note: local-agent-claude-code live driver — resident stream-json process (live-driver M4)

Status: implemented

[English](2026-08-23-local-agent-claude-code-live-driver.md) | 中文

## Problem

The `claude-local` provider drives every delegation round as a fresh
`claude -p` process: no graceful interrupt (SIGTERM/SIGKILL only). The
[live-driver proposal](../../../../proposals/active/2026-08-20-local-agent-live-driver.md)
schedules claude last (M4), driven over the Agent SDK's streaming-input mode —
which is exactly the CLI's `--input-format stream-json --output-format
stream-json` realtime channel, driven here directly so no SDK dependency
lands. M1 ([dsh](2026-08-22-local-agent-dsh-live-driver.md)), M2
([codex](2026-08-22-local-agent-codex-live-driver.md)), and M3
([kimi](2026-08-22-local-agent-kimi-live-driver.md)) set the lifecycle
discipline this driver reuses.

## Decision

`live: true` on `@khorsheed/dsh-local-agent-claude-code` switches delegation
rounds to one resident stream-json process per member, without touching the
facade, delegation records, resume lock, or member channel contracts.

**Auth discipline (hard requirement).** The resident process gets exactly the
exec path's env: the scoped `CLAUDE_CONFIG_DIR`, plus `ANTHROPIC_BASE_URL`
only when the plugin config supplies it. The OAuth marker in the scoped
`.claude.json` and the keychain entry hashed to that path are precisely what
exec's one-shot processes already use; the driver never touches the user's
global `~/.claude`, never runs any `auth` verb, and every probe was done
against throwaway scoped homes. **Credential sync**: claude 2.1.236 reads
`<home>/.credentials.json` at runtime while login and the process's own
refresh write the keychain — so EVERY spawn (live `spawnRuntime` and exec
`startClaudeCliRun` alike) syncs keychain→file first, best-effort. The login
watch's sync alone cannot carry a resident runtime across rotations: access
tokens expire in 8h and refresh tokens are single-rotation, so a stale file
copy is poison for the next spawn. Coexistence risk, accepted and recorded: a
resident process and an occasional exec process sharing one scoped home each
refresh the same grant, and single-rotation can kill the other (the codex
dual-home incident's mechanism); live mode lowers the rate by reducing
process count, but sync-on-spawn is a necessary discipline, not a sufficient
guarantee.

**Channel** (all facts probed against claude 2.1.236): the first stdin `user`
message triggers `system/init` carrying the server-assigned session id (EVERY
turn emits a fresh init — the delegation records the first); each turn closes
with a `result` event (`is_error`, usage, session id); `control_request
{subtype:'interrupt'}` answers with a `control_response` success and is the
graceful runtime interrupt; a new process with `--resume <session_id>`
reattaches the on-disk session in the same mode (crash recovery); stdin EOF
quiesces the process (the reclaim ladder). There is no handshake message —
the channel proves itself with the first turn's init inside a bounded window
(timeout trips the breaker); spawn failure is the only other breaker trip.

**Fold**: the resident stream speaks the exec path's exact event vocabulary
(`system`/`assistant`/`user`/`result`), so each turn folds through the shared
`ClaudeStreamParser` with the exec live mirror's hold-back rule (the volatile
last line waits for `result`, which carries the round's usage) and appends
through the same `appendClaudeTranscriptLine` core. Token granularity spawns
with `--include-partial-messages` and maps `stream_event` partials to
`assistant/chunk`.

**Round correlation**: stream events carry no turn id, so one turn at a time
per member via a per-runtime chain — a cancelled turn's `result` must land
before the next message goes out (claude would queue the stdin frame, but its
result must never land in the next round's sink). Settlement clears the
round's event sink by identity and only once the result landed: an in-flight
turn's late result still reaches its own round's resolver, releasing the
chain (the stop-then-rephrase gesture).

**Lifecycle**: M1–M3's discipline verbatim — lazy spawn, spawn dedupe per
member, idle reclaim (`liveIdleMs`, default 30 min; stdin EOF → grace →
SIGTERM ladder), crash re-spawn with `--resume`, breaker with 5-minute
cooldown, `disposeAll` aborting in-flight spawns, cancel honored in every
window (abort listener before any await; the init wait races the abort
signal; a cancel inside the init window reclaims the never-proven runtime;
a caller cancel never trips the breaker) — and, since the 2026-08-23 review
round, compare-then-delete in the runtime registry's onDead and strict
per-member round serialization (a resume racing an in-flight fresh round can
no longer overwrite the runtime's single event sink).

## Alternatives considered

- **Depending on `@anthropic-ai/claude-agent-sdk`** — rejected: the SDK wraps
  this same CLI channel; driving it directly keeps the family pattern (no new
  dependency for a live-only path) and the wire is NDJSON in both directions.
- **Treating the per-turn `system/init` as an error** — rejected: the probe
  shows every turn re-inits with the same session id; the driver records the
  first and ignores the rest.
- **Clearing the event sink at settlement unconditionally** — rejected after
  testing: a cancelled round settles locally BEFORE its turn's result lands,
  and clearing the sink then strands the chain (the stop-then-rephrase
  deadlock the tests caught); the sink now survives until the result arrives.
- **Skipping the per-runtime turn chain because claude queues stdin** —
  rejected: claude's queue orders execution, but the queued turn's `result`
  would land in whichever sink is installed — the chain is the correlation,
  same role as kimi's.

## Consequences

- `live: true` buys runtime-level graceful interrupt (process survives,
  session continuable) with the fold unchanged — the resident stream IS the
  exec stream's shape, so no new transport-side mapper exists beyond
  `stream_event` partials (token granularity); the member-state partner has
  effectively nothing new to review on the fold side.
- claude's auth surface is untouched: same scoped config dir, same keychain
  entry, no `auth` verbs anywhere; the global home is never read.
- An interrupted turn's late events between the interrupt ack and `result`
  fold into the cancelled round (the sink survives until `result`) — matching
  exec's "partial work is preserved" contract.
- Real-boot probes (claude 2.1.236, throwaway scoped homes) verified:
  init-after-first-message, per-turn re-init, multi-turn in one process,
  interrupt control ack, `--resume` reattach, EOF quiesce. A full credentialed
  delegation round is 3080 acceptance work.

## Testing

- `tests/live-driver.spec.ts`: fresh/resume round settlement with the shared
  fold, runtime/session reuse, crash re-spawn with `--resume`, interrupt via
  the control protocol with process survival, stop-then-rephrase chain
  serialization, is_error mapping with partial-work preservation, token
  granularity (flag + chunk appends), env discipline (scoped dir, optional
  base URL, nothing else), idle reclaim, cancel-during-init reclaim, init
  timeout breaker, `disposeAll` zombie accounting, provider dispatch, and the
  exec fallback.

## Related

- [dsh (M1)](2026-08-22-local-agent-dsh-live-driver.md),
  [codex (M2)](2026-08-22-local-agent-codex-live-driver.md),
  [kimi (M3)](2026-08-22-local-agent-kimi-live-driver.md) — the lifecycle
  discipline and cancel-window design this driver reuses.
