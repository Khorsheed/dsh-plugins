# Agent Note: the report page — invariants, pairs, efficiency, consistency (I5 · T38)

Status: implemented

English | [中文](2026-09-14-eval-report-page.zh.md)

## Problem

Step 7 of the eight-step flow — *finalize · judging · report* — had no surface. The analysis itself was already written and frozen: `analyzeBundle` reads a mission export bundle and answers the four invariants, the derived factors, the paired deltas behind their gate, the judge consistency numbers and the parallel efficiency table. What was missing was a page, and `dsh-eval report <bundleDir>` was the only way to see any of it — a CLI call, against a path a reader had to know, producing files nobody asked for.

The risk in building that page is not layout. It is that a report is the one screen in this tab whose whole value is that it refuses to say more than the evidence supports: comparison is gated on four invariants, ranking on n ≥ 3, tokens on same-model, and a judge that judged its own model is disclosed rather than dropped. Every one of those rules could be quietly undone by a projection that sent the numbers anyway and left the page to remember the rule.

## Decision

- **`report` is a projection of an EXPORT, and it finds the export itself.** `runReport(runId, {outDir?})` resolves the bundle in a stated order — the directory the caller just exported into, the plan's own `exports`, then `<dataset repo>/exports` (decision 11) — trying `<runId>-bundle` under each, and hands the first hit to `analyzeBundle`. Nothing is recomputed.
- **"Not exported yet" is a state with a button, not an error.** A run with no bundle answers `bundleDir: null` plus **every directory that was looked in**, and the page renders that sentence and an export button. Those two facts are what tell a reader whether a run is un-exported or broken; an empty section or a thrown RPC tells them neither.
- **The comparison gate shuts host-side: `pairs` is EMPTY when `comparisonAllowed` is false.** The numbers do not cross the wire at all. The alternative — sending pairs beside a boolean — makes the honesty rule a client-side `if` that one future edit can drop, and the section it guards is exactly the one a reader wants most when an invariant failed.
- **`report` writes nothing.** `dsh-eval report --out` remains the only way `results.jsonl` / `summary.md` / `usage.jsonl` land on disk, and the page carries that command as a hint. Opening a page must not create files, and where a run's archived artifact goes is a human's decision.
- **The self-judged mark belongs to the ROW, not to the cell.** A paired row is one number over both sides' cells; if any of those cells was judged by its own model, the row is marked. A mark that appeared on only some of the cells behind one number would warn about nothing.
- **A dash is not a zero.** `toolCalls: null` (no round reported an accounting) and `cacheReadTokens: null` render as `—`. "Nobody counted" and "it used none" are different facts and only absence can say the first.
- **κ that is NaN crosses as `null`.** Cohen κ is NaN in the degenerate case (constant raters). JSON has no NaN, so it would arrive as a quiet null anyway; converting it at the projection is where the reason can be written down.
- **`finalize(agent, {runId})` is a human's click, tagged `tab:<sessionId>`,** and it answers with the counts, every cell's outcome AND the walk's log verbatim. A gate refusal a reader cannot read is a refusal they cannot act on. The page asks once before walking: it is a run-wide write initiated from a reading screen.
- **The export dialog now reports the directory it wrote into**, and the tab remembers it for the report's first lookup. The dialog takes a free-text path, so without that a reader who exported outside the plan's `exports` would be told 未导出 about a bundle they had just written.
- **The un-exported state also takes a directory to look in.** Found on the real instance, not in a test: `t31-judge-panel` was run with `--out`, so its bundle sits under neither the plan's `exports` nor `<dataset repo>/exports`, and `run.meta` records nothing about where the export went. Without a box, the page would call an exported bundle 未导出 and the only way out would be to export it a second time.
- **Two facts beyond the four sections in the brief ride along**, because `summary.md` leads with them and dropping them would make the page less honest than the file it mirrors: the `tool:`-only expectedNs red flag, and the report's own reservations.

## Alternatives considered

### Why not send the pairs with `comparisonAllowed` and let the page hide them?

It is the smaller payload change and the obvious shape. But the four invariants are the reason this report is worth reading: they are what stops a run with two different environments from producing a ranking. A boolean beside the data it gates puts that rule in the renderer, where it survives only as long as nobody refactors the section. Withholding the data makes the rule structural — the page *cannot* show a delta the bundle refused, and the test that pins it asserts absence rather than a CSS class.

### Why not call `service.report` and read `ReportWrite.report`?

That is the existing entry point and it returns exactly the analysis needed. It also writes three files into the bundle as a side effect. Rendering a page must not modify what it renders — a reader who opened the tab twice would have rewritten the bundle's `report/` twice, and a bundle that is supposed to be append-only evidence would carry files nobody asked for. `analyzeBundle` is the same computation without the write, and the CLI hint keeps the writing path one command away.

### Why not record the bundle directory in `run.meta` at export time?

