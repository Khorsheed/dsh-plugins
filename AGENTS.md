# AGENTS.md

Community plugin monorepo for the dsh ecosystem. Every package publishes as `@khorsheed/dsh-*`. This repo is the **single source of truth** — the deepseek-harness in-tree copies are being removed, the archived standalone repos are read-only history.

The upstream host lives at `~/code/deepseek-harness` (env `DSH_HARNESS`). We track it, we do not modify it: plugin needs that require host changes go through the upstream-change pipeline, never through a local fork.

This file carries rules only. Rationale, incident history, and full procedures live in the docs and Agent Notes each section points to — follow the pointer when a task touches that area.

## Multi-agent concurrency

Several agents work this repo at once — follow these rules mechanically. The full collaboration model (worktree-only development, the three paths, the conflict rules) lives in [docs/development.md](docs/development.md).

- **Base new work on the latest local HEAD; push only when the human arranges it.** `git fetch origin`, then read `git status -sb`: local main usually runs **ahead** of origin (pushes are human-coordinated, so other agents' unpushed commits accumulate here), and then local HEAD IS the newest base — `git pull --rebase` is a no-op there. `behind > 0` means origin carries commits this checkout lacks: stop and coordinate, never rebase mechanically — it replays every unpushed commit in this shared checkout, other agents' included (docs/development.md 「推送与分支保护」). Commit each logical change as soon as it is green. Stage explicit paths only (`git add -A` / `git add .` / `git add -u` are forbidden — the index is shared checkout state); review `git status` + `git diff --cached` before committing.
- **Never develop in `/tmp`, `scratch/`, or any throwaway directory** — clone/branch inside this repo or nowhere.
- **Keep `main` green**: before every commit, `pnpm run build && pnpm run test` for the packages you touched. Commit each logical change separately.
- **Non-trivial changes carry an Agent Note** in `.agents/notes/` (format: `.agents/notes/README.md`) — it is how concurrent agents learn why a decision was made without a meeting.
- **Package-level ownership in flight**: before reworking a package, check `git log --oneline -3 -- packages/<pkg>` and recent notes for active work; never silently overwrite another agent's un-pushed direction.
- **Prod takes tarballs, not links.** The prod profile (`$DSH_HOME/profiles/web/package.json`, port 3080) references every package as a `file:` tgz; only `pnpm deploy:3080` writes it, and it packs from `lib/` — so build after every source change or the tarball ships a stale build. Coordinate restarts in the open.

## Build contract

- Host face before client face, always: `gen-typert` (packages with `./typert`/`./remote` exports) → `tsc` → `tsdown` — the client face's tsc consumes generated remote types. In a clean worktree the first command is always `pnpm install && pnpm run build` (the recursive workspace build runs in dependency order); a wall of "remote missing" from running client tsc first is an ordering error, not a package defect.
- Full-build gen-typert is freshness-cached (byte-identical inputs plus hash-verified outputs, so a stale hit is impossible). `GEN_TYPERT_FORCE=1` regenerates; scoped `GEN_TYPERT_ONLY` runs (deploys) bypass the cache.
- **Cross-host-version acceptance must force a clean recheck**: `tsc -b`'s incremental cache skips unmoved sources, so "all green" after a host-version jump can be a cache illusion. Before a cross-host-version full build, `find packages -name '*.tsbuildinfo' -delete` (companions in docs/ops.md 「构建卫生」).
- Browser bundles go through the shared helper `build/tsdown.client.ts` (`clientBundle`). Never hand-roll a `client.js` or copy the helper into a package.
- Tests run through `pnpm run test` / `pnpm --filter <pkg> test` only. Bare `vitest run` bypasses the source-plane alias preset (`build/vitest.ts`) and fails with misleading errors.
- `DSH_HARNESS` (default `~/code/deepseek-harness`) seeds dev-time type/test resolution and typert generation. CI: clone the harness first, set the variable, and keep it current — a stale checkout tests yesterday's API surface.

## Repo hygiene (pre-commit gate)

This repo is public — a hygiene check runs on every commit (`.githooks/pre-commit`; install once per clone with `pnpm hooks:install`). Run by hand: `pnpm check:hygiene` (staged set), `pnpm check:hygiene --all` (full audit), `pnpm check:hygiene -- <path>…`.

Checked: **absolute local paths** (`/Users/<name>/…`, `C:\Users\…`; the `/home/user` fixture placeholder is allowed), **credential-shaped strings**, and **tooling/scratch state** that must stay ignored (`.playwright-mcp/`, `scratch-*`, `*.tsbuildinfo`, `*.log`, `.DS_Store`, `node_modules/`, package `lib/`, `.env`). Sanitize machine-specific fixtures to `/home/user/…`; keep the checker's spec green via `pnpm test:scripts`.

Debug screenshots are scratch: image extensions (`*.png`, `*.jpg`, `*.gif`, `*.webp`) are gitignored, so they never enter a commit — delete them when the debugging session ends. Deliberate exceptions, both committed with `git add -f`: doc images in `docs/screenshots/`; package README screenshots in `profiles/basic/docs/screenshots/` (npm renders them from the dsh-basic mirror's raw URLs; the mirror sync wipes anything untracked there).

`pnpm check:plugins` (`scripts/check-plugin-independence.ts`) mechanically enforces the package conventions below; its spec re-runs it against the real tree, so `pnpm test:scripts` fails on a violation.

## Package conventions

- **Identity**: one package = one name = one loader entry id, declared in `cordis.patch.yml` (quote the `name:` value — `@` is YAML-reserved) and in the tsdown `clientBundle(id)`; both move together on any rename. The compat verdict lives in package.json `engines.dsh` (`>=<minHost> <0.3.0-0`). Bundle variants pinned by `check:plugins`: a patch carrying ONLY `@deepseek-ai/dsh-agent-preset` rows declares `dsh.bundle.kind: 'preset-declarations'`; a family bundle carrying exactly one preset row (id `preset-<mode>`) declares `kind: 'mode'` plus `dsh.bundle.mode`, mode values unique across mode bundles.
- **Self-mounting**: every installable plugin declares `dsh.bundle.patch` → `cordis.patch.yml`, listed in `files`, so `dsh plugin add <pkg>` mounts that package's own row; hand-edited profile YAML is a bug. No package's patch may mount another self-mounting package's row.
- **Client discovery**: browser halves declare `dsh.client` (`platform`, `inject`, `immediately`) in package.json.
- **Display metadata**: every self-mounting package ships `locale/en.json` **and** `locale/zh.json` with `meta.title`/`meta.description`, the `./locale/*.json` export, and the `locale/*.json` files entry — without them the plugin-manager card falls back to the raw package name. Titles are short product names with no `preset`/`plugin` suffix, unique per language (a bundle's title reads as a collection); the package.json `description` stays English. A package whose rows mount named subpath exports (`./tool`, `./agent`) also redirects the subpath's locale to the package root, or the host settings inventory page shows that row's bare module name:

  ```json
  "./tool/locale/*.json": "./locale/*.json"
  ```
- **Client artifacts**: `lib/client.js` must come from the shared `clientBundle` helper with its `window.__ModuleLoader__.load` registration header — a hand-rolled bundle is never claimed by the client module system, so the plugin silently does not load. `files` lists `lib/client.js` and `cordis.patch.yml`; `dsh.client.inject` declares the official client packages it extends.
- **Cross-package slot registration**: `slots.inject(key, () => slots.register(...))`, never a bare `slots.register` — apply order is not guaranteed, and a bare registration throws "slot … is not declared" at boot, failing the whole instance.
- **Dependencies**: official packages are peerDependencies with wide ranges plus `peerDependenciesMeta.optional` where loadable without; intra-repo deps use `workspace:*`. Never `workspace:^` across repos.
- **Degrade, don't explode**: probe optional host capabilities at apply time (`ctx.get`, `ctx.slots.spec`) and degrade silently or to an empty state — a plugin that throws on a missing capability fails the whole boot.
- **No inter-plugin dependencies by default** — each package must install, run, and uninstall alone; integrating with a sibling is fine as long as its absence is invisible. Sanctioned cross-package edges go ONE direction only (companion → core) and are allowlisted in `check:plugins`: the local-agent family (providers `inject: ['localAgent', …]` and npm-depend on the core, which must be installed alongside; without it the provider stays pending, never crashes — and no provider patch may re-insert the core row), and companion tool rows folded into their core package's `./tool` entry (they inject the family core as a service and stay pending until the core is provided — never probe at apply time). Any new cross-package need follows this pattern: declare it, degrade without it, never assume it. A name mentioned purely as data goes in the manifest's `dsh.references`, never a dependency field — bidirectional edges form a cycle that races pnpm's build sequencer; pack-dist honors `dsh.references`.
- **Compatibility labeling**: every package carries a `Compatibility` section in both READMEs and the matching `dsh.compat` field in package.json (`minHost`, plus `notes` for degraded items); keep the two in sync on every host-API audit, and retire a degraded path when an official release ships its missing capability.
- **DOM anchors are last resort**: prefer slots and public services; a DOM anchor must carry a fallback.
- **Mode visibility (self-hide)**: the axis is what the surface's CONTENT binds to. Session-bound surfaces (conversation tabs, session-header badges, frame entries rendering current-session state) self-hide on the preset-composition `pluginInventory` probe (fail-open on every unreadable path), gated by a registration-level toggle. Cross-session surfaces (deployment workspaces) get NO runtime switch — their mode visibility is the install layer. Tools and prompt sections ride the companion-row preset grant. Follow [docs/plugin-visibility.md](docs/plugin-visibility.md); never invent a per-package criterion.
- **Panel design (desktop + phone)**: a plugin panel is ONE layout that adapts to its own width — never a separate mobile version. Build on `@khorsheed/dsh-client-ui-panel-kit`, compact styles under `@container dsh-panel (max-width: 560px)`, type sizes via `--dsh-panel-*` with fallback, colors via `--dsw-alias-*`, host-only actions hidden when `browserOnHost()` is false; never depend on `@khorsheed/dsh-mobile`. `pnpm check:panels` enforces the mechanical part; [docs/panel-design.md](docs/panel-design.md) owns the rules and the component reference.
- **Tool origin tagging**: tag each model-visible tool with `setToolOrigin(def, { channel: 'plugin', owner: '<package name>' })` before registering (helper from `@khorsheed/dsh-capability-catalog`; the tag is host-side only, never on the model wire). Shared tool modules that register on behalf of others receive `owner` from the calling entry's own PACKAGE_NAME. New tools ship tagged; rationale in [docs/upstream-seam-registry.md](docs/upstream-seam-registry.md) S13.

## Versioning and publish

- Semver per package, independent lines; the package.json version is the next-release line, bumped when cutting a release, not per commit. Before publishing, `npm view <name> version` — the new version must exceed it (at or below fails 403/409). Publish via `scripts/pack-dist.ts` (`--family` rewrites scopes in peer deps) and verify the tarball before `npm publish`.
- The full lifecycle (link for throwaway dev, tarball-only prod 3080, npm for the community), the acceptance gate, and release cadence: [docs/ops.md](docs/ops.md). The npm pre-publish checklist and failure modes: [docs/publishing.md](docs/publishing.md). Follow them, do not improvise.

## Ops

- Shipping to prod 3080 goes only through the self-serve flow `pnpm deploy:3080 --package <dir>` (scripts/deploy-3080.mts) — it runs the whole acceptance gate (build/test → pack-dist → profile refresh → credential → preflight → gated restart with canary watch) and prints the announcement. Any agent may run it; only the flow writes the profile.
- The prod instance is watchdog-supervised (ankh-guard). Restarts are gated by its composition preflight — `deploy:3080` runs it as gate ⑤; by hand it is the ankh-guard CLI's `preflight` verb (there is no `dsh preflight` subcommand). A FAIL blocks the restart; never bypass the gate.
- ankh-guard binds restart credentials to the **harness checkout's** git HEAD; `deploy:3080` records them from its own green build+test. A pure same-launch restart (nothing changed) needs no record: `verify` first and reuse the canary-promoted deployment proof, then `schedule-exit`. NEVER `record --run -- pnpm run build && pnpm run test` against the harness checkout — its full suite is red on this machine, and `record` clears the existing credential and promoted proof before running, so a failed run leaves the gate with zero valid evidence.
- The watchdog can roll the *checkout* back on repeated boot failure — keep the harness checkout it guards disposable; uncommitted work in a guarded checkout is at risk.
