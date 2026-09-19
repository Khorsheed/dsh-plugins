# Room coordinator acceptance — 2026-09-19

Status: in progress. This record does not establish all-provider streaming acceptance or authorize production deployment.

## Environment

- Isolated branch: `codex/room-coordinator-runtime`.
- Host: `0.1.5-rc.1`, checkout `183f08e9c6`; host source unchanged.
- Lab profile: `room-coordinator-test`, loopback port 3084. Production port 3080 unchanged.
- Separate settings, credential file and member homes. DSH credential provisioned privately; user completed Kimi login in the lab scope.
- Observed CLI versions: Kimi 0.42.0, Codex 0.144.0, Claude Code 2.1.277.
- Development initially used worktree links. The 3084 lab now installs nine candidate tarballs at `0.1.1-roomcoord.80493f09`, with no workspace links for the family. This is a test-only version, not an npm release.
- Fresh/upgrade installation probes use the npm host toolchain pinned to `0.1.5-rc.1`; their test HOME directories are separate from the logged-in lab and production.

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
| Native incremental output | Reasoning/text grow before native completion in Room and member surfaces | DSH/Kimi foreground scenarios below meet the threshold; full provider/workload gate remains open |
| Stop retains output | Stop a long Kimi response after 56 seconds; Room retains partial text with explicit stopped label and member link | Passed; reverse isolation also passed: stopping DSH leaves Kimi to finish its 25-line answer in 14 seconds |
| Normal persistence | After final-flush fix, DSH 305 events and Kimi 825 events match live history exactly, including final turn/end; graceful shutdown and cold restart need no recovery | Passed |
| Dependent goal stages | `verify-17x23`: compute submitted and explicitly accepted before independently verified second task dispatch; second accepted and goal completed | Passed, 2 attempts within budget 4, concurrency 1 |
| Rework | `rework-17x23`: first attempt supplies 391 without process; coordinator records rework; second supplies full process and is accepted; goal completed | Passed, 2 attempts within total 3/per-task 2/concurrency 1 |
| Multiple browser pages | After shared-feed fix, Room and Kimi child both load history; two active members stream while Room state and reports update | After `fe20f7d9`, Room plan revisions update during real work with the Kimi member page open; continuation completed with goal revision 48 and matching member history |
| Pause during evidence submission | Old UI revision raced worker submission and pause was rejected; native rework continued | Fixed in `168043ab`; subsequent real pause persists, retains first submission/rework and admits no second attempt until resume |
| Budget boundary | Resume with 1/1 attempts returns to paused (`Execution budget exhausted`), no second attempt; UI increases budget to 2 while remaining paused, explicit resume dispatches attempt 2 | Passed; second attempt accepted and goal completed at revision 48, 2/2 attempts |

## Failures found and repairs

1. **Unknown persisted event vocabulary.** Real JSONL/Zstandard persistence rejected `local-agent/stream`; linked npm peer registration did not update the active host module. Core and Room now register through the active loader. Regression uses the real persistence backend.
2. **Cold composer and historical replay.** Cold Room activation cached the wrong election state; Kimi load notifications entered the new answer. Cold activation now triggers election after confirmation; Kimi output listener attaches after load/configuration.
3. **Final history suffix omitted.** Provider result could settle before asynchronous stream checkpoints. All four providers enqueue and await a final persistence snapshot including turn/end. Real DSH/Kimi normal shutdown verification above passes.
4. **Stopped partial missing from Room.** Native transcript retained text while Room speech omitted cancelled/failed output. Nonempty partials now persist with interrupted status and remain navigable.
5. **Browser connection starvation.** Separate control/directory/output subscriptions consumed HTTP/1 connections, delaying history and Room mutations. Core now multiplexes member channels over one Remote stream per plugin instance, with slow-consumer coalescing and per-source isolation.
6. **Wrong Room refresh signal.** Host journal appends do not always notify session summary observers. Room now subscribes to the public event window as its refresh signal; the test double separates both surfaces.
7. **Missing bundled parser.** Fresh and upgrade npm-host preflight failed because the Kimi artifact imported `smol-toml` externally while pack-dist removed ordinary dependencies. `0f4840f7` bundles the parser in the package-level Node build; both clean artifact preflights now pass.
8. **Human pause revision race.** A concurrent submission invalidated the browser's pause revision. Human pause now carries goal identity and operates on that goal's latest serialized state; other state-changing actions keep revision checks.

