# Agent Note: the probe runner's three contract gaps — the shared verify layer, the third exit state, and the backfill order

Status: implemented

English | [中文](2026-09-08-eval-probe-runner-contract-gaps.zh.md)

## Problem

T19 wrote the first real probes for the dataseek dataset and ran them against pilot A's cells. Three things the probe contract (§6.7) promised turned out not to be true of the runner that implements it, and each one was already costing something concrete.

**The dataset's shared verify layer was invisible.** `runProbes` read `shown.items[].layers['verify']` and nothing else; `shown.datasetLayers['verify']` came back on the same call and was dropped. So the dataset's `verify/helpers/` — the place its own README designates for "every item must be measured with the same ruler" — could not be reached at run time. Two consequences followed. The item probes could not import the shared assertion library, so the dataset carried a verbatim copy of all three modules (276 lines each) under every item's `verify/lib/`, pinned against drift by a `run-all.mjs --check-shared` flag; that is a workaround, not a fix. And `verify/helpers/probes/no-patch.sh` — the only implementation of the `X-no-patch` veto that both items' checklists reference — never executed in a real run at all, so the veto criterion silently had no `script` verdict.

**The exit code had two states where the world has three.** §6.7 said `0` = judged, non-zero = the probe failed. But a probe can be sound, the criterion untouched, and the input simply not present: `verify-rollup.mjs` on a cell where stage three never ran, `no-patch.sh` on a cell with no harness worktree. T19 used exit 2 for that and wrote the reason to stderr; the orchestrator saw "non-zero" and recorded a probe failure. A pilot that ran only stages one and two therefore collected two bogus failures per cell — noise that buries the failures that are real.

**"Backfilled by the orchestrator" and the implementation disagreed on order.** §6.7 says `task` and `by` are the orchestrator's and are overwritten whatever the probe wrote, which reads as permission to omit them. But both are `required` under `additionalProperties: false`, and `readVerdictFile` validated *before* anchoring — so a probe that took the protocol at its word had its entire output rejected as "carries no valid dataseek.verdict/1", exiting 0 and being recorded as a failure.

## Decision

`packages/eval/src/judge.ts` changes on all three points, and §6.7 is revised to match (protocol v1-rev5).

**Both verify layers are materialized, in the dataset's own relative layout.** The judging directory now mirrors the repository: the dataset-level layer at `<judging>/verify/…`, the item's at `<judging>/items/<item id>/verify/…`. That the layout matches is the whole mechanism — an item probe imports the shared library through `../../../../verify/helpers/lib/x.mjs`, the same relative path that resolves in the dataset repository, so one ruler serves every item and the per-item copies can go. The dataset layer is materialized whenever it is non-empty, probes or no probes: it is a library first and a probe source second.

**Dataset-level probes run, once per item.** `collectProbes` scans both layers with the same `probes/` rule and returns the dataset's first (its veto probe is the one the dataset asks to run first). The cwd for every probe, shared ones included, is **the item's verify root** — a shared probe is the same ruler applied once per item, and the checklist it reads beside it has to be that item's. Their `by` is `shared/` plus the display path in the dataset layer (`shared/helpers/probes/no-patch.sh`); `shared/` is a namespace rather than a directory, marking the verdict as the dataset's ruler and keeping the two `by` spaces from colliding. An item probe's `by` is unchanged.

**The exit code carries three states**: `0` judged, `3` not applicable this round, everything else a failure. `3` is recorded as `probe-skipped` with the probe's first stderr line, and is *not* counted a failure; a genuine failure is `probe-failed`; exit 0 with no readable `--out` stays a failure, because a probe that claims a judgement and produces nothing checkable is broken in the way silent success hides. The `ProbeOutcome` record gains `origin`, `outcome`, `reason`, `overwritten` and `dropped`, and keeps `ok` (= `outcome === 'judged'`) because pilot A's archives are read with it.

**`3`, not the `2` T19 proposed.** `2` is the getopt-conventional "usage error" code, and this package's own fixture probe returns 2 when `--cell` is missing. Reading 2 as "cannot judge" would swallow every mis-invoked probe into the one bucket that is deliberately not counted — the exact failure the third state exists to prevent. The dataset side migrates 2 → 3 with T19b, alongside deleting the per-item library copies.

**Backfill happens before validation.** `readVerdictFile` now takes the anchor, forces `task` and `by` into each row, and validates the anchored document. A probe may omit both entirely; a value that disagrees loses and the fact is recorded as `overwritten`. Everything the schema actually protects — `criterion`, `pass`, `ratio`, `evidence` — is still checked, on the document that will be stored.

