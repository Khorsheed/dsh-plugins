# Agent Note: what pilot A proved the orchestrator was missing — a re-entry point, a liveness probe, and a record of what actually ran

Status: implemented

## Problem

Pilot A was the first real run of the web-eval orchestrator: two harnesses × two items × three reps, driven end to end through `/eval run`. It produced usable data and four gaps, all of them in the orchestrator rather than in the dataset or the harnesses.

**There was no way back into a finished run (G13).** `/eval run` stops at `archived` by default, and `--finalize` exists only at the instant the run starts. But judging and final review are exactly the work that happens *after* archiving — the normal order is archive, review, then release. A run that had already stopped had no `dsh-eval` verb at all, so twelve cells were pushed to `released` by hand, one `dsh-mission transition` at a time.

**The pre-run check believed a status field that cannot know the answer (G4).** `/claude-code status` reported `authenticated: yes` while every delegation on that condition returned 401. `isAuthenticated` reads whether the scoped home holds a credential record of the right *shape*; an expired, unrefreshable grant has exactly that shape. In an evaluation this is the worst class of false positive: six of twenty-four cells were doomed before anything started, and the failure only became visible at the first delegation, after the run had been created and the matrix ordered.

**The efficiency table compared numbers that were not comparable (G15).** It summed delegation `durationMs` over *all* of a condition's current cells. One dsh cell had run stage one and stopped, so its delegation time counted toward a condition that had done less work — and the two harnesses came out at 21.0 min each. The tie was an artifact. A reader could not tell, because nothing in the summary said which cells the numbers covered.

**A partial run looked exactly like a complete one that lost cells.** Pilot A ran 12 of a designed 24 cells because two harnesses were blocked for account reasons. The only way to shrink a run was to stop the session, and `run.meta` recorded nothing about why the bundle held twelve missions instead of twenty-four. The plan document said 24; the bundle said 12; nothing connected the two.

A fifth gap sits at the plan/dataset seam: `expectedNs` is a claim about which verdict sources will produce something, and pilot A's F3 declared `script` while shipping no executable probe and `llm-draft` against a rubric with no leaves. Both sources came back silently empty, which only surfaced when the archive gate refused the cells (G6, the plan half).

## Decision

Five changes, all inside `packages/eval`.

**`finalize` is a verb.** `finalizeRun(mission, runId)` walks every `archived` cell of a run through `archived → releasable → released` — the same two edges and the same archive gate `--finalize` takes — and reports every cell that is not `archived` with its state. It is reachable as `/eval finalize <runId>` (service face `EvalService.finalize`) and as `dsh-eval finalize <runId>`.

Two negative guarantees define it. It **never forces**: a gate refusal is recorded as `{kind: 'finalize-refused', from, error}` in the orchestrator ns and the cell stays where the gate stopped it, because the gate's non-empty `verdicts/` requirement is the reason an archive means anything. And it **never touches a cell below `archived`**: a pending or mid-stage cell is unfinished work, not un-released work, and quietly releasing one would erase the distinction the state machine exists to draw. Skips are classified `already-released` / `interrupted` / `not-started`, which is what lets a twelve-cell run summarize as one line.

**Readiness is one real delegation per condition.** Before `runCreate`, each plan condition is probed with a byte-exact one-sentence prompt (`READINESS_PROMPT`: reply `READY`, no tools, no files) through the same facade, provider, and per-directory `cwd` rule the cells use. A condition is ready only when the delegation both started and returned `stopReason: 'completed'`. The probe also reads the model back and fails the condition when it contradicts `model.declared` — frozen decision 5, caught before the run exists rather than at the first stage round.

Each verdict is a `{kind: 'readiness', condition, harness, provider, ok, startedAt, durationMs, childSessionId, declaredModel, observedModel, reason?}` record, written both to `run.meta.readiness` and as an orchestrator-ns annotation on every cell of that condition. Any failure refuses the whole run and prints the reason — the 401 itself, not "a condition failed". `--ignore-readiness` starts anyway, and then every cell of the failed condition is recorded `cell-skipped` with the reason and never delegated to.

**The efficiency table counts completed cells only.** `efficiencyOf` filters to `COMPLETED_STATES` (`judged` / `archived` / `releasable` / `released`) before summing anything. Condition ids still come from *all* current cells, so a condition whose every cell is unfinished appears in the table with blanks rather than disappearing from it. What was excluded is printed under the table as `EvalReport.efficiencyExcluded`, grouped by condition and state. `results.jsonl` is untouched — the change is to the efficiency *aggregate*, not to which verdicts exist.

**A subset is recorded, never implicit.** `--only <missionId,…>` and `--max-cells N` select part of the seeded order; the selection lands in `run.meta.subset` (`{only, maxCells, totalCells, selectedCells}`), and the report's procedure invariant prints it. The generated template carries exactly the selected missions, so the ledger never holds a cell the run will not drive — an unselected mission sitting `pending` forever would read as abandoned rather than as never chosen. The plan contract gains no field: a subset belongs to one execution, not to the reviewed program, and putting it in the plan would change the plan sha and with it the meaning of "same plan, same program".

