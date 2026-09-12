# AGENTS.md

Community plugin monorepo for the dsh ecosystem. Every package publishes as `@khorsheed/dsh-*`. This repo is the **single source of truth** — the deepseek-harness in-tree copies are being removed, the archived standalone repos are read-only history.

The upstream host lives at `~/code/deepseek-harness` (env `DSH_HARNESS`). We track it, we do not modify it: plugin needs that require host changes go through the upstream-change pipeline, never through a local fork.

## Multi-agent concurrency

Several agents work this repo at once. The rules below exist because of real incidents — follow them mechanically. The full collaboration model — worktree-only development, the three paths (worktree → main → 3080, mainline host-tracking, npm waves), and the conflict rules — lives in [docs/development.md](docs/development.md).

- **Pull before you start; push when arranged.** `git pull --rebase` before you start; commit each logical change as soon as it is green (committed work exists in git). **Pushes are coordinated by the human, not a same-day obligation** — never push unilaterally. Stage explicit paths only (`git add -A` / `git add .` / `git add -u` are forbidden: the index is shared checkout state, and broad staging has swept another agent's staged files into the wrong commit); review `git status` + `git diff --cached` before committing.
- **Never develop in `/tmp`, `scratch/`, or any throwaway directory.** A message-tools production line (0.2→0.4.7) was lost this way. Clone/branch inside this repo or nowhere.
- **Keep `main` green.** Before every commit: `pnpm run build && pnpm run test` for the packages you touched. Commit each logical change separately as soon as it is green.
- **Non-trivial changes carry an Agent Note** in `.agents/notes/` (format in `.agents/notes/README.md`). The note is how concurrent agents learn why a decision was made without a meeting.
- **Package-level ownership in flight**: before reworking a package, check `git log --oneline -3 -- packages/<pkg>` and recent notes for active work; do not silently overwrite another agent's un-pushed direction.
- **Prod takes tarballs, not links.** The production profile (`$DSH_HOME/profiles/web/package.json`, port 3080) references every package as a `file:` tgz. `link:` was retired after in-flight `lib/` reached prod on a restart — the profile is shared state (docs/ops.md). Building in this checkout therefore cannot reach 3080; only `pnpm deploy:3080` can, and it packs from `lib/`. Build after every source change anyway: pack-dist ships whatever `lib/` holds, so a stale build becomes a stale tarball. Coordinate restarts in the open.

## Build contract

- Host face before client face, always: `gen-typert` (packages with `./typert`/`./remote` exports) → `tsc` → `tsdown`. The client face's tsc consumes generated remote types.
- Full-build gen-typert runs are freshness-cached (`$DSH_HOME/scratch/typert-cache.json`) — one full run regenerates ALL typert packages, so the other nine invocations in a repo build hit the stamp. A hit requires byte-identical inputs (the script, every typert package's src/manifest/host configs, the harness checkout's git HEAD+status) plus hash-verified outputs on disk, so a stale hit is impossible by construction. `GEN_TYPERT_FORCE=1` regenerates; scoped `GEN_TYPERT_ONLY` runs (deploys) never read or write the cache.
- Browser bundles go through the shared helper `build/tsdown.client.ts` (`clientBundle`). Never hand-roll a `client.js` or copy the helper into a package.
- Tests run through `pnpm run test` / `pnpm --filter <pkg> test` only. Bare `vitest run` bypasses the source-plane alias preset (`build/vitest.ts`) and fails with misleading errors.
- `DSH_HARNESS` (default `~/code/deepseek-harness`) seeds dev-time type/test resolution and typert generation. CI: clone the harness first, set the variable, and keep it current — a stale checkout tests yesterday's API surface.

## Repo hygiene (pre-commit gate)

This repo is public — a hygiene check runs on every commit (`.githooks/pre-commit`; install once per clone with `pnpm hooks:install`, which sets `core.hooksPath`). It fails the commit on anything a public repo should not carry, and can be run by hand:

- `pnpm check:hygiene` — the staged set (what this commit would publish);
- `pnpm check:hygiene --all` — every tracked file (full audit / CI);
- `pnpm check:hygiene -- <path>…` — explicit paths.

Checked: **absolute local paths** (`/Users/<name>/…`, `/home/<name>/…` other than the `/home/user` fixture placeholder, `C:\Users\…`), **credential-shaped strings** (API keys, private-key headers, GitHub tokens, `key = "long value"` assignments), and **tooling/scratch state** that must stay ignored (`.playwright-mcp/`, `scratch-*`, `*.tsbuildinfo`, `*.log`, `.DS_Store`, `node_modules/`, package `lib/`, `.env`). Sanitize machine-specific fixture content to `/home/user/…` before committing; keep the checker's own spec green via `pnpm test:scripts`.

Debug screenshots are scratch too: image extensions (`*.png`, `*.jpg`, `*.gif`, `*.webp`) are gitignored, so a screenshot left at the repo root or in a package dir never enters a commit. Delete them as soon as the debugging session ends. The deliberate exception is a doc page that actually references an image: those live in `docs/screenshots/` and are committed with an explicit `git add -f` (the tracked images already there are unaffected).

A second whole-tree checker, `pnpm check:plugins` (`scripts/check-plugin-independence.ts`), mechanically enforces the package conventions below that make every plugin independently installable: self-mounting, the identity triangle, no foreign-scope self references, cross-plugin edges limited to the sanctioned pairs, and community-service injects limited to their owning family. Its spec re-runs it against the real tree, so `pnpm test:scripts` fails on a violation.

## Package conventions

- **Identity**: one package = one name = one loader entry id. The id goes in `cordis.patch.yml` (`name:` value must be quoted — `@` is YAML-reserved), the tsdown `clientBundle(id)`, and `src/invariant.ts`'s `PACKAGE_NAME`. All three move together on any rename.
- **Self-mounting**: every installable plugin declares `dsh.bundle.patch` → `cordis.patch.yml` and lists that file in `files`, so `dsh plugin add <pkg>` mounts **that package's own row**; hand-edited profile YAML is a bug. A row that must coexist with another package's row is a composition closure, not an exception to this rule: the local-agent providers below need the core installed alongside them, and no package's patch may mount another self-mounting package's row (see `pnpm check:plugins`).
- **Client discovery**: browser halves declare `dsh.client` (`platform`, `inject`, `immediately`) in package.json.
- **Dependencies**: official packages are peerDependencies with wide ranges (`@deepseek-ai/cordis ^4.0.1`, `@deepseek-ai/dsh-* ^0.1.0-rc.6`) plus `peerDependenciesMeta.optional` where loadable without; intra-repo deps use `workspace:*`. Never `workspace:^` across repos.
- **Degrade, don't explode**: probe optional host capabilities at apply time (`ctx.get`, `ctx.slots.spec`) and degrade silently or to an empty state. A plugin that throws on a missing capability fails the whole boot.
- **No inter-plugin dependencies by default.** Each package must install, run, and uninstall alone. The two sanctioned exceptions are explicit core/companion pairs: the local-agent family (providers declare `inject: ['localAgent', ...]` and list the core as an npm dependency, which guarantees the core's **module resolves** — it does **not** make the host mount the core's row: `reconcilePlugins` activates only the profile's *direct* `dsh.bundle`-declaring dependencies, so a provider must have the core installed alongside it, and no provider patch may re-insert the core row itself — that would mount the core twice when several providers coexist; without the core the provider stays pending, never crashes) and the ui-file-preview client/host pair (the client probes the Remote and degrades when the host half is absent). Any new cross-package need follows this pattern: declare it, degrade without it, never assume it. **Independent, but compatible**: a plugin may integrate with a sibling when present (read its service, contribute to its slot) as long as the sibling's absence is invisible. Cross-package edges go in ONE direction only (companion → core): a name a package mentions purely as data (a preset-visibility probe's companion-row constant) is declared in the manifest's `dsh.references`, never in a dependency field — core↔companion edges in both directions form a cycle that pnpm's build sequencer schedules into one concurrent chunk, which raced cold builds (the companion's tsc started before the core's lib existed). pack-dist's family-edge check honors `dsh.references`.
- **Compatibility labeling**: every package carries a `Compatibility` section in both READMEs (verdict per host line: npm release vs deepseek-harness master) and the matching machine-readable `dsh.compat` field in package.json (`minHost`, plus `notes` when any item is degraded). Keep the two in sync on every host-API audit; after each official release, re-check whether the release now ships a degraded item's missing capability and retire the degraded path when it does.
- **DOM anchors are last resort**: prefer slots and public services; a DOM anchor must carry a fallback.
- **Tool origin tagging**: plugins registering model-visible tools (`ctx.tools.register`) tag each definition with its origin before registering: `setToolOrigin(def, { channel: 'plugin', owner: '<package name>' })` (helper + `TOOL_ORIGIN` exported from `@khorsheed/dsh-capability-catalog`; the tag is a `Symbol.for('dsh.tool.origin')`-keyed property — host-side only, never on the model wire). Shared tool modules that register on behalf of others (e.g. local-agent-tool-subagent) must derive `owner` from their config, never hardcode a package name. Untagged tools fall back to catalog's heuristics — tagging is incremental and optional, but new tools should ship tagged. Rationale and the retirement path live in [docs/upstream-seam-registry.md](docs/upstream-seam-registry.md) S13.

## Versioning and publish

- Semver per package, independent lines. Before publishing, check the registry (`npm view <name> version`): the new version must exceed it. Publishing at or below the published version fails 403/409.
- Publish via `scripts/pack-dist.ts` (`--family` rewrites scopes in peer deps) and verify the tarball before `npm publish`.
- The version in package.json is the next-release line; bump it when cutting a release, not per commit.
- The full lifecycle — three environments (link for throwaway dev instances, **tarball-only into prod 3080**, npm for the community), the 3080 acceptance gate, the flow-not-approval change model, release cadence, the thin meta-pack plan, and the npm-release bar — lives in [docs/ops.md](docs/ops.md). The npm pre-publish checklist and failure-modes table live in [docs/publishing.md](docs/publishing.md) — follow them, do not improvise.

## Ops

- Shipping a plugin to prod 3080 goes through the self-serve flow: `pnpm deploy:3080 --package <dir>` (scripts/deploy-3080.mts) — it runs the whole acceptance gate (build/test → pack-dist → profile refresh → credential → preflight → gated restart with canary watch) and prints the announcement. Any agent may run it; only the flow writes the profile.
- The prod instance is watchdog-supervised (ankh-guard). Restarts are gated by `dsh preflight --profile web` — a FAIL blocks the restart; never bypass the gate.
- ankh-guard binds restart credentials to git HEAD: run `build + test` before any restart-triggering change so the credential is green.
- The watchdog can roll the *checkout* back on repeated boot failure. Keep the harness checkout it guards disposable (see the deploy/tracking split in the consolidation note) — uncommitted work in a guarded checkout is at risk.
