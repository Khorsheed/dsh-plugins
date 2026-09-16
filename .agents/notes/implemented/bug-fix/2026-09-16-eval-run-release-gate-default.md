# Agent Note: the release gate is what a run does, not a flag it was given (I5 · T57)

Status: implemented

English | [中文](2026-09-16-eval-run-release-gate-default.zh.md)

## Problem

Three findings, one mechanism underneath them.

**T33b, supplement two.** A container run without `--finalize` parked every cell at `archived`, and a cell at `archived` has not passed its release gate, so its container stayed. The third cell then held the third slot, and the fourth `acquire` met lab's `maxConcurrentUnits` (4) and was refused. A plan with more cells than that ceiling could not finish — which means the run loop's *default* was silently deciding how large a matrix was runnable, and the number it chose was four.

**T39 · G10.** The plan-review page's 批准并启动 had one button and no second option. Whatever the run loop defaulted to was what every approval got, and nothing on that page said what that was.

**T39 · G18.** After the walkthrough's `finalize`, two containers were still `Up`. Nothing in the interface said so; it was found by typing `docker ps`. The reason is worse than an oversight: `finalizeRun` moved the ledger and *only* the ledger. It never called `lab.release`. And because `isReleasable` reads the current state against the template's `releasableStates`, which is `['releasable']` alone, a cell that finalize had walked to `released` was past the only state any gate would authorize a destroy in. Those two containers could not be reclaimed by any non-forcing path that existed.

The flag was never the point. `--finalize` was introduced when v0 had no judge and could not fill the non-empty `verdicts/` the archive gate requires — stopping at `archived` was then the only honest default. Since T9 every cell is judged before it archives, so the gate normally says yes, and the old default had stopped meaning "we cannot pass the gate" and started meaning "we keep every container".

## Decision

**Walking the gate is what a run does.** Every cell, as it finishes, takes `archived → releasable → released` with its unit destroyed between the two transitions. Nothing about the gate itself changed: an empty `verdicts/` still refuses, the refusal is still recorded as `{kind: 'finalize-refused'}` on the cell, and nothing is forced. That is what makes the new default safe to state so plainly — it cannot release anything the gate would have refused when it was asked explicitly.

**`--keep-units` is the way back.** The CLI flag and the approve dialog's 保留单元 box (off unless ticked) ask for the old behavior: every cell stops at `archived` and keeps its container for someone to open. `RunOptions` carries both `finalize` and `keepUnits`, collapsed at one place in `runPlan` into a single boolean, with `keepUnits` winning when both are given — it is the more specific ask. `finalize: false` still works over the wire, so a CI caller can ask for the old shape without knowing the new word; `--finalize` is still accepted on both faces and means what the default already does.

**`finalize` reclaims the containers.** The walk now takes an optional unit face and destroys each passing cell's unit in the same place the run loop does. This is what makes `finalize` a real re-entry point rather than a ledger edit: reclaiming a container *is* its cell passing the gate. The face is optional because one caller genuinely has no lab — `dsh-eval finalize` drives the `dsh-mission` CLI in a child process — and that caller reports the unit list **unknown**, never `0`.

**A destroy that fails never strands its cell.** If `lab.release` throws after the gate said yes, the walk records `{kind: 'unit-retained'}` and *continues to `released`*. The alternative was worse than a leaked container: `releasable` is not a state finalize acts on, so a cell left there would be skipped as `interrupted` by every later walk and never move again.