**A `ratio` is checked where it is produced.** T24 gave the verdict an optional `ratio: {passed, total}` and taught `report.ts` to score with it, falling back to the boolean when the numbers are unusable. That fallback is right for data already on disk and wrong as the only gate: a probe whose ratio silently degrades never learns it was wrong. `readVerdictFile` now refuses a row whose `total <= 0` or `passed` is outside `[0, total]`, and one whose `pass` contradicts `passed === total` — `pass` is the boolean fact that the criterion FULLY holds, so for a proportional criterion it *is* numerator-equals-denominator, and when the two disagree there is no way to tell which is the typo. Both checks classify as off-contract output, the same bucket as a schema failure, with the reason in the orchestrator ns. A file whose rows are only partly unusable still yields the good ones, and the dropped rows are reported in `dropped` rather than vanishing.

`DatasetsFace.show` gains an optional `datasetLayers`. Optional on purpose: a facade predating it materializes no shared layer and the item's own probes still run.

## Alternatives considered

**Materialize the shared layer under a flat prefix (`_shared/`), as the T19 report suggested.** Rejected: a prefix that exists only in the judging directory means the import path a probe writes is not the import path that resolves in the repository, so the dataset can never be self-testable with the same source. Mirroring the dataset's layout costs one extra path segment and buys the property that a probe which works under `run-all.mjs` works under the orchestrator unchanged.

**Give a shared probe the item's verify root as cwd, or the dataset's.** Chosen the item's. The dataset's root would be the "purer" reading of "the probe's own layer", but it would deny a shared probe the one piece of per-item context it needs — `no-patch.sh` reads `./checklist.yml` for the task id — and would make one cwd serve N invocations that are supposed to be N separate measurements.

**Let `by` be the judging-root-relative path for both origins (`items/<id>/verify/probes/x.mjs` and `verify/helpers/probes/no-patch.sh`).** Rejected: it is more uniform, and it rewrites the `by` of every item probe, invalidating the form §6.7 has stated and pilot A's archives already carry. The `shared/` namespace changes only what was previously impossible to express, and it is the vocabulary the datasets already use to reference these probes from their checklists.

**Let a probe signal "cannot judge" in its `--out` instead — a row with `pass: null`.** Rejected: it requires widening `dataseek.verdict/1`, which is a durable record, so every consumer would have to learn a third truth value and every historical verdict would be reinterpreted. "The probe could not run this round" is a fact about the *run*, not about the criterion; the orchestrator ns is where facts about the run live.

**Accept both 2 and 3 as "not applicable" during the migration.** Rejected: an ambiguous contract is worse than a migration. Accepting 2 would permanently classify mis-invoked probes as skipped, and the ambiguity would never be removed once datasets started relying on it.

**Loosen `VERDICT_SCHEMA` so `task` and `by` are optional instead of reordering.** Rejected: the schema describes the STORED verdict, and a stored verdict without a task or an origin is unusable. What was wrong was the order in which the runner applied two correct rules, not either rule.

## Testing

`tests/probes.spec.ts` drives `runProbes` directly against a purpose-built datasets fake — the behaviours are per-item (a shared probe runs once for each), and the run-loop fixture has a single item by design. It pins: an item probe importing the shared library through the repository-relative path; a shared probe running once per item and reading each item's own checklist from its cwd; all three exit states plus silent-success; exit 2 classified as a failure; the backfill order (omitted, wrong, and correctly echoed coordinates); the four `ratio` refusals and the partial-file case; the escaping-display-path guard; and the judging directory's shape and removal. `tests/run.spec.ts` covers the wired path: the tri-state record in the `kind: 'probes'` annotation, and a dataset-level probe reaching the `script` ns end to end.

## Consequences

The dataset can delete its per-item library copies and point the imports back at `verify/helpers/lib/` (T19b), and `X-no-patch` gets a `script` verdict for the first time. A pilot that stops after stage two now reads honestly: the roll-up probes say "not applicable this round" instead of contributing two false failures per cell, and the run log counts the three states separately.

The costs. The judging directory is one level deeper than before, so an existing probe that assumed its cwd was the judging root is unaffected (cwd is still the item's verify root) but one that walked *up* from it now sees a different tree. The dataset-side exit code changes from 2 to 3, which is a coordinated edit across `no-patch.sh`, `run-all.mjs`, and two docs — until it lands, those probes are recorded as failures rather than skips, exactly as before. And a shared probe now runs N times per run instead of zero, which is correct and is also N times the cost: a shared probe that is slow is slow once per item.

## Related

- [the eval judge](../feature/2026-09-07-eval-judge.md) — the note that owns §6.7's original shape; this one revises three of its clauses without displacing it.
- [verdict polarity and ratio](../architecture/2026-09-08-verdict-polarity-and-ratio.md) — `ratio` is its addition; the source-side numeric checks here are the second half of that gate.
