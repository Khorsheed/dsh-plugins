# Agent Note: codex rollout read-back — the tail window, and the cwd under concurrency

Status: implemented

English | [中文](2026-09-08-codex-rollout-readback-tail-window.zh.md)

## Problem

An evaluation run reported `model.observed: null` for codex delegation rounds
whose `delegations.jsonl` and rollout files plainly named the model, while a
smoke delegation minutes earlier read `gpt-5.6-sol` back without trouble. The
run had two codex processes in flight (`--concurrency 2`) in different cell
directories, so the working hypothesis was that the rollout locator — thread id
plus a time window — had picked the wrong file, or none, under concurrency.

Replaying the locator against the run's real scoped home showed something
else. `codexRolloutTurnModel` scanned only the last 64 KB of the located file,
but codex writes `turn_context` — the ONLY line naming the model — when the
turn STARTS. A round that then produces more than 64 KB of events pushes its
own `turn_context` out of the tail:

| rollout | size | `turn_context` offsets | tail scan |
|---|---|---|---|
| smoke round | 38 KB | 33 KB | whole file scanned — read back |
| `f2` cell, round 1 | 131 KB at settle | 33 KB | window `[66 KB, 131 KB]` — missed |
| `f3` cell, round 1 | 100 KB at settle | 35.4 KB | window `[34.9 KB, 100 KB]` — read back, by 546 bytes |

So concurrency was not the cause; ROUND LENGTH was. The smoke round's whole
file fit inside the tail window, the evaluation cells' did not, and `f3` read
back only because its first round happened to end 546 bytes before the window
would have excluded its `turn_context`. Two runs of the same shape, one
reporting a model and one reporting null, with nothing in the code to explain
the difference.

Concurrency is still a real hazard, just a second one: when the stream carries
no thread id (a kill truncates it before `thread.started`), the locator falls
back to "newest file in the window", and concurrent cells put several rounds'
files inside one window. The fallback would then read a neighbour's model — a
value that is not absent but wrong, which the evaluation turns into a
fail-loud misattribution of a run that was fine.

Separately, the round's `usage` reached `delegations.jsonl` but never reached
the caller. `LocalAgentRegistry.trackRun` dropped a run's `onProgress` route
the moment `run.result` settled, and every exec-drive provider computes its
settle observation strictly after that (the CLI's stream is only complete once
the process is reaped). The `settled` payload reached the cordis event and
nothing else.

## Decision

**One read-back, one located file, three facts.** `codexRolloutUsage` and
`codexRolloutTurnModel` are replaced by `codexRolloutRoundFacts`, which locates
the round's rollout once and returns `{ usage, model, cliVersion }`. Each field
is absent on a miss; absence is recorded, never guessed.

**Which rollout field is authoritative for what**:

| fact | authority | why |
|---|---|---|
| thread identity | `session_meta.payload.id` (`session_id` on older builds) | what a resume command continues |
| the round's directory | `session_meta.payload.cwd` | codex's own record of where it ran |
| the model | `turn_context.payload.model`, last one inside this round's window | the exec `--json` wire carries no model at all (codex 0.144.0) |
| the codex build | `session_meta.payload.cli_version` | written by the process that served the round |
| the token spend | last `token_count` `info.last_token_usage` | the stream's `turn.completed` is absent on a non-completed round |

**The scan reads the tail first, then the whole bounded file.** The tail is
where `token_count` lives, so it stays the first read; whenever it leaves
either fact missing, a bounded full read from offset 0 fills it in. The tail's
answers win where it had them — they are the file's last — and the full read
only fills gaps.

**The locate takes the round's `cwd`.** `CodexRolloutLocator` gains a `cwd`,
and the window fallback restricts its candidates to files whose head records
that directory (compared through `resolve`, so trailing-slash forms match). A
window that holds candidates but none in the round's directory resolves to
NOTHING — reporting a neighbour's model is worse than reporting none, because
the evaluation fails a run loud on declared ≠ observed and would abort work
that was correct. The one exception is a window holding exactly one candidate:
there is no other round to confuse it with, so a mismatch there is path skew
(a symlinked temp root) and the candidate answers.

**The facade holds a settled run's progress route open.**
`RUN_PROGRESS_SETTLE_GRACE_MS` (60 s): on result-settle the tracked entry still
loses its cancel lever and its heartbeat, but the call's `onProgress` moves to
a parked route that closes on the first `settled` report or the grace timer,
whichever comes first. A resume round reusing the child session id drops any
stale parked route first.

## Testing

`packages/local-agent-codex/tests/records.spec.ts` covers a `turn_context` far
outside the tail window, the window filter against a resumed thread's earlier
turns, and three concurrency cases: the cwd separating two in-window files, a
cwd matching none reporting nothing, and a lone in-window candidate answering
despite a cwd mismatch. `codex-cli-provider.spec.ts` drives the same two
through the provider — a long round, and a round whose stream was truncated
before `thread.started` while a NEWER neighbour file sits in the window.
`delegation-facade.spec.ts` covers a settle report arriving after
`run.result` resolved.

## Alternatives considered

**Widen `TAIL_BYTES`.** Any constant is a bet on round length; the run that
produced this had 500 KB rollouts, and the next one can be larger. The full
read is bounded by the existing `FULL_BYTES` and only happens when the cheap
scan came up short.

**Read `turn_context` from the head instead of the tail.** It would fix the
model and break the usage, which genuinely lives at the end. Reading the tail
first and widening only on a miss keeps the common case at one bounded read.

**Let the cwd mismatch fall back to the newest in-window file.** That is the
pre-existing behavior and the one that can attribute a neighbour's model to
this round. Silence is recoverable — the evaluation records null; a wrong
model is not, because it fails the run as misattributed.

**Make the round's result wait for the settle observation.** It would put the
observation in front of `run.result` for every caller, but the abort path
settles at the cancel moment BY CONTRACT, before the process is reaped — so a
cancelled round could not report at all, and a completed one would widen the
window in which a late cancel wins the settle race. Parking the route after
the fact costs nothing and changes no settle semantics.

**Fix the null `usage` in the evaluation instead.** The evaluation reads its
captured `settled` after awaiting the record read-back, so it does see a late
report; and the facade contract — "the call's `onProgress` receives the same
payloads the cordis event carries" — was the thing actually broken. Fixing the
consumer would have left every other caller with the same hole.

## Consequences

Concurrent codex delegations read back their own round: the two rollout files
from the failing run now both resolve to `gpt-5.6-sol` with `cliVersion`
`0.144.0`, including with the thread id withheld. A round whose window is
ambiguous and whose directory matches nothing now reports absence where it
used to report a neighbour's value — strictly more honest, and one more way to
get null. Locating still walks the whole `sessions/` tree per settle (unchanged
cost); the added full-file read happens only when the tail scan came up short,
bounded by `FULL_BYTES`.

The parked progress route holds one callback per settled run for up to a
minute. It is dropped on delivery, on the timer, on a resume of the same child,
and on plugin dispose.

Related: [the observed-model read-back and cwd override](../feature/2026-09-06-local-agent-observed-model-cwd.md),
[the CLI version and credential grade](../feature/2026-09-08-cli-version-and-credential-state.md).
