# Agent Note: The dataset-authoring protocol ships with its skill

Status: implemented

## Problem

The `dataset-authoring` skill (T90, shipped in `@khorsheed/dsh-datasets`) told the organizing agent that the Dataset Authoring Protocol "wins" and named it as `docs/dataset-authoring-protocol.md` — a path in this repository that no installed package carries. In the 3185 walk-through (T94) the agent took the instruction literally: it searched the toolchain, then the whole disk (`find /`, timed out into background jobs), then read another instance's installed `dsh-datasets/lib/*.js` and its `state/datasets/` to reverse-engineer the validation rules, and rewrote the rubric check in Python. Thirty-five steps of reading before it touched a file, while `datasets_propose_registration {dryRun: true}` — the check that gives exactly that problem list — sat unused.

A second, independent defect surfaced in the same T90 install: `lib/` of datasets, eval and local-agent-dsh imports `js-yaml` bare (tsc emits the specifier verbatim), and pack-dist drops `dependencies` from every dist manifest ("runtime deps are bundled into lib or provided by the host"). Inside an instance the host resolves it, but `node <profile>/node_modules/@khorsheed/dsh-datasets/lib/cli.js` dies with `ERR_MODULE_NOT_FOUND`.

## Decision

**The protocol is build-copied into the skill directory.** `packages/datasets/build/copy-protocol.mjs` runs first in the datasets build and copies the repo pair into `skills/dataset-authoring/protocol.en.md` (English, from `docs/dataset-authoring-protocol.en.md`) and `protocol.zh.md` (Chinese, from `docs/dataset-authoring-protocol.md`). The existing `skills/**/*.md` entry in `files` ships them; the copies are gitignored, so `docs/` stays the only source and the bilingual pairing record is untouched. A missing source fails the build. The helper sits in the package's `build/`, not `scripts/`: `pnpm check:plugins` treats a package `scripts/` as publish payload that `files` must ship, and this one is build-time only.

**The skill names install paths through placeholders the loader resolves.** The skill reaches the model as text via the host `skills` registry, so a relative path would be meaningless to it. SKILL.md writes `{{skillDir}}/protocol.en.md` and `{{packageDir}}/lib/cli.js`; `loadAuthoringSkill()` replaces them with the absolute skill directory and package root of the module that loaded it (`src/` and `lib/` sit at the same depth, so source plane and installed package resolve alike). The model reads the protocol with `read` at that absolute path.

**SKILL.md gains ground rules** (and the `organize` guidance a one-sentence echo): read only the source directory, the target repository and the protocol; validation rules come from `datasets_propose_registration {dryRun: true}`, `datasets_validate` (registered datasets) and the package CLI's `validate --repo <repo>` (full per-item report for an unregistered repository) — never from searching the disk, reading any plugin's source or `lib/`, or another instance's `~/.dsh*` / `profiles/` / `state/`; `find` only inside source/target with `-maxdepth`. The "already in protocol layout" path now copies, commits and runs the check first, letting its list decide what to read and change.

**js-yaml is kept as a declared runtime dependency** in datasets, eval and local-agent-dsh via `dsh.runtimeDependencies: ["js-yaml"]`, the opt-in pack-dist already honors (capture's precedent). The dist manifest then installs js-yaml beside the package, so the CLI runs standalone.

## Testing

`packages/datasets/tests/skill-package.spec.ts`: the raw SKILL.md references exactly the two protocol copies and `lib/cli.js` (and no `docs/` path); the loaded skill has no unresolved placeholder and every referenced absolute path exists after build; the copies equal the `docs/` pair byte for byte; `npm pack --dry-run` lists SKILL.md and every referenced file. `scripts/pack-dist.spec.ts` pins that the three real manifests keep `js-yaml` through `rescopePackageJson`.

## Alternatives considered

**`files` listing `docs/dataset-authoring-protocol*.md` directly.** Not possible: `docs/` is at the repository root, outside the package directory, and `files` cannot reach out of it. Moving the protocol into the package would break the repo-wide references (eval's protocol tests, the pairing record, links across notes and READMEs) for no gain.

**Committing a copy of the protocol in the skill directory.** Two tracked copies of a 65 KB document that is revised often (rev14 → rev15 in one week) drift; a test could catch the drift, but every protocol edit would then touch two places. A build copy keeps one source and the byte-equality test proves the shipped copy is current.

**Copying into `lib/` instead of the skill directory.** Works equally for the model (the path is resolved absolute either way), but keeps the protocol away from the skill it belongs to: a skill directory read on its own (or zipped by a skill importer) would again point at nothing.

**A relative path in SKILL.md (`protocol.en.md` "next to this file").** The model never sees the skill's file location — the registry hands it text — so a relative path re-creates the original failure.

**Bundling js-yaml into lib with tsdown.** The host-side lib is tsc output, not a bundle; datasets' tsdown builds only the browser client through the shared `clientBundle` helper, which must not be forked per package. Introducing a host bundle step for one small pure-JS dependency changes the build shape of three packages; the declared runtime dependency is a one-line manifest change through a mechanism pack-dist already has.

## Consequences

- Installed datasets packages carry ~130 KB more (both protocol languages). The organizing agent has a real path to read and an explicit "never search" rule; the model-dependent re-walk is the coordinator's on 3185.
- `pnpm --filter @khorsheed/dsh-datasets test` now needs a prior build for the skill-package spec (as the build contract already orders every test).
- Profiles installing datasets / eval / local-agent-dsh now install js-yaml from the public registry (not an `@khorsheed` package, so unaffected by the npm freeze).
- The protocol copy is regenerated on every datasets build; editing `protocol.*.md` in the skill directory is pointless — edit `docs/`.
