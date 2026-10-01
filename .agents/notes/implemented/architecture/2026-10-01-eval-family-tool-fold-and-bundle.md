# Agent Note: the evaluation family folds its tool packages into the cores and ships as `@khorsheed/dsh-bundle-eval`

Status: implemented

## Problem

The evaluation family (datasets, mission, lab, eval) had the shape local-agent had before its 2026-09-30 fold:

1. **Each core with model tools had a separate companion package for them.** `@khorsheed/dsh-datasets-tool`, `@khorsheed/dsh-mission-tool` and `@khorsheed/dsh-eval-tool` each carried one tool row: an `inject` on the core service, a `tools:` tier config, and a definition factory imported from the core. Every one was a publish unit with its own invariant, README pair, release-group seat and retirement liability, but held no code of its own.
2. **There was no one-step install.** The web-eval profile listed the four cores and the companions as separate dependencies. An earlier plan held that "install the whole family" had to wait for the upstream thin meta-package seam. That was a misjudgment: bundle-local-agent already proves a family bundle works on today's host. Its patch re-mounts the members' canonical rows verbatim, and the members install as transitive dependencies whose own patches never take effect, so nothing mounts twice.

## Decision

T88 does a shape-only reorganization in six moves. No capability changes package.

1. **The tools fold into each core's `./tool` entry** (the room 0.2.0 / worktrees 0.3.0 / local-agent 0.2.0 pattern).
   - Each core's definition factory moves to `src/tool-definition.ts`.
   - A new `src/tool.ts` is the mountable row. It keeps:
     - the old `name`;
     - `inject` on the core service, so the row stays pending until the core row provides it (the 2026-09-27 boot-order lesson);
     - the `tools:` tier config, unchanged.
   - The tool-origin owner becomes the core package name.
   - The companions' suites move to each core's `tests/tool-row.spec.ts`.
2. **Compositions repoint, and row ids are unchanged.** The eval preset in `packages/presets` and in `profiles/web-eval/presets` keeps the ids `datasets-tool` and `eval-tool` and only changes `name`, to `@khorsheed/dsh-datasets/tool` and `@khorsheed/dsh-eval/tool`. Mission's 任务-tab criterion (`MISSION_TOOL_ROW_MODULE`) and the datasets and eval client preset-visibility constants switch to the subpath names. Behavior does not change: the eval preset still names no mission tool row, so the tab stays hidden in eval sessions.
3. **The three companions are retired.**
   - Their directories are deleted, and the names join `scripts/retired-packages.ts`.
   - check-plugin-independence drops them from its edge and injector rosters, and check-release-groups drops them from its roster. Both specs' fixtures move to the post-fold shape.
4. **New package `@khorsheed/dsh-bundle-eval` 0.1.0.**
   - It declares `dsh.bundle.kind: 'family'` with members datasets, mission, lab and eval, all hard dependencies.
   - Its `cordis.patch.yml` is the verbatim union of the members' own rows.
   - Its locale card title is 「评测」, and the bilingual README lists lab's Docker requirement under known limitations.
   - `tests/bundle.spec.ts` re-derives the union from the members' patches.
5. **The web-eval profile depends on the bundle.** `scripts/install.sh` packs it from source. scripts/check-profile-bundles learned the family kind:
   - Rule 4 (closure) does not ask for a member to be layered again when a direct-dependency family bundle already mounts it.
   - Rule 5 (preset rows resolve) accepts a member's `./tool` row reached through the bundle's hard dependencies.
6. **Versions.** The family advances together:
   - datasets, mission, lab and eval move to `0.2.0-rc.1`, with `minHost` / `verifiedHost` at `0.2.0-rc.2` and the README Compatibility sections synced;
   - bundle-eval starts at `0.1.0`;
   - presets moves to `0.3.0`.
   npm deprecation of the retired names is left to the publish wave.

## The user's decision (2026-10-01)

Recorded verbatim from the T88 brief:

- mission 不退役，作为家族成员进 bundle。
- 三个 *-tool 包折进各自核心包。
- datasets / mission / lab / eval 各自保持独立的包，能单装。
- 能力在包之间怎么分（哪些能力该挪包）另行评估讨论，不并进本任务；有结论后另开任务。

In short: mission stays and joins the bundle; the three tool packages fold into their cores; the four cores stay separately installable packages; and how capabilities should be divided among the packages is a separate discussion that may lead to a later task.

## Alternatives considered

**Keep the tool packages separate (保持独立 tool 包).** Rejected. The split was meant to give each core a separate grant point for its model tools. A `./tool` subpath entry gives exactly the same grant point: an agent preset names the row, and no other session gets the tools. Keeping the packages would only keep three code-free publish units and their bookkeeping.

**Fold into the cores (折进核心包). Chosen.** This is the family-wide precedent (canvas `./agent`, room, worktrees, local-agent). Per-session granting, the tier config and the row ids carry over unchanged. Only the module name moves, which compositions absorb by changing `name`.

**Merge the whole family into one package (整族并成一个包).** Rejected by the user's decision. Each member must still install on its own (a dataset author needs datasets without lab's Docker runtime), and mission is a family member, not something to fold away. The one-step install comes from the declarative family bundle instead, which adds that path without taking the standalone installs away. Whether any capability should move between packages is explicitly deferred to a separate evaluation.

## Consequences

- One `dsh plugin add @khorsheed/dsh-bundle-eval` mounts the four core rows once each. Each core still installs and runs alone, and its `./tool` row comes with it.
- web-eval's dependency closure shrinks by three packages: 24 `@khorsheed` names and 205 patch rows in the measured temporary-instance dump, with every top-level row id appearing exactly once.
- Capability-catalog attributes the eval session's `datasets_*` tools to `@khorsheed/dsh-datasets` and the `eval_*` tools to `@khorsheed/dsh-eval`, the cards the user actually manages.
- Out-of-repo compositions that name the retired modules must move to the `/tool` subpaths. In-repo, check-profile-bundles now fails any composition that names a retired package.
- The thin meta-package upstream seam is no longer a prerequisite for family installs. docs/ops.md 「整合包」 now describes the two shipping family bundles and keeps the seam only as history.

## Testing

- Package suites: eval, datasets, mission, lab, presets and bundle-eval, including the moved `tool-row.spec.ts` suites (row shape, pending-without-core, tier filtering, origin owner).
- check-profile-bundles' spec gains family-bundle cases for rule 4 and rule 5.
- Gates: `pnpm check:plugins`, `pnpm check:profiles`, `pnpm test:scripts`, `pnpm check:hygiene --all`, `pnpm run verify-translation-pairing`.
- A temporary web-eval instance on toolchain 0.2.0-rc.2 (`install.sh --source --fresh`) showed:
  - every top-level row id once;
  - the eval session's catalog listing the datasets and eval read tools under their core owners, and no `mission_*` tools;
  - the eval session's tab strip with no 任务 tab;
  - the plugin page showing the 「评测」 card.
- Not covered: no credentials were configured, so no model-initiated tool call was exercised. The evidence is the registration in the eval preset scope plus the Remote reads.

## Related

- The fold this mirrors: [local-agent delegation tools fold into each provider's `./tool` entry](2026-09-30-local-agent-tool-fold.md).
- The bundle shape: [family bundle meta-packages](2026-09-24-family-bundle-meta-packages.md).
- The boot-order lesson behind the `inject` declarations: [preset-composed tool rows declare their core service as an inject](../bug-fix/2026-09-27-preset-tool-rows-declared-core-inject.md).
- The brief: T88 in profiles/web-eval/docs/iterations.md.
