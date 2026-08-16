# AGENTS.md

Community plugin monorepo for the dsh ecosystem. Every package publishes as `@khorsheed/dsh-*`. This repo is the **single source of truth** — the deepseek-harness in-tree copies are being removed, the archived standalone repos are read-only history.

The upstream host lives at `~/code/deepseek-harness` (env `DSH_HARNESS`). We track it, we do not modify it: plugin needs that require host changes go through the upstream-change pipeline, never through a local fork.

## Multi-agent concurrency

Several agents work this repo at once. The rules below exist because of real incidents — follow them mechanically.

- **Pull before you start; push when you finish.** `git pull --rebase` first, push the same day. Work that exists only locally does not exist.
- **Never develop in `/tmp`, `scratch/`, or any throwaway directory.** A message-tools production line (0.2→0.4.7) was lost this way. Clone/branch inside this repo or nowhere.
- **Keep `main` green.** Before every commit: `pnpm run build && pnpm run test` for the packages you touched. Commit each logical change separately as soon as it is green.
- **Non-trivial changes carry an Agent Note** in `.agents/notes/` (format in `.agents/notes/README.md`). The note is how concurrent agents learn why a decision was made without a meeting.
- **Package-level ownership in flight**: before reworking a package, check `git log --oneline -3 -- packages/<pkg>` and recent notes for active work; do not silently overwrite another agent's un-pushed direction.
- **Prod links here.** The production profile (`$DSH_HOME/profiles/web/package.json`, port 3080) `link:`s these packages. `pnpm install` in the profile can trigger a watchdog restart, and a restart serves whatever `lib/` currently contains — so never leave a package with a stale or missing `lib/` (build after every source change), and coordinate restarts in the open.

## Build contract

- Host face before client face, always: `gen-typert` (packages with `./typert`/`./remote` exports) → `tsc` → `tsdown`. The client face's tsc consumes generated remote types.
- Browser bundles go through the shared helper `build/tsdown.client.ts` (`clientBundle`). Never hand-roll a `client.js` or copy the helper into a package.
- Tests run through `pnpm run test` / `pnpm --filter <pkg> test` only. Bare `vitest run` bypasses the source-plane alias preset (`build/vitest.ts`) and fails with misleading errors.
- `DSH_HARNESS` (default `~/code/deepseek-harness`) seeds dev-time type/test resolution and typert generation. CI: clone the harness first, set the variable, and keep it current — a stale checkout tests yesterday's API surface.

## Package conventions

- **Identity**: one package = one name = one loader entry id. The id goes in `cordis.patch.yml` (`name:` value must be quoted — `@` is YAML-reserved), the tsdown `clientBundle(id)`, and `src/invariant.ts`'s `PACKAGE_NAME`. All three move together on any rename.
- **Self-mounting**: every installable plugin declares `dsh.bundle.patch` → `cordis.patch.yml` and lists that file in `files`. `dsh plugin add` must suffice; hand-edited profile YAML is a bug.
- **Client discovery**: browser halves declare `dsh.client` (`platform`, `inject`, `immediately`) in package.json.
- **Dependencies**: official packages are peerDependencies with wide ranges (`@deepseek-ai/cordis ^4.0.1`, `@deepseek-ai/dsh-* ^0.1.0-rc.6`) plus `peerDependenciesMeta.optional` where loadable without; intra-repo deps use `workspace:*`. Never `workspace:^` across repos.
- **Degrade, don't explode**: probe optional host capabilities at apply time (`ctx.get`, `ctx.slots.spec`) and degrade silently or to an empty state. A plugin that throws on a missing capability fails the whole boot.
- **DOM anchors are last resort**: prefer slots and public services; a DOM anchor must carry a fallback.

## Versioning and publish

- Semver per package, independent lines. Before publishing, check the registry (`npm view <name> version`): the new version must exceed it. Publishing at or below the published version fails 403/409.
- Publish via `scripts/pack-dist.ts` (`--family` rewrites scopes in peer deps) and verify the tarball before `npm publish`.
- The version in package.json is the next-release line; bump it when cutting a release, not per commit.

## Ops

- The prod instance is watchdog-supervised (ankh-guard). Restarts are gated by `dsh preflight --profile web` — a FAIL blocks the restart; never bypass the gate.
- ankh-guard binds restart credentials to git HEAD: run `build + test` before any restart-triggering change so the credential is green.
- The watchdog can roll the *checkout* back on repeated boot failure. Keep the harness checkout it guards disposable (see the deploy/tracking split in the consolidation note) — uncommitted work in a guarded checkout is at risk.