The earlier lab history required explicit recovery while the server was stopped: save complete authenticated live pages privately, verify contiguous events and exact stored prefix, append only the missing suffix, flush and read back. No event was rewritten. Those repaired runs are not counted as normal persistence passes. The later 401-event Kimi run and subsequent 687-event transcript were verified without recovery.

## Streaming measurement limits

Foreground diagnostics use native receipt timestamps and two animation frames as a conservative paint estimate on this localhost setup. Samples from continuous Kimi runs were commonly 69–91 ms; one early sample reached 244 ms. These snapshots are not a full-turn P95 dataset. Before the diagnostic fix below, a page opened mid-turn also initially measured the age of replayed state. No claim of P95 ≤ 200 ms for all four harnesses is made yet.

`80493f09` retains per-round, per-surface diagnostics after transient nodes disappear. Baselines, missing observations and truncation are explicit. Four completed foreground scenarios now have retained [raw millisecond samples](room-coordinator-streaming-2026-09-19.json):

| Harness / surface | Live updates painted | Baselines excluded | P95 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Kimi / Room, turn 29 | 25 / 25 | 0 | 110 ms | 138 ms |
| DSH / Room, turn 16 | 156 / 156 | 0 | 86 ms | 132 ms |
| DSH / member, turn 17 | 112 / 112 | 1 | 87 ms | 122 ms |
| Kimi / member, turn 30 | 13 / 13 | 1 | 76 ms | 76 ms |

The two Room requests ran concurrently; the integration gate was also running in the background. The member requests ran separately. All four measured surfaces have zero pending, background, unmounted, clock-mismatch, unrendered or truncated live observations. These scenarios meet the threshold for browser-delivered updates, with replay excluded. They do not measure every pre-coalescing native token, replace the remaining sparse/burst/provider matrix, or measure request-to-first-token latency. For example, the native Kimi record for the 80-line Room reply reports about 47 seconds to its first token, separate from the measured display delay.

After these runs the full persisted histories match 305 DSH / 825 Kimi events, ending at `turn/end`, without manual recovery.

## Automated verification

Latest completed package suites: core 350, DSH 187, Kimi 246, Codex 224, Claude 232, Room 282. Corresponding builds passed. Core coverage includes eight members sharing one browser feed, coalesced output, late consumers, cancellation and source isolation. Provider suites include delayed persistence at final settlement. Room covers interrupted partials, cold composer election, structured plans and authenticated member tools.

Isolated composition preflight passed before each restart. Package independence previously checked 33 packages with zero findings. The full 14-step integration gate passed at `a4f397d9` in 552 seconds, including all builds/tests and 26 plugin tarball checks. After the parser packaging correction, the affected-package 14-step gate passed at `0f4840f7` in 101 seconds; Kimi retained 245 passing tests. The nine-package delivery family also received a clean rebuild before candidate packing. Subsequent 14-step affected-package gates passed at `385da4de` (147 seconds), `5ddd3ac5` (141 seconds) and `99247e47` (100 seconds). The core diagnostic update at `80493f09` passes the 14-step affected-family gate in 333 seconds, rebuilding and testing eight dependent packages.

## Tarball installation and upgrade

