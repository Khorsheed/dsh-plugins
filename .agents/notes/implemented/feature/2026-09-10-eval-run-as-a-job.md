# Agent Note: the evaluation run is a background job

Status: implemented

English | [中文](2026-09-10-eval-run-as-a-job.zh.md)

## Problem

`/eval run` awaited the whole run inside the command turn. Three things followed from that one fact.

A run died with its starter. The turn held the only reference to the run's promise, the command invocation's signal was never wired to anything, and every delegation was parented to the initiating session — so the initiating surface going away took the run with it (I3·T22 step 5 recorded exactly this). A run is minutes to hours of real work with real cost; the sentence that asked for it is not.

CI could not start one at all. `dsh-eval run` outside an instance refuses anything but `--dry-run`, and correctly: outside a session there is no live parent agent, no datasets/mission/localAgent services, and no scoped homes. That refusal left a pipeline with no door — the only way to start a real run was a human in a browser.

And there was no way to stop one. The run loop's only `AbortController` was the per-cell budget timer; nothing above it could reach a run at all.

Two smaller things sat in the same area. Plan paths and `--out` never expanded `~` — a slash argument never sees a shell, and a CLI argument quoted to survive one does not either — and `run.ts` carried a private duplicate of the `expandHome` that `validate.ts` already exported. And the web-eval profile's `install.sh` reached its first `dsh` call at line 176, after copying the profile files, replacing the agent preset directory whole, and (in source mode) building and packing every member; its trap only mentioned `$DEST`, and `update.sh` had no trap at all.

## Decision

- **The run is an unowned `eval-run` job.** `/eval run` registers it with `ctx.jobs` and answers immediately with the job id and the run id. Unowned is the point: an owned job is cancelled when its owning agent is disposed, which is the coupling being removed. The run then ends when it finishes, when `job_kill` stops it, or when the service is destroyed.
- **`--wait` keeps the old shape, byte for byte.** It is the right thing for a short interactive run, and a `--dry-run` is always synchronous (it finishes in the turn; handing back an id for work that is already done would be theatre). A composition that mounts no jobs service falls back to waiting and says so in the FIRST line of the reply, rather than refusing a run over wiring.
- **One cancel path, and it is the budget timer's.** `job_kill` → the job's `cancel` → `RunOptions.signal` → the same `stopRound` lever the per-cell budget timer pulls: abort the round's signal (which the delegation carries) and `localAgent.cancel(childSessionId)`. A cancelled cell is NOT retried — an infrastructure retry would be answering "the operator stopped this" with "let me try again" — and it is not transitioned anywhere: it stays in the state the cancel found it in, which is exactly what `finalize` reads as `interrupted` (T23's category). Cells never started stay `pending`, which is `not-started`; the run records `run.meta.cancelled` and still exports its bundle, because a cancelled run's cells are evidence.
- **The parent is resolved before the job starts, and a live AGENT is the requirement.** Measured, not assumed: the family facade's `requireLiveParent` resolves `ctx.agents.get(parentSessionId)` and refuses the round when nothing answers — a session record is not enough. So the job uses the calling session when it still has a live agent (the `/eval run` case: the agent outlives the browser tab), and otherwise creates its own session through `ctx.agents.create` and disposes it when the run settles (the Remote/CI case, which has no calling session at all). The reply names which of the two happened.
- **Output is retained and served two ways.** Every log line is kept in the job record. The registry's own reader (`readOutput`, which `job_output` drives) consumes with one cursor; `runJobOutput(jobId, cursor)` reads by index with another. Two cursors over one retained array, so a CI poller and the model-facing tool never eat each other's lines.
- **The Remote face is the CI door.** `dshEval.runStart / runStatus / runOutput / runCancel` are the same four verbs over the same job layer — no second run implementation. None of them takes an agent parameter: a CI caller has none, and requiring one would put the door back where it was. `dsh-eval run --instance <url> [--token …]` drives them over the instance's ordinary Remote RPC (`POST <base>/api/dshEval/<method>`, `{args:{…}}` in, `{ok,value}` out, launch token as `?token=`), follows the log, and exits with the job's verdict. Without `--instance` the CLI stays dry-run-only.
- **`~` expands at the service boundary.** `EvalService.run`, `report` and `validatePlan` expand the paths they are handed, so all three faces get one rule instead of three call sites that must each remember; `run.ts`'s private copy is gone and `validate.ts`'s export is the only one.
- **The profile scripts check the machine first.** `install.sh` and `update.sh` now begin with `dsh` on PATH, `dsh --version`, and the `headlessBundleDir` the profile pins — read out of `cordis.patch.yml` rather than hardcoded, because the pin is the thing that must be true. Nothing is written until they pass. The preset directory is backed up before it is replaced and the backup is named in the trap; `update.sh` gained a trap and a backup of the pinned template files it overwrites.

## Testing

