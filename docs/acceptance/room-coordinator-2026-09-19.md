# Room coordinator acceptance — 2026-09-19

Status: in progress. This record does not establish all-provider streaming acceptance or authorize production deployment.

## Environment

- Isolated branch: `codex/room-coordinator-runtime`.
- Host: `0.1.5-rc.1`, checkout `183f08e9c6`; host source unchanged.
- Lab profile: `room-coordinator-test`, loopback port 3084. Production port 3080 unchanged.
- Separate settings, credential file and member homes. DSH credential provisioned privately; user completed Kimi login in the lab scope.
- Observed CLI versions: Kimi 0.42.0, Codex 0.144.0, Claude Code 2.1.277.
- Worktree links are used for development. Fresh and upgrade tarball acceptance remains outstanding.

## Observed results

| Scenario | Evidence | Result |
| --- | --- | --- |
| Native DSH reception | Fresh session answers with native usage/time | Passed |
| Invite/promote DSH | Child answers; bare input reaches promoted member with native tool history | Passed |
| Prepare/promote Kimi | Login succeeds, prepare without an initial task, select as coordinator, direct K3 answer | Passed |
| Authenticated Room tools | Kimi `mcp__dsh-member__room_read` sees selected coordinator and three members | Passed |
| Member navigation | Room shortcut opens child with breadcrumbs, tools, reasoning, answer, duration and token usage; cold history also loads | Passed for DSH/Kimi |
| Kimi directory/effort | Configured candidate list clearly labelled incomplete; prepared native directory offers low/high/max | Passed for observed scope; account-wide completeness not asserted |
| DSH final answer | Reasoning separated from final answer, real result 391 | Passed |
| Small background delegation | Kimi delegates to DSH, initial receipt returns, DSH completes in 4.4 seconds, automatic correlated report wakes Kimi for final answer | Passed without polling or formal goal |
| Busy effort change | Kimi 80-line turn begins at low; changing to high displays pending while current remains low; completion applies high to following turns | Passed |
| Native incremental output | Reasoning/text grow before native completion in Room and member surfaces | Passed qualitatively; full latency gate remains open |
| Stop retains output | Stop a long Kimi response after 56 seconds; Room retains partial text with explicit stopped label and member link | Passed; concurrent unaffected member still requires a dedicated trial |
| Normal persistence | After final-flush fix, DSH 84 events and Kimi 401 events match live history exactly, including final turn/end; graceful shutdown and cold restart need no recovery | Passed |
| Dependent goal stages | `verify-17x23`: compute submitted and explicitly accepted before independently verified second task dispatch; second accepted and goal completed | Passed, 2 attempts within budget 4, concurrency 1 |
| Rework | `rework-17x23`: first attempt supplies 391 without process; coordinator records rework; second supplies full process and is accepted; goal completed | Passed, 2 attempts within total 3/per-task 2/concurrency 1 |
| Multiple browser pages | After shared-feed fix, Room and Kimi child both load history; two active members stream while Room state and reports update | After `fe20f7d9`, Room plan revisions update during real work with the Kimi member page open; final continuation is being checked |
| Pause during evidence submission | Old UI revision raced worker submission and pause was rejected; native rework continued | Fixed in `168043ab`; subsequent real pause persists, retains first submission/rework and admits no second attempt until resume |

| Budget boundary | Resume with 1/1 attempts returns to paused (`Execution budget exhausted`), no second attempt; UI increases budget to 2 while remaining paused, explicit resume dispatches attempt 2 | Boundary and manual update passed; final acceptance being checked |

## Failures found and repairs

1. **Unknown persisted event vocabulary.** Real JSONL/Zstandard persistence rejected `local-agent/stream`; linked npm peer registration did not update the active host module. Core and Room now register through the active loader. Regression uses the real persistence backend.
2. **Cold composer and historical replay.** Cold Room activation cached the wrong election state; Kimi load notifications entered the new answer. Cold activation now triggers election after confirmation; Kimi output listener attaches after load/configuration.
3. **Final history suffix omitted.** Provider result could settle before asynchronous stream checkpoints. All four providers enqueue and await a final persistence snapshot including turn/end. Real DSH/Kimi normal shutdown verification above passes.
4. **Stopped partial missing from Room.** Native transcript retained text while Room speech omitted cancelled/failed output. Nonempty partials now persist with interrupted status and remain navigable.
5. **Browser connection starvation.** Separate control/directory/output subscriptions consumed HTTP/1 connections, delaying history and Room mutations. Core now multiplexes member channels over one Remote stream per plugin instance, with slow-consumer coalescing and per-source isolation.
6. **Wrong Room refresh signal.** Host journal appends do not always notify session summary observers. Room now subscribes to the public event window as its refresh signal; the test double separates both surfaces.
7. **Human pause revision race.** A concurrent submission invalidated the browser's pause revision. Human pause now carries goal identity and operates on that goal's latest serialized state; other state-changing actions keep revision checks.

The earlier lab history required explicit recovery while the server was stopped: save complete authenticated live pages privately, verify contiguous events and exact stored prefix, append only the missing suffix, flush and read back. No event was rewritten. Those repaired runs are not counted as normal persistence passes. The later 401-event Kimi run was verified without recovery.

## Streaming measurement limits

Foreground diagnostics use native receipt timestamps and two animation frames as a conservative paint estimate on this localhost setup. Samples from continuous Kimi runs were commonly 69–91 ms; one early sample reached 244 ms. These snapshots are not a full-turn P95 dataset. A page opened mid-turn also initially measures the age of replayed state, so replay must be distinguished before interpreting such a dataset. No claim of P95 ≤ 200 ms for all four harnesses is made yet.

## Automated verification

Latest completed package suites: core 347, DSH 187, Kimi 245, Codex 224, Claude 232, Room 277. Corresponding builds passed. Core coverage includes eight members sharing one browser feed, coalesced output, late consumers, cancellation and source isolation. Provider suites include delayed persistence at final settlement. Room covers interrupted partials, cold composer election, structured plans and authenticated member tools.

Isolated composition preflight passed before each restart. Package independence previously checked 33 packages with zero findings. Final all-package gate is still pending.

## Remaining acceptance

- Complete the final budget-resume attempt; uncertain restart reconciliation and targeted Stop isolation.
- Complete native-arrival-to-foreground-paint dataset with replay distinguished; P95 ≤ 200 ms per supported native streaming harness.
- Full model reset/default and frozen-eval runtime behavior (automated coverage exists).
- Real Codex and Claude login, generation, model control and Room tools in independent lab scopes; login request is pending.
- Fresh and upgrade tarball installations, final compatibility review and integration gate.
- Production installation and gated restart are a separate coordinated step.