**The report page counts what lab holds.** A new read verb `runUnits(runId)` returns lab's own list filtered to this run, joined with each cell's ledger state. The page shows the count at the top, a 回收 action when it is above zero — which is the `finalize` call again, not a second path — and a section listing each container with the cell state that says whether 回收 can still take it (`archived`) or only `dsh-lab release --force` can (`released`, a human's call).

**A refused acquire names the holders.** lab says "release a unit first" and nothing about which. `run.ts` wraps both `acquire` call sites and, on a `maxConcurrentUnits` refusal only, appends the run id, unit id, container name and cell of every unit holding a slot, plus the two commands that end them.

### Why the count comes from lab and not from mission

mission already reports `runStatus().unreleased`: the cells whose refs say they hold a resource. That is the ledger's *belief*. The case this page exists for is the one where the two disagree — a cell the ledger has released whose container is still up, which is exactly the G18 shape. A count derived from the ledger would have reported `0` for the two containers that were actually running.

`available: false` (no lab, or lab could not be asked) renders as 未知 rather than `0` for the same reason: a confident zero from something that never looked is how a held container stays invisible.

### Where the enrichment lives

Naming the holders is the orchestrator's job, not lab's. lab does not know what a run is, and giving it that vocabulary would move the wrong half of the boundary. The cost is a shallow seam: `run.ts` matches on lab's own wording (`/maxconcurrentunits/i`) to decide whether to enrich. If lab rewords the refusal the enrichment stops happening and the raw message still reaches the reader — a degradation, not a break. A typed error across the package boundary is the alternative, and it is a contract change to a package this task was scoped not to touch.

## Alternatives considered

**Keep `--finalize` opt-in and only fix the ceiling.** Queue the acquire, or raise `maxConcurrentUnits`. Both treat the ceiling as the problem. The ceiling is a safety valve doing its job; what was wrong is that a finished cell was holding a container it had no further use for. Raising the number would have moved the wall from four cells to eight.

**Make `keepUnits` the only knob and delete `finalize` from the options.** Cleaner surface, but `EvalRunRequest.finalize` is a wire field a CI caller may already send, and `--finalize` appears in saved commands and in the walkthrough log. Keeping both — collapsed at one place, with the precedence written down — costs one line of resolution and breaks nobody.

**Give 回收 its own verb.** A "release this run's containers" call that skipped the ledger would be simpler to implement and is precisely the force this seam refuses: a destroy reachable without passing the gate makes the archive mean nothing. One verb, two labels, because the reader's intent differs and the mechanism does not.

**Force the reclaim when the cell is already `released`.** It would have closed G18's two containers on 3171 in one click. It also builds a permanent path around the gate to solve a problem the fix upstream prevents from recurring: after this change a finalized cell's container is destroyed *during* the walk, so a cell can only be past the gate with its container up if the destroy itself failed — which is recorded, named, and rare. The remaining move stays a human's, and the page prints the exact command.

**Widen `finalize` to also act on cells at `releasable`.** It would let a failed destroy be retried by a second walk. It also changes what `skipCategoryOf` means and what an `interrupted` cell is, for a case that has a clearer answer (`--force`, by a person who has looked at the container). Left alone.

## Consequences

**A container run is no longer bounded by lab's ceiling.** Whatever the matrix's size, the run holds one unit at a time, because each cell's container dies as that cell passes its gate. That is the whole point, and it is what pilot B's three-cell round needed.

**Every default run now asks the gate, so a run with no verdict source writes a `finalize-refused` annotation per cell.** On the host path, where there are no containers to reclaim, that annotation is the only visible change — a plan with no probes and no judge records one refusal per cell where it previously recorded nothing. It is honest (the run asked, the gate said no, the reason is on the cell) and it is what "refusals are recorded, not forced" means, but it is new noise in the ledger of a run that could never have passed.

**What a run left behind is now a fact the interface carries.** Before, "are the containers gone?" was answerable only by `docker ps` on the instance. It costs one extra Remote read per visit to the report page, and that read touches a live daemon from a page that is otherwise a projection of an exported bundle — which is why it is a separate verb and a separate effect rather than a field on the report.

**A container whose cell is already `released` still needs a human.** The fix prevents that state from arising (the destroy now happens during the walk), but a run finalized by an older build, or a destroy that failed at the provider, lands there. The page and the walk both name it and print the exact `--force` command; neither will type it.

**The `maxConcurrentUnits` enrichment is a string match on another package's wording.** It degrades to the raw refusal if lab rewords, and nothing fails loudly when it does. Accepted as the cost of leaving lab untouched; a typed refusal is the upgrade path if the seam ever matters more than it does now.

## What changed

- `packages/eval/src/run.ts`: `RunOptions.keepUnits`; `finalize` documented as defaulting true; one `passGate` resolution; `run.meta.finalize` recorded so a bundle can tell "asked to stop at archived" from "broke off"; `acquireUnit` / `describeUnitHolders` and both acquire call sites.
- `packages/eval/src/finalize.ts`: `FinalizeUnitsFace`, `releaseCellUnit` between the two transitions, `heldUnitsOf` / `heldReasonOf`, and `unitsReleased` / `unitsHeld` / `unitsKnown` on the report.
- `packages/eval/src/service.ts`: `finalize` wires lab when mounted; `runUnits(runId)`; `approve` carries `keepUnits`.
- `packages/eval/src/remote.ts`: `runUnits`; `runStart` and `approve` carry the switch.
- `packages/eval/src/slash.ts`, `src/cli-core.ts`: `--keep-units`, `--finalize` accepted as the default, the container lines rewritten, and the CLI's finalize saying every time that it touched no container.
- `packages/eval/src/client/`: `fetchRunUnits` through the contract, store fields, the report page's units strip / section / 回收, the plan-review page's 保留单元 box, and the dictionary keys in both languages.
- `packages/eval/src/types.ts`, `src/faces.ts`, `src/report-view.ts`: the wire shapes, `LabUnitRow`, and the projection.

## Testing

- `packages/eval`: 705 tests green (681 before).
- `tests/run.spec.ts` — a three-cell container run over a `FakeLab` that enforces the real ceiling: with no flag at all all three reach `released`, `peakLive` is **1**, and the only forced release is the readiness probe's; with `--keep-units` all three stay `archived` with three containers up; and with a ceiling of 1 the refused acquire names the holding run, `u1 (dsh-lab-u1, cell …)`, and both commands. Plus `keepUnits` beating an explicit `finalize: true`, and `run.meta.finalize` either way.
- `tests/finalize.spec.ts` — the destroy lands **between** the transitions (the fake lab's gate refuses at `archived` and at `released`, so the order is the assertion); a gate-refused cell keeps its container with the gate named as the reason; a cell already `released` is reported as a human's call and **not** forced; a failed destroy leaves the cell at `released` with `unit-retained` on it rather than stranded at `releasable`; another run's units are untouched; no face and an unreachable lab both report `unitsKnown: false`.
- `tests/report-face.spec.ts` — `runUnits` filters to the run and joins each cell's state; no lab and an unreachable lab both answer `available: false` with the reason.
- `tests/Report.client.spec.tsx` — the count, the per-container list with its cell state, 回收 confirming once and landing on the same `finalizeRun` call, no button when nothing is held, and 未知 (never `0`) with no lab.
- `tests/LabReview.client.spec.tsx` — 保留单元 off by default and carried into `approvePlan` when ticked.
- `tests/slash.spec.ts`, `tests/remote.spec.ts` — the switch through both faces, `--finalize` still accepted, and the CLI-face finalize saying the containers were not touched.