It would make the lookup exact instead of a search. But the export is mission's verb, not eval's, and a person may export the same run repeatedly into different directories (that is what the dialog is for). A recorded path would name one of them and be wrong about the rest, and it would need a ledger write on a path that currently has none. The search order is three candidates, each of which a reader could have chosen deliberately, and the answer names all three when it finds none.

### Why not recompute the judge tags client-side from `judgeAssignments`?

The page already receives the pairs; shipping the whole assignment list and joining in the browser would have been one less host-side function. It also means "which judge is behind this number" gets answered twice — once in `summary.md`'s own assignment table, once in the tab — and the two can disagree the moment either changes. The join is eight lines in the projection, and it puts the answer next to the number it qualifies.

### Why not a modal for finalize?

The tab has one modal already (export) because that gate demands per-layer acknowledgement. finalize has one question, and the gate it walks never forces — a refused cell stays where it is and says why. A two-click inline confirm asks the question without a second surface, and the outcome lands on the same page rather than behind a dismissed dialog.

## Consequences

- `EvalRemoteService` grows two session-scoped verbs, `report` and `finalize` (20 total). The four CI verbs stay untouched, and neither new verb is a model tool — the starting and releasing verbs belong to the interface (ui-spec R1).
- `EvalService` grows `runReport` and `finalizeView`; `report-view.ts` is new and holds the bundle search, the projection and the finalize reshape.
- The report sub-page is built; `placeholder.report` is gone and the judging desk is the last placeholder (T37).
- `ExportDialog`'s `onDone` now carries the output directory as a second argument, and the store remembers it as `lookIn` (cleared per experiment), which the report page can also set directly.
- T37 inherits the page's vocabulary: the judge-consistency block and the self-judged mark are the same facts its desk will show per cell.

## Testing

- `packages/eval`: 607 tests green (584 before). `tests/report-face.spec.ts` — 12 cases over the two verbs and the projection: the un-exported answer naming every directory searched, the bundle found under the plan's `exports`, the caller's directory winning over the plan's, a run whose meta names neither plan nor repository, an unknown run refusing, the three-candidate search order and its de-duplication, a plan that cannot be read contributing nothing, `pairs` empty when an invariant failed (with the invariants themselves still crossing), the pair rows carrying their own judges with self-judged marked, NaN κ crossing as null, finalize forwarding with the `tab:` caller tag and answering with the log verbatim, and a skipped cell carrying `reason: null`.
- `tests/Report.client.spec.tsx` — 11 cases: four invariant rows in three distinct statuses with their details, the comparison open when all four hold, 比较节未开 naming the failing ones with no delta anywhere on the page, the tool-only red flag, the pair table with the factor line / weighted columns / CI / rank-refusal verbatim / the 自评 mark, the efficiency table's dashes and cross-model caveat and excluded line, the two judge rows, the un-exported state with its button and a disabled finalize, exporting from the page re-reading against the directory just written, and finalize's ask → walk → per-cell outcome (plus cancel walking nothing).
- `tests/LabView.client.spec.tsx`: the placeholder case narrowed to the judging desk.
- Real instance (temporary DSH_HOME on a free port, source-mode web-eval, a one-off copy of the ledger and bundles — the real records were untouched, verified after):
  - **`t31-judge-panel`** (`run-20260911090742-1e4c`, 1 condition, 2 judges, 20 verdict rows): first the un-exported state, naming the one directory it searched (the run was started with `--out`, so the bundle is under neither candidate); then, pointed at the bundle's directory, the full page — four invariants with 环境一致 `unverifiable` ("本 run 无指纹"), the comparison CLOSED naming exactly that one, the efficiency row (3.4 min / 2 rounds / 5 tool calls / 10,277 out / 26,720 in / 241,024 cacheRead) with the same-model note, and judge consistency (10 multi-sampled criteria, agreed 9/10, κ 0.615; 5 cross-judged, all agreed, κ 1.000; 5 self-judged criteria).
  - **`pilot-b-p0-runA`** (`run-20260909102545-1qzq`, 4 conditions, all four invariants ok): the comparison OPEN — six pair blocks, each with its 多因子 line, the per-item delta table, the bootstrap CI and the ranking refusal verbatim (`不可排名（n=1 < 3）`), plus the four-condition efficiency table with `—` in every tool-call cell (no round reported an accounting) and the cross-model caveat in force.
  - **`i1-walk`** (`run-20260905150049-1ndl`, never exported): the un-exported state over a run that really has no bundle.
  - **finalize**: the confirm line, then the walk — `1 released · 0 gate-refused · 0 skipped` with the log line `cell p0-placeholder-codex-scope-a-rep1: archived → releasable → released`, and the ledger's own history recording `by: tab:<sessionId>`. Run again over the released cell it answers `0 released · 0 gate-refused · 1 skipped (1 released)`.
- `pnpm gate` green (14 steps, scoped to eval + eval-tool).
