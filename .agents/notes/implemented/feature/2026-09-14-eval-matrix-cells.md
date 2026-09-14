# Agent Note: the matrix page, the cells page and the cell drawer (I5 · T35b)

Status: implemented

English | [中文](2026-09-14-eval-matrix-cells.zh.md)

## Problem

T35a gave the 实验室 tab its list and a seven-sub-page shell with only the overview filled. Step 6 of the eight-step flow — *the orchestrator executes cell by cell, and a person watches* — had no surface at all: the matrix that makes a comparison legible, the cell list that replaced the missions queue, and the drawer where the three human gestures live (re-run with a reason, ask the release gate, export the bundle).

Two constraints shaped every decision. ui-spec R2: the cells and their detail are a projection of mission's ledger, the frontend reads only eval's own Remote, and it imports nothing from mission. And the leak gate: `exportRun` is the one verb in this whole tab that can put an answer key on disk.

## Decision

- **The matrix's arrangement is a pure function**, `pivotMatrix` in `matrix-view.ts`, unit-tested on its own. Rows are always the item; the columns are the ONE factor the reader picked; remaining factors either band the rows (`groupBy`) or are pinned (`filter`). The factor set is not invented — it is `conditionFactors` over the run's own `run.meta.conditions` documents, the same leaf comparison `conditions diff` uses, so the matrix and the diff can never name different factors.
- **A factor that is neither the column nor banded nor pinned rides along inside the cell**, and that cell's condition list then names more than one id. The alternative — silently showing one of them — would let a reader compare two subjects while believing they compared one.
- **The four things in a cell** are the spec's: rep dots (`filled` at `judged` or past it, `empty` at `pending`, `half` in between — the same `isJudgedOrBeyond` predicate the status rule uses), the stage (the state the reps agree on, else `mixed (a / b)`), the stuck flag, and the item-material agreement.
- **Stuck is time-in-state past a threshold (30 min default) AND not settled.** The counter keeps running on a settled cell — that is mission's own duration column — but "nothing has happened here for a while" stops being a problem once nothing further is due.
- **The red edge points at the outlier, not at the row.** Per item, the reference hash is the most frequent one with ties broken by sort order, and the cells that differ from it are marked; an unread hash is `hashUnknown`, never a mismatch. The digest is read from the `materialization.json` the run loop itself wrote under `<dataDir>/runs/<runId>/data/<missionId>/attempt-<n>/`, so this is a shared convention rather than a guess — and a mission face without `dataDir` reports `unverifiable`.
- **The run-level summary borrows the report's vocabulary** (`ok` / `violated` / `unverifiable`) for item material and environment fingerprint, and prints `待报告` for judge consistency rather than computing it. Consistency is the report's calculation; a matrix that guessed at it would be believed.
- **The cell drawer** carries the attempts (with the retry reason that opened each), checkpoints, artifacts, refs, one line per annotation namespace (count + newest digest + writer), the verify output **verbatim**, the child session, and the live release answer.
- **The verify output is the orchestrator's `kind: 'probes'` annotation, shown whole.** There is no `lab` annotation namespace on this line: the probes run through `lab.verify` on the container path and directly on the host path, and the orchestrator is what records them. Reporting them as "lab's" would name a source that does not exist, and summarizing them would drop the exit codes and the "not applicable this round" reasons that are the only reason to open the drawer.
- **The export gate stays on mission's side.** `exportPlan` / `exportRun` forward to `ctx.missionRemote` — mission's own Remote service, host-side — through a structural `MissionExportRemoteFace`. That keeps the datasets probe that decides which layers are guarded AND the fail-closed re-check against a fresh plan in exactly one place. eval relays the caller's `confirmed` list and can neither widen nor narrow it; a composition without mission's Remote is refused outright rather than getting the gate re-implemented here.
- **`retry` refuses a blank reason in eval** rather than leaving it to mission. Not a second gate — the same one, stated where the caller is, so the tab and the service agree about what an attempt must carry.
- **`runsForItem(datasetId, itemId)`** lands now even though its consumer is T47: it is the same ledger walk `experiments` already does, matched by the `task` label and `meta.datasetId`, and building it beside them keeps one implementation of "which cells belong to this item".
- **The child session is opened with the host's `sessions.open`**, injected from the client entry. eval's Remote only reports the id.