- Candidate: nine packages, test version `0.1.1-roomcoord.99247e47`, created and verified by the repository packer. Artifacts are outside the workspace to prevent workspace-link substitution.
- Fresh installation: empty dependency tree, explicit core/providers/Room pair, family overrides and CLI plugin reconciliation. npm-host preflight passes. Enabling the existing DSH delegation setting exposes `kimi-cli`, `codex-local`, `claude-local`, `dsh-cli`; DSH remains off by default until that setting is enabled.
- Upgrade baseline: the September 15 `+2609151443` tarballs on the same npm host. A real old Room was created with two members, a role instruction, a model selection, a goal and a task. Upgrade preserves these fields through a cold `room/getState` read. The profile retains `liveMirrorGranularity: event`; candidate composition accepts it. This alone is not a latency pass for migrated execution.
- Core, Room and Kimi client contributions are present in the composed graph and each returns HTTP 200 with the module-loader header (306635, 461037 and 46963 response characters respectively, `99247e47` candidate).
- Logged-in 3084 lab: replaced development links with these tarballs, then upgraded to the nine-package `80493f09` diagnostic candidate after build/test and isolated preflight. A normal install initially retained old links; saving the old node_modules/lockfile and reinstalling the explicit graph removed them. Actual installed versions and resolved paths were checked, then isolated preflight passed. Real continuation passes: Kimi delegates 19×21 to DSH (3.6 seconds), then consumes the automatic report and answers 399 (5.7-second report turn).

## Additional interruption probes

- Stopping the Kimi coordinator during simultaneous DSH generation leaves DSH streaming. That long DSH run later finishes with reasoning content only and no answer; the provider correctly rejects it as an answerless completion. This is not counted as a successful DSH completion, nor attributed to cancellation.
- Reverse isolation: stop the DSH worker immediately after admission while Kimi is generating. Kimi completes all 25 requested lines in 14 seconds; DSH remains cancelled.
- Abrupt restart: the isolated 3084 host is killed while goal `restart-reconcile-probe` is running at revision 53 with one admitted attempt. Cold state projects revision 54, paused, with the same attempt marked uncertain; no retry is launched. The old UI falsely keeps two run cards ticking and lacks ordinary coordinator-delivery reconciliation. `385da4de` adds read-only run projection and an evidence-gated UI entry. Real UI reconciliation passes: the coordinator interruption is abandoned after inspecting turn 23; resume is refused while the DSH attempt remains uncertain; that attempt is then reconciled as failed using its interrupted turn 14 as evidence. No second attempt runs. Ordinary Kimi chat resumes successfully. `5ddd3ac5` additionally settles the run card, labels unknown duration honestly, updates recovery reasons and retires queued deliveries of closed goals. The latest candidate projects zero queued deliveries for the cancelled test goal.

## Model reset and attribution

Kimi's model and effort defaults were exercised through the Room picker. The harness-default selection resolved to `kimi-code/kimi-for-coding` with high effort and generated successfully. Restoring the member's creation selection resolved to `kimi-code/k3` with high effort and also generated successfully. Native request/usage records confirm both transitions.

This probe found the message factory had hardcoded `k3`, so the transcript contradicted the otherwise correct controls. `99247e47` carries per-line native model metadata, uses the confirmed ACP model for live snapshots, and records unknown attribution when evidence is absent. Real candidate turns 27 and 28 now persist `kimi-code/kimi-for-coding` and `kimi-code/k3` respectively, matching their native records. Earlier persisted labels are deliberately not rewritten.

Immediately after the deliberate crash, DSH's read API included three synthetic interrupted-recovery events beyond the stored prefix. This is distinct from a normal final-flush loss. The subsequent successful member continuation persisted the recovered boundary and new turn normally; final full-history comparison passes at 266 DSH / 796 Kimi events without manual recovery.

## Remaining acceptance

- Complete native-arrival-to-foreground-paint dataset with replay distinguished; P95 ≤ 200 ms per supported native streaming harness.
- Remaining providers' model reset/default and frozen-eval runtime behavior (automated coverage exists).
- Real Codex and Claude login, generation, model control and Room tools in independent lab scopes; login request is pending.
- Final compatibility review and the remaining real harness matrix.
- Production installation and gated restart are a separate coordinated step.