**`validatePlan` cross-checks `expectedNs` against the items.** Declaring `script` with no `.mjs`/`.sh` under the item's `verify/…/probes/`, or `llm-draft` with no rubric or no `kind: llm-draft` leaf, are warnings (`EXPECTED_NS_NO_PROBE`, `EXPECTED_NS_NO_RUBRIC`, `EXPECTED_NS_NO_LLM_DRAFT_CRITERIA`, `EXPECTED_NS_RUBRIC_UNPARSEABLE`). Warnings rather than errors: whether an empty source is acceptable is the reviewer's call, and refusing would make the drafting loop unusable. Only the conventional `items/<id>/{verify,grading}` layout is inspected; a dataset that re-homes its layers is left alone rather than reported on a guess.

### Module topology

`awaitObservedModel` moved out of `run.ts` into `readback.ts`, because the readiness probe needs the same bounded post-settle wait and `readiness.ts` must not import the run loop (readiness runs *before* a run exists). `finalize.ts` and `mission-cli.ts` are new; `MissionFinalizeFace` sits in `faces.ts` beside the two existing mission faces, structurally narrow enough that both `ctx.mission` and the CLI-backed face satisfy it.

### Why the CLI shells out

Outside a host there is no `ctx.mission`, and eval imports nothing from a sibling `@khorsheed/*` package. A child process is the only remaining seam — and it is the same seam a person uses by hand, which is precisely what pilot A had to do. `missionCliFace` parses `dsh-mission list --run`'s row format for the projection and drives `transition` / `annotate` as child processes, selected by `--mission-cli` or `$DSH_MISSION_CLI`.

## Alternatives considered

**Let `finalize` also push a `releasable` cell to `released`.** Rejected: a cell at `releasable` is mid-gate, which only happens when a previous finalize was cut short, and quietly completing it would hide that. It is reported as `interrupted` and left alone; a person who wants it moved has `dsh-mission transition`.

**Give `finalize` a `--force` for a refused gate.** Rejected outright. The archive gate's requirement is that a cell carry judged evidence, and a flag that releases a cell without it makes `released` mean nothing — the exact property the whole state machine is built to protect.

**Make the readiness probe write a file, so it also proves `cwd` support.** Rejected: it would conflate "this condition cannot authenticate" with "this facade predates the cwd option", and the run loop already detects the second honestly (the stage files are absent and the cell is refused, never mis-attributed). The probe answers one question, so its failure has one meaning.

**Add a liveness field to `local-agent`'s status instead.** The right long-term fix, and pilot A's own G4 note proposes it — but it is local-agent's change, this task's constraint is not to touch that package, and eval should not trust a status field for this even once one exists. The probe is what the cells will actually meet.

**Trust `status.authenticated` and probe only when it says no.** Rejected: that is the failure. The field said yes throughout.

**Skip the probe when the plan has many conditions, to save the delegations.** Rejected: the cost is one short round per condition, against a run that spends tens of minutes per cell. Pilot A spent six doomed cells to learn what one probe would have said.

**Record the subset in the plan document.** Rejected: `planSha` is the identity of "the same program", and a plan that changes when a person decides to run half of it would break that. The subset is a property of one execution and belongs in `run.meta`.

**Keep unfinished cells in the efficiency table but mark them.** Rejected: a marked-but-included number is still summed into the column a reader compares. Excluding them and printing what was excluded gives the same information without a number that invites the wrong comparison.

**Make the `expectedNs` cross-check an error.** Rejected: a plan may legitimately name a source an item will supply later, and an error would stop the agent's drafting loop on a judgment call that belongs to the reviewer.

**Have `dsh-eval finalize` read mission's `run.json` directly instead of shelling out.** Rejected: it would make mission's on-disk layout part of eval's contract. The report already reads a *bundle*'s `run.json`, but a bundle is an export format with a stated contract; the live ledger is mission's private state.

## Consequences

- A run that stopped at `archived` now has one verb to finish it, in-session or from a script. Pilot A's twelve-cell hand walk is a single command.
- Every run costs one extra delegation per condition before it starts, and a run whose conditions cannot delegate now fails in seconds instead of after the first cell.
- The pre-run misattribution check means a facade that reads back the wrong model is caught before any cell exists; the run loop's own mid-run guard stays, because a model can change between the probe and a later round, and the two are now tested separately.
- Efficiency numbers changed for existing bundles. Re-running `report` on the pilot A bundle moves dsh-exec from 21.0 min / 3 rounds to 11.9 min / 2 rounds; the 21.0-vs-21.0 tie is gone. `results.jsonl` is byte-identical, so nothing downstream of the verdict rows moves.
- `run.meta` gained `subset` and `readiness`. A bundle written before them prints nothing about a subset rather than claiming a full matrix — absence means unrecorded, not complete.
- Bundles written before this change still report: every new field is read defensively and its absence degrades to silence.
- `dsh-eval finalize` depends on a `dsh-mission` binary being reachable. When it is not, the error names `DSH_MISSION_CLI` rather than reporting a spawn failure.
- Verified against the real ledger: `dsh-eval finalize` on a copy of pilot A's run reports 3 already-released, 2 interrupted, 7 not-started and writes nothing; on a purpose-built run with two archived cells it releases the one whose `verdicts/` is non-empty, records `finalize-refused` on the one whose is empty, and leaves that cell at `archived`.
