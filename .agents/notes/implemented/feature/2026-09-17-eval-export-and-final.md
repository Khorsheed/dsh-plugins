# Agent Note: one export action, and the last mile of steps 6–8 (I5 · T60)

Status: implemented

English | [中文](2026-09-17-eval-export-and-final.zh.md)

## Problem

The I5 walkthrough (T39) drove the whole eight-step flow through the interface and counted every time a person had to touch something. The chain held: a sentence went in, a draft came out, a human approved it, two cells ran in containers, the four invariants held and the comparison opened. What did not hold was the **last mile of the artifacts**. Six of the seventeen human interventions were gaps, and five of them sit in steps 6, 7 and 8:

- **G15** — the report page's 导出 wrote the bundle, and `report/summary.md` was still a command line the reader had to go and run (`dsh-eval report <bundle>`). A walkthrough with every surface on screen ended at a terminal.
- **T53** — a bundle exported with `--out <dir>` left no trace on the run. `run.meta` names the plan and the repository and the bundle is under neither, so the report page called an exported bundle 未导出 and offered a text box to type the path into.
- **G17** — the bundle is exported when the run ENDS; the final verdicts are written afterwards, from the judge bench, and never travel into a directory already on disk. The walkthrough discovered this by opening `manifest.json` and noticing its `exportedAt` predated the human-final by minutes. Neither page said anything.
- **G11** — `runStart` answers with a run id before `runCreate` has been called, so the refresh an approval fires reads a list with no run on it. The matrix and the cells pages sat on "Not started yet" while the overview said `Running`; one press of Refresh fixed everything, which is the worst kind of bug.
- **G16** — at step 8 the agent writes an analysis of the bundle, and that analysis belongs in the dataset repository. The session's workspace is not that repository, so `write` hit the sandbox and asked a person to approve an escalation to `danger-full-access`: the whole machine, opened once, to save one markdown file.
- **G13** — the tab strip of a member sub-session carried **Missions**, which the main session correctly hid. The self-hide criterion reads the CURRENT session's preset, and a player's delegation session declares none.

None of these is about the flow's skeleton. Every one is about a file, a field, or a sentence at the end of a step.

## Decision

### An export writes the bundle, the report inside it, and a note saying where it went

`EvalService.exportRun` still forwards the guarded-layer gate to mission's Remote unchanged — that gate is mission's and a second implementation of a leak gate is a second place for it to be wrong. What eval adds is the half that was missing: after mission writes the bundle, `writeEvalReport` writes `report/summary.md`, `results.jsonl` and `usage.jsonl` INTO it, by the same function `dsh-eval report` calls. The CLI verb stays — a bundle from anywhere still needs a way to get a report — but the page no longer ends with one. The run loop's own end-of-run export does the same, so the bundle a run leaves behind carries its own summary.

Both are **best-effort around an artifact that already exists**: a report that cannot be rendered does not unexport a bundle. The failure travels in the answer (`reportError`, and the receipt prints the command), because a silent half-success is exactly what sent a reader to a terminal to find out.

### The export note: a run-level fact through a per-cell door

`src/export-note.ts` records what was exported and where: the export directory, the bundle directory, the time, the layers, and the snapshot reference. It is a run-level fact, and mission has no run-level door — `annotate` takes a mission id and `run.meta` is frozen at `runCreate`. So the note is **written narrow and read wide**: written on the run's first cell in the `orchestrator` namespace, read by scanning every cell for the newest. A run with no cell records nothing and the page falls back to the directory candidates, which is what it did before.

The report page tries the noted directory **second**, after the one a reader typed in this visit and before the plan's `exports` and `<repo>/exports`. That is T53: a `--out` bundle is reachable again, and the "look in another directory" box is a fallback rather than the only way back.

### A bundle older than the final verdicts says so, with the button beside the sentence

The report page shows the bundle's own `manifest.json` `exportedAt` — the manifest and not the note, because that is the timestamp of the FILES — and compares it with the run's newest `human-final`. Older means one plain sentence naming the verdict's time and an **Export again** button. The judge bench carries the same pair, decided from the ledger's two timestamps alone (no disk read on a page that re-renders after every verdict): the page that WRITES the verdicts is where this belongs.

**Export again repeats; it never widens.** It reads the run's note and re-issues exactly that export — same layers, same snapshot reference, `confirmed: []` — into a fresh directory. Nothing guarded is re-confirmed, and mission still re-checks the layer set against a fresh plan, so a layer that became guarded meanwhile refuses the whole call and sends the reader to the dialog to tick it on purpose. The fresh directory is `<original outDir>/re-<UTC stamp>/`, because mission names a bundle `<outDir>/<runId>-bundle` and eval cannot rename it: moving the PARENT is the only lever that leaves the first bundle byte for byte where it was. Somebody may have quoted from it.

### The detail page waits for the run it just started

After an approval, while the open row still has no run id, the view re-reads the list every 4 s and stops the moment the id appears — a wait with an end, not a polling cadence, and bounded at 15 re-reads because a run the readiness gate REFUSED never reaches the ledger at all (its refusal is in the job log the overview already shows). Meanwhile the four run-scoped sub-pages say 正在启动 rather than 未开始: the receipt named a run, so "not started" was false as well as unhelpful.

### `eval_repo_write`: the analysis draft's own door

The row's second write, and a new tool rather than an extension of `eval_plan_draft`. It writes ONE text file into the session's bound repository, against a whitelist hardcoded in `src/repo-write.ts`:

