# Agent Note: mission folds into eval — the eval row mounts the ledger

Status: implemented

## Problem

`@khorsheed/dsh-mission` was the evaluation line's ledger: runs, missions, attempts, the release gate, the `/mission` slash command and the `dsh-mission` CLI. By 2026-10 it had no surface of its own any more — its session tab and Remote face retired, and the eval preset deliberately never names it (ui-spec R6). Only eval (service probes and the `dsh-mission` CLI from `dsh-eval finalize`) and lab (an optional probe plus the CLI on PATH) consume it, and it only ever shipped inside the eval suite. It had never been published. Publishing it as its own package would have added a card, a publish line and a version to keep in step for a component no user installs on its own.

## Decision

Before its first publish, mission becomes part of `@khorsheed/dsh-eval`:

- the source moves to `packages/eval/src/mission/` and the tests to `packages/eval/tests/mission/`; the old README and CHANGELOG are kept as `packages/eval/docs/mission/`;
- **the eval row mounts the ledger itself** (`ctx.plugin(missionLedger, { dataDir })` in eval's `apply`), with a `mission.dataDir` field on eval's config. No separate `mission` row: the repo rule is one package, one root row, and any row named with a subpath is a preset-granted companion;
- the `mission` service name, its default data root (`$DSH_HOME/state/mission`) and the `dsh-mission` bin (now `lib/mission-cli.js` in the eval package) are unchanged, so eval's per-call probes, lab's probe and existing data see no difference;
- the optional model-tool row is now `@khorsheed/dsh-eval/mission/tool` (row id `mission-tool` unchanged); no shipped preset grants it;
- the eval suite drops mission from its members; `@khorsheed/dsh-mission` joins `scripts/retired-packages.ts`; check:plugins records the `mission` service as owned by eval.

lab stays its own package: its mission integration is a probe plus the CLI, and an isolated, reproducible experiment unit has uses outside evaluation.

## Alternatives considered

**Keep a second root row (`- id: mission / name: '@khorsheed/dsh-eval/mission'`).** It would have kept the row id and a separate on/off switch. Rejected: check:plugins treats every subpath row as a preset-granted companion, and loosening that for one package blurs a rule the mode packs rely on. A switch for a ledger the eval row depends on has no use.

**Fold lab in as well.** Rejected: lab's coupling to mission is optional and lab is useful on its own.

## Consequences

- One card and one publish line fewer in the evaluation family; the 2026-10-24 wave debuts eval without a separate mission.
- A composition that set config on a `mission` row would lose it — none in the repo or on 3080 does. Configure `mission.dataDir` on the eval row instead.

## Testing

`packages/eval/tests/mission/` (the former mission suite, paths repointed) plus `eval-row.spec.ts` (the eval row mounts the ledger with the default and a configured data root). eval 1484, lab 147, eval suite 8 green; `node lib/mission-cli.js` prints the mission usage; check:plugins, check:profiles, check:collections clean.
