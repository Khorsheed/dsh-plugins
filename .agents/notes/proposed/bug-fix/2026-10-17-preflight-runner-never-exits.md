# Agent Note: Known issue — the preflight runner never exits after PASS, and schedule-exit refuses on the timeout

Status: proposed

## Problem

Deploying the library on the evening of 2026-10-17, ankh-guard's `schedule-exit` failed three times in the same pattern:

- `composition preflight START` → timeout (300s, then 600s, then 1200s) → `preflight timed out after …` → SIGKILL → schedule-exit refuses the restart
- yet the killed child's flushed output already carried **`preflight PASS: profile "web" boots clean`** — the composition is clean; the runner process never exits

Reproduced by running the launch-spec's pinned runner directly (`node <profile>/node_modules/@khorsheed/dsh-ankh-guard/lib/preflight-runner.js --profile web --host-surface built --install-anchor <harness>/apps/cli/package.json`): after the PASS line the process sits at 0% CPU forever (a live handle survives dispose — a watcher / socket / interval left open). The harness HEAD (639ed01539, 0.2.0-rc.2) and the same profile composition exited normally in an earlier deploy that same day; the suspicion is a timing interaction with the heavy machine load at the time (load 17–21, several worktree agents building in parallel), or a package whose dispose leaks a handle under specific conditions.

## Impact and the bypass

`schedule-exit`'s spawn never sees close → the timeout SIGKILLs → infra-failed (the guard is explicit: "This is NOT a verdict on the composition"). The bypass path (carried in the guard's own refusal text): with the preflight PASS output in hand, `kill <port listener>` by hand and let the supervising watchdog respawn and run readiness — verified clean on 3080. The watchdog ledgered one `unplanned exit recovered` report record (the inevitable trace of a manual kill).

## Risks

- The bypass steps around schedule-exit's gate: if a composition ever IS broken while a PASS output is misread, a manual kill has no gate. Walk it only with the PASS output in hand.
- Unfixed, every deploy under load stalls here, and the manual override starts looking like the normal path.
- A runner that never exits may be accumulating zombie state (the handles alive at each SIGKILL were never audited).

## Alternatives considered

- **Just raise the timeout**: tried (300s → 600s → 1200s) — the PASS output always lands well before the timeout yet the process never exits. It is not slow, it is stuck; a longer timeout cannot fix it.
- **Skip schedule-exit's internal preflight on the deploy side**: rejected — the gate's point is proving the composition before restart; stepping around it removes the gate.
- **Wait for the upstream fix before deploying**: this deploy could not wait (the learner was waiting on quiz drafts); the problem is recorded here for ankh-guard's owner to pick up.

## Suggestion

The fix lives in preflight-runner / harness dispose: enumerate and close the leftover handles before `runPreflight` returns (or have the runner `process.exit(code)` right after setting `process.exitCode` — a one-shot tool has no reason to wait for the event loop to drain). Narrow the reproduction first: the load relationship, and which package introduces the handle (a `process._getActiveHandles()` dump right after boot names it).

## Proposal

Two layers, in order of preference:

1. Fix the leak: after `runPreflight`'s dispose settles, dump `process._getActiveHandles()`, find the owner package, close it there. This is the real fix — a boot that leaks handles leaks them in production too.
2. Defensive, in the runner: once the verdict is computed, `process.exit(code)` explicitly. A one-shot dry-run has no business waiting for the event loop to drain. This alone unblocks the gate.

## Acceptance criteria

- The pinned runner (`--profile web --host-surface built --install-anchor <harness>/apps/cli/package.json`) exits within seconds of printing its verdict, under load or idle.
- `ankh-guard schedule-exit` on 3080 completes through `exit scheduled …` with no preflight timeout.
- The library's own suite stays green (142/142) — no library change is expected here, this guards against surprise coupling.
