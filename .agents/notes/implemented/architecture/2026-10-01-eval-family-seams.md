# Agent Note: the evaluation family tightens its seams instead of moving capabilities

Status: implemented

## Problem

A read-only review of the four evaluation cores (datasets, mission, lab, eval) found the division of labor sound but the joints loose:

1. **eval rebuilt mission's on-disk layout.** Nine eval modules joined `runs/<runId>/data/<missionId>/attempt-N` by hand. A layout change in mission would have silently broken eval's reads and writes.
2. **Two CLI adapters parsed mission's human table.** eval's finalize path and lab's `cliMissionFace` split `dsh-mission list` / `get` output into columns, so any presentation change broke them.
3. **Two copies of the judgeability rules drifted unchecked.** eval's `judge.ts` and datasets' `rubric.ts` implement the same rubric-path, probe-path and criterion rules, with nothing to say when they disagree.
4. **`run.ts` held the whole run loop in ~2,400 lines**, and eval's `src/` was flat (about 70 modules).
5. **Run-level facts were stored on the first cell.** Closure marks and export notes were written as annotations on the run's first mission, so a run with no cell could not be closed, and readers had to know the convention.
6. **eval exported through a bypass.** It called `missionRemote.exportRun(agent, …)` and re-implemented the dataset-layer leak gate around it.
7. **mission's vocabulary was eval's.** Names such as `NsCellReport` described an orchestrator mission does not know about, and datasets described its judgeability check as "generic".

## Decision

**No capability moves between packages.** The split stays: datasets owns content and versions, mission owns the ledger and the state machine, lab owns container lifecycles, eval owns orchestration, judging and reports. Every dependency already points one way, and each package still installs alone with its degradation unchanged. T89 tightens the seams only.

1. **`attemptDataDir(runId, missionId, attempt)` on mission's service and Remote.** It is the single owner of the layout. Every eval call site that built the path now asks mission. Without the verb, `eval run` refuses with an upgrade message, read paths show an unknown hash, and cell-artifact refuses.
2. **`dsh-mission list --json` / `get --json`** print `{schema: 'dsh-mission.list/1', missions}` and `{schema: 'dsh-mission.get/1', runId, mission}`. eval (`parseMissionList`) and lab (`parseMissionGet`) parse JSON only; the column parsers are deleted. An old CLI rejects `--json` ("requires a value", exit 2), and both adapters turn that into an upgrade hint (`oldMissionCliHint`).
3. **A judge-rule contract spec** (`scripts/judge-rule-contract.spec.ts`, run by `pnpm test:scripts`) loads both implementations by relative path and runs one fixture through each: rubric selection, probe discovery and criterion leaf reading. It adds no dependency edge between the packages. The two known differences are pinned as explicit cases rather than skipped. "No rubric" is `null` on one side and `undefined` on the other. Leaf strictness is one-directional: datasets rejects leaves that eval would still read. Pointer comments in both source files name the spec.
4. **eval's `src/` gets five directories:** `contract/`, `run/`, `judge/`, `report/` and `design/`. The move was one commit with import rewrites only. Entry points, the read faces and the conditions/provision modules stay at the top level, and the conditions/provision modules stay there so the concurrent T91 work merges cleanly. `evalVersion()` moved verbatim to `src/eval-version.ts`, one level below the package root, so its `../package.json` read still resolves from both `src/` and the bundled `lib/`. A second commit split `run/run.ts` into `cell-shared.ts`, `unit-lifecycle.ts`, `judge-cell.ts` and `cell-once.ts`. `run.ts` keeps `runPlan`, the public `Run*` types and a re-export of `EvalRunRefused`, so the package's exports did not change.
5. **Run-level annotations in mission.** `RunRecord.annotations` is a list of `{ns, payload, createdAt, by}` entries.
   - It is append-only and namespaced, and has no edit or delete verb.
   - `annotateRun` is idempotent on an identical entry.
   - It has service, Remote-read, CLI (`run annotate` / `run annotations`) and bundle (`run.json`, only when non-empty) faces.
   - eval's `run-notes.ts` writes closure and export notes at run level when the verb exists, and falls back to the first cell on an old mission.
   - The read side merges the run list with every cell's list, so a run closed under the old first-cell convention still reads as closed. The newest entry wins.
   - Rejected: a mutable `run.meta` field (it loses history and invites write races) and a dedicated "closure" verb (it would teach mission an eval concept).
6. **Gated export on mission's service.** `setLayerProbe` lets datasets' layer probe be installed, and `exportPlanGated` / `exportRunGated` run the leak and TTY gates inside mission. eval calls `ctx.mission.exportRunGated` and deleted its Remote bypass and its gate copy. The ungated `exportRun` stays for mission's own CLI and slash faces, which already gate. New verbs were chosen over gating `exportRun` in place, so existing callers do not change behavior under them. The gate itself stays in mission (out of scope: moving it).
7. **Neutral vocabulary.** `NsCellReport` became `NsAttemptReport`, and the old name stays as a `@deprecated` type alias. Local names say entry or attempt. `expectedNs` keeps its wire name because it is a stored meta key, and a header comment records where it comes from. datasets now describes its judgeability check as the rule set eval's judge applies, instead of calling it generic.

## Alternatives considered

- **Moving the leak gate or the export into eval, or the rubric feasibility check out of datasets.** Rejected by the review. Each sits with the data it guards, and moving one would add an edge in the wrong direction.
- **A shared npm package for the judge rules.** It would create a new publish unit and dependency edge to protect about 100 lines. A contract test gets the drift alarm without either.
- **Versioned table parsing instead of `--json`.** That would keep a format meant for people as an API.

## Consequences

- mission is now the only module that knows the attempt directory layout, and changing it no longer requires changes in eval.
- Hosts with a newer eval and an older mission degrade loudly. Runs refuse, export refuses, marks land on the first cell, and the CLI adapters print an upgrade hint.
- Out-of-repo importers of eval's deep paths (`src/<module>.ts`) must follow the new directories. The package's export map is unchanged.
- A stale `lib/` still holds the old flat files. Clean `lib/` before packing.
- Public API changes:
  - eval: `parseMissionRow` was replaced by `MISSION_LIST_SCHEMA` / `parseMissionList` / `oldMissionCliHint`, `MissionExportRemoteFace` became `MissionExportFace`, the `attemptDataDir` helper became `attemptDirOf`, and `recordExportNoteOn` accepts an undefined mission id.
  - lab now exports `cliMissionFace` and `parseMissionGet`.

## Testing

- Package suites for mission, eval, lab and datasets, including the new tests below.
  - mission: `attemptDataDir`, run annotations (append, idempotence, persistence, bundle), the gated exports, and `list` / `get --json`.
  - eval: run-level writes plus the legacy first-cell read compatibility in `run-notes`.
  - lab: `parseMissionGet` and the old-CLI hint.
- Contract spec mutation proof: seven single-line mutations, each turning the spec red, then restored.
  - eval: the longest rubric path wins; probe paths accept `.js`; criteria require a weight.
  - datasets: rubric paths drop `.yaml`; probe paths sort in reverse; leaf fields drop `evidence`; `nonEmptyString` stops trimming.
- Gates: `pnpm test:scripts`, `pnpm check:hygiene --all`, `pnpm check:plugins`.
- A temporary 0.2.0 instance with an old run copied read-only from the lab instance and a new run. Both show the results page, export and closure marks.

## Related

- The shape-only reorganization before this: [the evaluation family folds its tool packages into the cores](2026-10-01-eval-family-tool-fold-and-bundle.md).
- The brief: T89 in profiles/web-eval/docs/iterations.md.
