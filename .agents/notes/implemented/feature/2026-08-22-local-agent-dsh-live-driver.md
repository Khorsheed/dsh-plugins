# Agent Note: local-agent-dsh live driver — resident sub-dsh serve mode (live-driver M1)

Status: implemented

[English](2026-08-22-local-agent-dsh-live-driver.md) | 中文

## Problem

The `dsh-cli` provider (and every family provider) drives one delegation round
as one throwaway CLI process. That model makes three things physically
impossible: graceful interruption (only SIGTERM/SIGKILL), mid-run steering, and
cheap streaming (the M3 mirror polls the session log every 2s and re-parses
it). The [live-driver proposal](../../../../proposals/active/2026-08-20-local-agent-live-driver.md)
adds a second drive mode — a resident runtime per member, one turn per request
— and schedules dsh first (M1) because the channel is our own mechanism.

## Decision

`live: true` on `@khorsheed/dsh-local-agent-dsh` switches delegation rounds
from the exec one-shot to a resident sub-dsh, without touching the facade,
delegation records, resume lock, or the member channel contracts.

**The channel is our own, not the official SDK wire.** The headless bundle
(`@khorsheed/dsh-local-agent-dsh-headless`) gains a `--serve` mode
(`src/serve.ts`): a resident loop speaking newline-delimited JSON-RPC 2.0 over
stdio (`src/wire.ts`, framed exactly like the official `JsonRpcLineTransport`).
Requests `initialize` / `turn/start` / `turn/interrupt` / `shutdown` are quick
acknowledgements; turn events flow back as `session/event` notifications and
the turn closes with `session/idle` (sent after the log flush). Interrupt lands
as the in-process official `Agent.cancel({kind:'parent'})`. The official
`@deepseek-ai/dsh-sdk-jsonrpc-server` was evaluated and rejected for now: its
wire has no turn-level interrupt, the live driver's core win (upstream seam
registry S8; when the official wire grows interrupt, serve mode retires).

**Provider side** (`src/live-driver.ts`, `DshLiveDriver`): one resident
runtime per member (keyed by the caller session id, which stays
`cliSessionId == childSessionId`), spawned lazily on the first live round with
`--serve` and the same explicit env layer as exec (`DSH_HOME`,
`DEEPSEEK_API_KEY`, member-bridge coordinates). A round: provision heal →
credential → `ensureRuntime` (spawn + `initialize` handshake) →
`turn/start` is appended to the child session before the wire request goes
out (line processing is synchronous, so an ack chunk could carry the turn's
first events; the parent's turn boundary must already be open) →
settle on the `session/idle` notification through the same
`settleRunResult`/`subprocessRunHandle` scaffolding and the identical
three-branch `turn/end` bookkeeping as exec. `cancel` sends `turn/interrupt`
and settles locally; the teardown ladder deliberately never kills the process
(it waits, bounded, for the interrupted turn to converge).

**Lifecycle discipline** (the mode's main cost, shipped with M1 on purpose):
idle reclaim after `liveIdleMs` (default 30 min; wire `shutdown` → grace →
SIGTERM ladder), `disposeAll` on plugin unload, crash re-spawn with
`agents.resume` of the on-disk session on the next round, and a permanent exec
fallback when spawn/handshake fails (`LiveChannelUnavailableError` →
`driver.disabled`). Every runtime sits in the driver's registry until
reclaimed, so a profile restart leaves no zombies.

**Mirroring shares the fold, changes only the transport.** The new
`mirrorDshLiveEvent` entry in `session-mirror.ts` reuses the file mirror's
exact filter/append core (extracted `appendMirroredMessageEvent`); the settle
path still runs the file-based `mirrorDshSession` as reconciliation, whose
already-mirrored-prefix skip dedupes against live-appended events — the final
child transcript is identical to exec by construction. `liveMirrorGranularity:
'token'` (default `'event'`) additionally appends `assistant/chunk` deltas.
Member-channel registration moves from per-round to per-process (the resident
process carries the spawn env for its lifetime; the token releases on
reclaim/crash).

## Alternatives considered

- **Drive the official SDK JSON-RPC runtime (`dsh-jsonrpc-agent` +
  `@deepseek-ai/dsh-sdk-client`)** — rejected for M1: no wire-level
  interrupt/cancel (client docs confirm a timed-out request runs until the
  runtime closes), so cancel would stay process-kill, the proposal's first
  win. The wire we ship mirrors its framing so the swap stays mechanical once
  upstream grows interrupt (S8).
- **One shared runtime process for all dsh members** — rejected for M1:
  per-member processes keep lifecycle, reclaim, and member-channel token
  ownership trivially correct; the wire already carries session ids, so
  sharing later is an optimization, not a redesign.
- **Push-triggered file polling instead of wire-carried events** — rejected:
  it would keep disk freshness on the notification path and pay a full log
  re-read per event; wire-carried events append directly, and the file mirror
  stays as the settle reconciliation pass.
- **Token granularity by default** — rejected: every delta is an append +
  persist + broadcast (write amplification); it ships as the documented
  opt-in the proposal specifies.

## Consequences

- `live: true` buys runtime-level graceful interrupt (process survives,
  session continuable) and push-mode event mirroring with zero 2s polling;
  `live` off (the default) is byte-identical to before — the exec path is
  untouched and its tests run unchanged.
- The fold layer's existing interface did not change; `mirrorDshLiveEvent` is
  an additive transport-side entry point sharing the same append core. Per
  the member-state collaboration protocol, the partner acceptance should
  review exactly this addition.
- New failure surface accepted deliberately: resident processes (zombie/leak
  risk) — contained by the reclaim registry, the idle reaper, and
  `disposeAll`; pinned by lifecycle tests.
- Token-granularity streaming is implemented and unit-tested but not yet
  verified against a live model; first real-instance run should confirm
  `assistant/chunk` events flow as expected.
- Serve-mode boot was smoke-verified against a real sub-dsh profile
  (initialize handshake + shutdown → exit 0); a full real turn needs a
  credentialed deployment (3080 acceptance).
- Resident-mode shutdown must detach the stdin feed: the launcher's bounded
  exit completes via `process.exitCode`, which only takes effect once the
  event loop drains, and a flowing stdin pipe holds it open forever — a
  one-shot never listens on stdin, so only serve mode hits this. The shutdown
  path removes the listeners, unrefs stdin, and arms a 2s self-exit fallback.
  M2+ runtimes must replicate this discipline.

## Testing

- Headless: `tests/serve.spec.ts` (wire handshake, turn flow, live event push
  order, interrupt → `Agent.cancel`, shutdown/EOF reclaim, malformed lines,
  error turns), `--serve` startup parsing cases.
- Provider: `tests/live-driver.spec.ts` (round settlement parity, runtime
  reuse, interrupt-survives-process, token granularity, idle reclaim, shutdown
  ladder, crash re-spawn, accept-failure reclaim, disposeAll zombie
  accounting, provider dispatch, exec fallback), plus `mirrorDshLiveEvent`
  fold-parity and offset-consistency cases in `tests/session-mirror.spec.ts`.
- Real-boot smoke: `--serve` against a real sub-dsh profile (initialize
  handshake + shutdown exit 0).
