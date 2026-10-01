# Agent Note: eval — 选题 (all / random N with a fixed seed / pick) pinned as plan items; one broken experiment no longer empties the list; templates find their schemas

Status: implemented

## Problem

Three gaps were found on the walkthrough instances after T89.

- **选题 (T90, second segment).** The 新建实验 dialog could only tick items by hand. A person who wanted "5 random items of this set" had no way to say so. The draw also had to be reproducible: the same set version and the same seed must always give the same items. Two experiments on one set may still choose differently.
- **T93.** The lab list read every unstarted experiment's plan through `validate`. That call throws when the experiment's dataset cannot be read, for example when its registration is gone. `draftRow` did not catch it, so one such experiment made `experiments()` refuse and the whole list showed "Failed to load the experiments".
- **T92.** `runPlan` writes the generated mission template beside the plan, with the default `../schemas/<file>` guard paths. That default is correct for an in-repo plan under the set's `plans/`. Since T73, plans live at `state/eval/experiments/<id>/plan.json`, where `../schemas` names `experiments/schemas/`. That directory does not exist, so mission's template lint refused the run.

## Decision

**Selection is a way of writing `dataset.items`, never a rule the run re-applies.**

- `packages/eval/src/contract/item-selection.ts` (no imports, so both the dialog and the host use it) resolves one of three modes against the set's items at the pinned commit:
  - `all` — every non-placeholder item;
  - `random` — `count` items chosen by `seed`;
  - `pick` — the ticked items.
- `eval_plan_draft` accepts `items` or `selection`, never both. It writes the explicit `dataset.items` list plus a provenance block `dataset.selection` (`mode`, `pool`, and for random also `count`, `seed`, `algorithm`). This is protocol v1-rev15; the schema and both language versions of the protocol doc were updated.
- **The draw (`hash-rank/1`).**
  - Every pool id gets the key `cyrb53("<seed>\0<id>")`.
  - The `count` smallest keys win; ties are broken by id.
  - The winners are returned in pool order (sorted by UTF-16 code unit).
  - The draw never touches `Math.random`, the clock, or the locale. The only nondeterministic call is minting a default seed, which is then shown, editable, and pinned like a chosen one.
- **The dialog.**
  - A `SegmentedControl` (全部 / 随机 N 题 / 手选).
  - Random mode has a count field, a seed field with a "换一个种子" button, and a live preview of the drawn ids labelled with the commit.
  - Pick mode has the checklist, with a filter for long sets.
  - The planning skill defaults to `selection: {mode: "all"}` and documents the three modes.

**T93: a broken experiment becomes one row's reason.**

- `draftRow` catches the validate failure. The row gets an optional `broken: {kind, registry, message}`, and the list carries on.
- `kind` is classified on the host by markers in the refusal text:
  - `unregistered` — datasets' `notRegistered`;
  - `setMissing` — `datasetView`'s "has no set";
  - `noRegistry` — eval's own no-registry refusal;
  - `unreadable` — anything else.
- A test reads those sentences from their source files, so a rewording fails a test instead of degrading quietly.
- The row stays an unchecked 草稿. It renders the reason in the error seat's three-part shape: what happened, how to fix it, and the raw text folded under 详情. The status vocabulary is unchanged.

**T92: absolute schema paths into the validated dataset root.**

- `runPlan` passes `schemaPathPrefix: join(datasetRoot, 'schemas')`.
- `datasetRoot` is the materialized, content-addressed view of the pinned commit (or the set's own directory for an old in-repo plan). The absolute path therefore names exactly the schemas validate checked, whatever directory holds the plan.
- Mission already resolves an absolute `schemaPath` as-is (`resolveSchemaPath`), so no other package changes.
- The `dsh-eval template` CLI, which writes into a set's `templates/`, keeps its relative default.

## Alternatives considered

**Selection:**

- **A seeded-PRNG shuffle of the pool.** Rejected. The draw would depend on the pool's order and on every other member, so adding one item to the set would reshuffle everything. With a per-id hash rank, a new item enters the draw only if its own key beats the current last one.
- **Recording the provenance only in `meta.json`.** Rejected. The plan is the portable artifact that import, export and bundles carry, so the record that lets someone redo the draw belongs in it.
- **Storing the rule and re-applying it at run time.** Rejected. A plan whose rows change when the set gains items is not pinned. Every mode ends as an explicit `items` list.
- **A server-only draw with no preview.** Rejected. The person must see which items a seed gives before handing the plan over. Sharing one pure module gives the preview and the host the same answer by construction.
- **`Math.random` with no seed.** Rejected because it is not reproducible.

**T93:**

- **Classifying in the browser by adding markers to `ErrorState.tsx`.** Rejected. That file is deliberately duplicated in the datasets package and kept identical by hand, and a parallel branch is editing datasets. The host knows the pin's registry id anyway.
- **Dropping the broken experiment from the list with a note.** Rejected. The person would lose sight of the experiment they need to fix.

**T92:**

- **(B) Copy the set's `schemas/` into `experiments/<id>/schemas/` and use the prefix `./schemas`.** This makes the template self-contained beside the plan. It was not chosen because it duplicates data on every run, needs an overwrite policy, and puts a directory into the experiment that nothing else reads. The absolute path is a one-line change that already pins the commit's schemas.
- **(C) Change mission's resolution, for example to resolve against a run-meta root.** Rejected as cross-package, and mission already supports absolute paths.
- **Relative-from-template path** (`relative(templateDir, datasetRoot/schemas)`). Rejected. It is equivalent but produces long `../../..` chains that break if either tree moves, with no gain.

## Consequences

- A plan drafted from a selection still lists its items explicitly. Older readers that ignore `dataset.selection` read it unchanged, and the plan schema accepts the block only in its declared shape.
- Changing the hash arithmetic or the tie rule changes draws. That requires a new `SELECTION_ALGORITHM` name, and old plans keep their recorded `algorithm`.
- A broken experiment is visible and explained in the list. Opening it still shows the design page's own error seat.
- Generated templates now carry absolute, machine-specific paths. They are generated deployment artifacts, regenerated on every run and never exported in bundles, so nothing portable carries them. If the materialized cache for a commit were ever removed while a run is still open, its guards would fail to read their schema. The same is already true of the run's `snapshotDir`.

## Testing

- `item-selection.spec.ts` pins the hash values and one fixed draw (seed 42, 5 of 20). It also checks order-independence, the stability of a draw when unrelated items are added, and the schema checks.
- `draft.spec.ts`, `tools.spec.ts`, `organize.spec.ts` and `NewExperiment.client.spec.tsx` cover the three modes end to end.
- `experiments.spec.ts` covers one unregistered experiment beside a healthy one, the fallback, and the marker pins. `LabView.client.spec.tsx` covers the row reason.
- `run.spec.ts` runs an experiment-layout plan end to end. It reproduced the `experiments/schemas/` ENOENT before the fix.