- The job producer, against a fake registry with the real contract's semantics: ids before the run has done anything, the non-consuming cursor beside the registry's consuming reader, unowned registration, cancel reaching the run's signal, its own parent session when the caller has no live agent (and disposal at settle), and a refusal recorded as a `failed` job with the diagnostics in the log.
- The slash faces: a job by default (unowned, labelled, one cancel path named in the reply), `--wait` and `--dry-run` staying synchronous, and the no-jobs fallback line.
- The run loop's cancel, through `runPlan` with a real `AbortController`: the in-flight delegation cancelled, the cell recorded `cancelled` and NOT retried, no further cell started, `meta.cancelled` set, and the `cell-cancelled` annotation written.
- The instance client: args by NAME (the wire's own shape), the token on the query, the follow loop's cursor advance, and the 401/404 messages that name the likely cause.
- Path expansion at the service boundary.
- Shell fixtures for both profile scripts: with `dsh` off PATH, and with a patch pinning a headless path that does not exist, each script exits 2 with `nothing has been written` while a marker file in the preset directory and an installed profile file are untouched.

## Real-machine verification

On the evaluation instance (`:3171`, `DSH_HOME=~/.dsh-lab`), with this branch installed through the profile's own source-mode installer:

| Check | Result |
|---|---|
| The CI door | `dsh-eval run <plan> --instance http://127.0.0.1:3171 --dry-run` starts a job through the Remote, follows the log, and exits on the job's verdict — no browser anywhere in it |
| A run outlives its starter | `--no-follow` started `eval-run-3` / `run-20260910055932-fwnx` and the starter process EXITED (a stronger form of closing the tab). The run kept going; a FRESH process polled `runStatus` to `completed` and read the whole log back through `runOutput` |
| Its own parent session | the run opened `3a4bd82f…` for itself (the Remote door has no calling session) and the reply said so |
| The report path is in the closing line | `bundle: …/exports/run-20260910055932-fwnx-bundle`, then `run … finished — 1 cell(s): …` |
| The profile preflight | with `dsh` off this shell's PATH, `install.sh` exited 2 with `preflight failed — nothing has been written` before touching `$DSH_HOME` — caught the author's own shell on the first attempt |
| Byte-identical recompute | the pilot-a-round1 bundle recomputes to the same `results.jsonl` (sha256 `a05244bc…`) and `usage.jsonl` as `main` |

Two real defects surfaced here and are fixed in this change: the launch token is accepted at ONE door (`GET /?token=…`, which mints the session cookie every later request carries), and the RPC body is the connection's own envelope (`{type:'client-request', rpcId, method, payload:{args}}`), not a bare payload. A third — `ctx.jobs.start` refusing an unowned job with "no job controller serves this agent" — is why this package attaches its own controller.

**What the instance could NOT show, and why.** A two-stage cell never reached `archived` there: every resume round failed with `childSession.snapshotEvents is not a function`. That is a HOST-LINE mismatch, not this change. `snapshotEvents` entered the plugins on 2026-09-09 with `feat(packages): adapt all plugins to host 0.1.2-rc.1`, and every package's Compatibility section says `minHost 0.1.2-rc.1`; the instance runs the `stable` toolchain, dsh 0.1.1-rc.2, whose Session has no such method. The evidence that it is the line and not the job path: readiness probes and stage-one rounds (fresh delegations, which never resume) completed normally in the same runs, and the same plugin build drives stage one and two to `archived` outside the instance. The job mechanism — start, survive the starter, log, settle, export — is verified; "the cell reaches archived on 3171" waits on that instance's toolchain.

## Alternatives considered

**Wire the command invocation's `AbortSignal` into the run and keep it in the turn.** Rejected: it fixes the wrong half. The run would still end when the turn ends — which is the behavior being removed — and it would give the run a second cancellation entry that races the first. The job registry already owns "work that outlives its starter", including the model-facing verbs to list, read and kill it.

**Own the job by the calling agent.** Rejected for the same reason in one word: owned jobs are cancelled when the owning agent is disposed. That is a good default for a bash command; for a run whose whole point is to survive the session, it is the bug.

**Give the run its own `/eval stop <runId>` verb.** Rejected: a second stop path is a second thing that can be half-wired, and the first thing a reader has to disambiguate. `job_kill` already exists, is already in the evaluation preset, and reaches exactly one lever.

**Let the CLI drive a run directly by mounting the services in-process.** Rejected: it would need the datasets, mission and localAgent services, a live parent agent, and the instance's scoped homes — that is not a CLI, it is a second instance, and the scoped homes are the one thing that cannot be duplicated (the read-back reads what the round wrote). Calling the instance that already has them is the smaller and truer thing.

**Have the Remote face take an agent parameter, like mission's tab Remotes do.** Rejected: those Remotes serve a browser that always has one. This face exists for callers that do not, and an agent parameter would be a door with the same lock the old one had.

**Stream the run's output over a Remote event stream instead of a cursor read.** Rejected for now: a poll is what a CI runner already knows how to do (and what survives a dropped connection without a resume protocol), and the cursor is the smaller contract. The stream is the natural upgrade when a browser surface wants live lines.

**Keep `expandHome` in `run.ts` and expand at each call site.** Rejected: three faces reach the same verbs, and a rule that lives at the call sites is a rule that will be missing from the next one.

**Check the machine's prerequisites at the END of the profile scripts, where `dsh` is first used anyway.** Rejected: by then the preset directory has been replaced whole and, in source mode, every member has been built and packed. A precondition of the MACHINE is checked while nothing has changed yet; that is what makes "nothing has been written" a sentence the script can honestly print.

## Consequences

- A run survives the tab, the session and the turn that started it, and a CI pipeline can start, watch and stop one without a browser.
- `/eval run`'s default reply changed shape: it is now two ids and where to read the log, not the run's report. `--wait` restores the old reply for the cases that want it.
- The eval package gains two optional peer dependencies (`@deepseek-ai/dsh-jobs` for the producer contract and the `eval-run` kind, `@deepseek-ai/dsh-typert-protocol` for the Remote face) and its first generated Typert artifacts; the lockfile records the jobs entry.
- Cancelling a run leaves cells mid-stage on purpose. `finalize` already had the category for it (`interrupted`), and the report now distinguishes it from a cell that never started (`pending` / `not-started`).
- The profile scripts fail earlier and more often — which is the point. A machine missing `dsh` or the pinned headless bundle now finds out in a second, with its installed profile and its agent preset intact.