## Alternatives considered

### Why not let the reader put items on the columns?

Because a matrix is read across a row. With items on the columns, a row becomes "condition X against several different questions", and the eye still compares along it — which is comparing answers to different questions. Fixing rows to items makes the only available comparison the valid one. If a run ever needs the transpose, that is a spec change, not a toggle.

### Why not re-derive the guarded layers and re-check them in eval?

That was the shorter path: mission's *service* exposes `planExport` / `exportRun`, and the guarded resolution plus the fail-closed check live one layer up in mission's Remote. Copying them would have given eval a self-contained export and a second leak gate. Two implementations of a gate means two places for it to be wrong, and the one that is wrong is the one nobody re-read. Forwarding to `missionRemote` costs an optional structural face and one honest refusal when the Remote is absent.

### Why not summarize the probe output?

Because the drawer exists for the cases where the summary is the problem: exit code 2 with "not applicable this round" reads as a broken probe in any count-based summary, and that exact confusion is what T28 fixed in the counting line. The compact per-probe list is there for scanning, and the raw payload under it for believing.

### Why not compute the matrix in the browser?

The client bundle's purity gate forbids importing mission, so the ledger rows would have to travel raw and the arrangement be re-derived — in a second place, with a second answer to "why is this cell red". Host-side keeps one implementation for the tab, the `eval_cells` tool, and whatever T38 needs.

### Why does `cells` restate the row type instead of re-exporting `RunCellsReport`?

Every Remote boundary type must be reachable from the `./types` subpath. Re-exporting the host-side read module's types would drag `node:fs` and the whole validate/schema chain into the browser half's type program for no gain. The PROJECTION is still one function — `cellRows` narrows what `cells` returns — so only the wire shape is restated, and the test pins that it matches.

## Consequences

- `EvalRemoteService` grows eight verbs (`matrix`, `cells`, `cell`, `retry`, `releaseCheck`, `exportPlan`, `exportRun`, `runsForItem`), all session-scoped. The four CI verbs are untouched.
- `MissionAttemptFace` gains optional `artifacts`, `retry` and `history`; `MissionReadFace` gains an optional `dataDir`, `title` and `labels`, and its annotations an optional `by`. All optional: a ledger that answers less reports nulls.
- Two new structural faces: `MissionActionFace` (retry + isReleasable) and `MissionExportRemoteFace` (mission's Remote, for the export pair). mission itself is unchanged.
- `EvalService.cell` is `async` so its refusal is a rejection rather than a synchronous throw behind a `Promise` signature.
- The `matrix` and `cells` locale placeholders are gone; four sub-pages still carry one (T36, T38, T37).
- T47 inherits `runsForItem`; T38's report page inherits the summary vocabulary.

## Testing

- `packages/eval`: 559 tests green (510 before). `tests/matrix-view.spec.ts` — 18 cases over the pure pivot: the factor union and the column choice, rows-are-items, banding (and never by the column itself), the filter dropping non-matching conditions, the ride-along factor, holes vs. empty cells, the mixed stage line, the stuck rule with the settled-cell exemption and a caller threshold, the outlier-only red edge, unknown-is-not-mismatch, and every summary branch including `待报告`. `tests/cells-face.spec.ts` — 19 cases over the projection and the three gestures: the annotation digest, the verbatim probe payload (success and failure rounds), the full cell detail, the material digest read from a real run-data tree and its absence, the release answer, the two refusals, `cellRows` narrowing, retry forwarding with the caller tag, the blank-reason refusal, and the export pair including "an unconfirmed guarded layer is still refused through eval". `tests/MatrixCells.client.spec.tsx` — 12 cases: the matrix's rows/columns/dots, the two warnings and the summary, re-arranging by column and by band, a dot opening the drawer, the cell table and its bucket filter, the drawer's fields including the raw probe block, retry (and the disabled blank-reason button), the release check, `sessions.open` (and the disabled button without a child session), and the export dialog's plan → confirm → export walk plus the confirmation void on edit.
- `pnpm gate` green.
