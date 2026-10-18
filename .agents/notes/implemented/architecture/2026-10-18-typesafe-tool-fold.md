# Agent Note: the typesafe tool row folds into the core package

Status: implemented

## Problem

`@khorsheed/dsh-typesafe-tool` was the last standalone preset-composed companion package in the tree. It carried exactly one tool row — an `inject` on the core's `typesafe` service, a boolean `tools:` config, the `typesafe_judge` definition, its guidance section and the `typesafe-decide` skill — delegating everything to `ctx.typesafe`. It was a publish unit of its own (README pair, locale cards, release seat, retirement liability) holding no code that justified the split, and its cross-package seam forced the tool to redeclare the core's wire types structurally and never import them. The family-wide precedent (canvas `./agent`, worktrees 0.3.0, room 0.2.0, the local-agent fold, the T88 evaluation-family fold) already proved the `./tool` composition entry gives the identical grant point without the extra package.

## Decision

A shape-only reorganization at the host-021 wave (2026-10-18), mirroring T88 move for move. No capability changes package.

1. **The tool folds into the core's `./tool` entry.** `packages/typesafe-tool/src/index.ts` moves to `packages/typesafe/src/tool.ts` and keeps the row id (`export const name = 'typesafe-tool'`), the `inject = ['typesafe']` declaration (the 2026-09-27 boot-order lesson), and the `tools:` boolean config. The tool-origin owner and the skill's `provider` become `@khorsheed/dsh-typesafe`. The structural seam types (`TypeSafeSeam` & friends) give way to same-package type imports (`QuestionSpec` / `Decision` / `JudgeResult` / `TypeSafeService`) plus `import type {} from './index.ts'` for the `Context.typesafe` augmentation. The suite moves to `tests/tool-row.spec.ts`; the `typesafe-decide` skill moves to `packages/typesafe/skills/`. The package gains the `./tool` export, the `@deepseek-ai/dsh-tools` peer, `skills/**/*.md` and `lib/*.js` in `files`, and the second tsdown entry.
2. **Compositions repoint; the row id is unchanged.** The dsh-dev preset in `packages/presets` keeps `id: typesafe-tool` and only changes `name` to `@khorsheed/dsh-typesafe/tool`; `dsh.references` and the README/compat row lists follow. A preset's composition state is unaffected.
3. **The companion retires.** The directory is deleted; the name joins `scripts/retired-packages.ts` (npm deprecation of the published 0.1.2 name rides the same wave). check-plugin-independence drops it from `NO_OWN_PATCH` (the `preset-composed-row` vocabulary value stays; no package in the tree uses it any more) and switches `COMMUNITY_SERVICE_INJECTORS`' `typesafe` entry to the core package itself; the spec fixtures move to `local-agent-dsh-headless`.

## Alternatives considered

**Keep the companion package (保持独立 tool 包).** Rejected, as at every previous fold. The split's only purpose was a separate grant point for the model face, and the `./tool` subpath row is exactly that grant point: a preset names it, no other session gets the tool. Keeping the package would keep a code-free publish unit and its bookkeeping, and would keep the tool's types structurally redeclared forever.

**Fold into the core (折进核心包). Chosen.** Per-session granting, the config key and the row id carry over unchanged; only the module name moves, which compositions absorb by changing `name`.

## Consequences

- `dsh plugin add @khorsheed/dsh-typesafe` still mounts only the core row; the `./tool` row comes with the package and stays preset-granted. Capability-catalog attributes `typesafe_judge` to `@khorsheed/dsh-typesafe`, the card the user actually manages; the separate "TypeSafe Tool" card is gone with the retired package.
- Out-of-repo compositions naming `@khorsheed/dsh-typesafe-tool` must repoint `name` to `@khorsheed/dsh-typesafe/tool`. In-repo, check-profile-bundles fails any composition that still names the retired package.
- The tool's types can no longer drift from the service's: both sides are one package's `src/`.
- No `preset-composed-row` package remains in the tree; the vocabulary value stays declared for the manifest metadata grammar.

## Testing

- `packages/typesafe` build + suite, including the moved `tool-row.spec.ts` (row shape, pending-without-core degrade, `tools: false`, origin owner, answer rendering).
- `pnpm check:plugins` (NO_OWN_PATCH / injectors / card uniqueness), `pnpm test:scripts` (checker fixtures on the post-fold shape), the presets package suite (the repointed row pin).
- Not covered: no live boot — the row's mount path is the same inject/deferred-registration shape the T88 rows already run in production.

## Related

- The fold this mirrors: [the evaluation family folds its tool packages into the cores](2026-10-01-eval-family-tool-fold-and-bundle.md).
- The boot-order lesson behind the `inject` declaration: [preset-composed tool rows declare their core service as an inject](../bug-fix/2026-09-27-preset-tool-rows-declared-core-inject.md).
- The typesafe pair's origin: [the typesafe decision primitive](../feature/2026-09-20-typesafe-decision-primitive.md).