- `docs/<path>` — the repository's own documentation, outside `datasets/` entirely.
- `datasets/<set>/plans/<path>`, `datasets/<set>/conditions/<path>` — the pass-through files drafting already writes.
- `datasets/<set>/analysis/<path>` — per-experiment analysis drafts, for a repository that would rather keep them beside the set.

`datasets/<set>/items/…` is **not** on the list, at any depth or spelling — no task text, no `standards.yml`, no rubric, no oracle — whatever the binding admits for READING. An evaluation's subject matter is not something the drafting agent edits. String checks (`..`, absolute, `~`, an unlisted prefix) run before any filesystem call; the disk is consulted only to confirm that a path which already passed does not leave the repository through a symlinked directory. The repository resolves through the same `resolveRepoScope` every agent verb uses, so T58's narrowing applies here too: `repo` may only restate the binding. Nothing is overwritten without an explicit `overwrite`, an empty body is refused, and every refusal quotes the path and the whole whitelist back — "denied" without either is how an agent starts guessing at paths.

### The self-hide criterion follows the parent chain

`effectivePresetOf` walks `parentSessionId` when a session declares no preset of its own, bounded and cycle-guarded. A session with neither a preset nor a parent still fails open, exactly as before. The same edit lands in eval, mission and datasets — three copies of one criterion (the M3' deferral keeps them inlined), and the acceptance criterion for G13 is specifically that **Missions does not appear** in an evaluation's member sub-session, which is mission's copy.

## Alternatives considered

**Extend `eval_plan_draft` instead of adding `eval_repo_write`.** Rejected. That tool's contract is "a plan and the conditions it names, validated" — every refusal it has is about a contract, and it is `isConcurrencySafe: () => false` because two drafts race on one `plans/` directory. Folding a free-text markdown write into it would make one tool with two unrelated jobs, needlessly serialize note writes behind drafting, and — the part that actually matters — put "drafted an experiment" in the tool ledger and the capability catalog for a call that wrote an analysis at step 8. A separate verb can carry its own whitelist, its own refusal wording, and one sentence of prompt guidance pointing straight at it.

**Overwrite the bundle in place on a re-export.** Rejected: the first bundle is an artifact a person may already have quoted from, and `exportedAt` is the field a reader compares. A second export is a NEW artifact of the same run at a later time; making it destroy the earlier one to avoid a nested directory trades a real guarantee for tidiness.

**Teach mission to version its bundle names.** Rejected for this task: the bundle's name is mission's vocabulary, and changing it moves a shared contract (the CLI, the export dialog, every reader that globs `<runId>-bundle`) to solve an eval-side problem eval can solve by choosing a different parent directory.

**Give the report page a "write the report" button separate from 导出.** Rejected. It keeps the two-step shape the gap is about; a reader who exported would still have to know the second button exists. One action with two products is the fix.

**Make the wait for the started run a general poll.** Rejected — the brief is explicit that the polling cadence does not change, and a general poll would re-read the list forever on a refused run. The wait arms only in the window between the approval receipt and `runCreate`, and disarms on the run id.

**Widen the write door to the whole repository minus `items/`.** Rejected: a deny-list has to be right about every future directory a dataset repository grows; an allow-list has to be right about four. The grant is narrower than the walkthrough's actual need, and widening it later is one line plus a test.

## Consequences

The bundle a run leaves behind now carries its own report, and both pages that can produce one say what they wrote. A `--out` bundle is findable from the run again. A reader who records a final verdict is told, on the page where they recorded it, that the bundle does not have it yet — and the fix is one click that cannot widen what the first export confirmed. Step 6 costs no Refresh, and step 8's analysis draft costs no sandbox escalation.

What it cost: three new surfaces to keep honest (the note's shape, the whitelist, the parent walk), and a nested `re-<stamp>/` directory that is uglier than a versioned bundle name would be. The note is eval's own record and says nothing about a bundle exported by `dsh-mission export` or copied from another machine — which is why the staleness comparison reads the manifest, and why a run with no note offers the dialog rather than a repeat. The parent walk changes visibility in three packages at once: a sub-session that used to show a tab now inherits its parent's answer, which is the intended fix and also a behavior change for any host that creates preset-less child sessions for other reasons.

## Testing

`packages/eval/tests/export-note.spec.ts` (15) — the note written narrow and read wide, the newest of several winning, a malformed payload ignored, the human-final timestamp from the same pass, a run with no cell not failing an export, the re-export directory's naming, the noted directory's place in the candidate order, the four freshness fields over real bundles (including a bundle newer than the last verdict, which is not stale), one export writing `summary.md` and the note, a repeat landing in a new directory with the first left on disk and the recorded layers re-issued unwidened, the refusal when there is nothing to repeat, and the judge bench's own `bundleStale`.

`packages/eval/tests/repo-write.spec.ts` (11) — every allowed prefix accepted, every spelling of an item's material refused, escapes refused before the disk is touched, a symlinked directory that leaves the repository refused, the binding's dataset whitelist honoured, the overwrite rule, the empty body, T58's narrowing on this verb, and a refused write leaving the target file byte-identical.

`packages/eval/tests/LabReview.client.spec.tsx` (+3) — the sub-pages saying 正在启动, the wait re-reading until the ledger has the run and then stopping, and the bound. `Report.client.spec.tsx` (+5) and `Judging.client.spec.tsx` (+2) — the export time and the summary line, the stale sentence with its button, the disabled repeat with its reason, and the dialog receipt naming the report. `apply.client.spec.ts` in eval, mission and datasets (+4 / +2 / +2) — a member sub-session decided by its parent, in both directions, plus the no-parent and the cycle.
