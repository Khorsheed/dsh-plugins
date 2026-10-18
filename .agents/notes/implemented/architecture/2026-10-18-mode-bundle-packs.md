# Agent Note: Per-mode packs — the six `dsh-<mode>` mode bundles and the `@khorsheed/dsh-basic` family pack

Status: implemented

## Problem

The community modes (开发 / 写作 / 学习 / 剪辑 / 游戏开发 / 评测) shipped as two disconnected halves: `@khorsheed/dsh-presets` (a preset-declarations bundle carrying the six `preset-dsh-*` rows and nothing else) and the member plugins a mode's preset grants tools from, each installed one by one. Installing a mode meant knowing the roster by heart; installing only the presets gave a mode whose `xxx-tool` rows resolved to nothing. The family-bundle shape ([2026-09-24-family-bundle-meta-packages](2026-09-24-family-bundle-meta-packages.md)) already proved "one card, many rows" for local-agent and the evaluation family, but a mode pack needs one row MORE than a family bundle: the preset row that turns the family into a mode.

## Decision

`dsh.bundle.kind: 'mode'` (checker mechanics landed the same day, commit `99b7183b`) gets its fleet: six mode bundles, each a family bundle whose patch closes with exactly one `@deepseek-ai/dsh-agent-preset` row (id `preset-<mode>`, `dsh.bundle.mode` declaring `<mode>`, unique across the tree):

- `packages/dev` (`@khorsheed/dsh-dev`): local-agent core + the kimi/codex/claude-code/dsh providers, worktrees, room, typesafe; `local-agent-dsh-headless` rides along deps-only (same treatment as bundle-local-agent, sanctioned in `ALLOWED_EDGES`).
- `packages/writing` (`@khorsheed/dsh-writing`): canvas + canvas-novel.
- `packages/learning` (`@khorsheed/dsh-learning`): library.
- `packages/video` (`@khorsheed/dsh-video`): video-studio.
- `packages/gamedev` (`@khorsheed/dsh-gamedev`): game.
- `packages/bundle-eval` (`@khorsheed/dsh-bundle-eval`): upgraded family → mode `dsh-eval`; members and the 评测套件 card unchanged, version line untouched (still unpublished 0.1.0).

`packages/basic` (`@khorsheed/dsh-basic`) stays `kind: 'family'`: eighteen members, no preset row — there is no "basic mode".

The preset row is a VERBATIM mirror of the same-named row in `@khorsheed/dsh-presets`, appended after the member rows in the same `- insert:` list. Drift is a red test: `scripts/preset-mode-parity.spec.ts` compares each mode bundle's row against the presets copy (parsed `plugins:` composition plus `name`/`description`/`order` — unlike the web-eval parity, `order` must match, both copies riding the same deployment's chip list), and `scripts/eval-preset-parity.spec.ts` is now three-way (web-eval canonical ↔ presets ↔ bundle-eval). The two specs share `scripts/preset-row-blocks.ts` (`rowLines`/`unquote`/`composition`/`field`). When the presets package retires (next release wave), the mode bundles' patches become the canonical copies — each patch header says so — and the parity spec is deleted.

One deliberate deviation from verbatim-member-rows: canvas's own patch mounts `canvas-agent` ENABLED at the profile root (the every-session community default), while preset-dsh-writing grants the same entry — the two live at once register the same tool names twice and fail the boot. The writing bundle therefore replaces that root mount with a bare `- id: canvas-agent / disabled: true` override (3080's profile has carried the same override by hand; the bundle now encodes it). The checker sanctions it: an override whose id matches a member's canonical row is inside the allowlist. canvas-novel's and game's `./agent` root rows already ship disabled in their own patches and copy verbatim.

Each bundle pins its composition in `tests/bundle.spec.ts` (rows = members' canonical rows via `parseTopLevelPatchRows` + exactly one preset row + per-member contribution), and carries the usual surface: locale card metadata, bilingual README, CHANGELOG, the constants-only `src/index.ts` (`MODE` / `FAMILY_MEMBERS` / deps-only or override rosters where they exist).

`dsh.compat.minHost` is the HIGHER of the members' highest floor and the preset-row mechanism floor: an `@deepseek-ai/dsh-agent-preset` declaration row exists only on host 0.1.7-rc.1+. This bites dev (members floor 0.1.5-rc.1 → bundle floors 0.1.7-rc.1) and video (same); learning (library 0.1.7-rc.1), gamedev (0.2.0-rc.1), writing (canvas-novel 0.2.0-rc.2) and bundle-eval (0.2.0-rc.2) are at or above it already.

## Alternatives considered

**Keep modes in @khorsheed/dsh-presets, document "also install these packages".** Rejected: that is the status quo — the mode and its family install separately, and nothing stops a preset from naming tool entries the profile cannot resolve. The mode bundle makes the mode ONE install with the family guaranteed present as hard dependencies.

**Fold the preset row into the family CORE package (e.g. canvas carries preset-dsh-writing).** Rejected: a self-mounting package's patch must not mount another package's rows without the family sanction, and a core that installs a mode forces the mode on everyone who wants the core alone. The bundle keeps "install the plugin" and "install the mode" as separate choices.

**Bundle-local-agent gains the preset row instead of a new dsh-dev package.** Rejected: its card and name say "the local-agent family"; dev mode is wider (worktrees/room/typesafe are not local-agent members). A mode bundle's members are exactly the family its preset grants from.

## Consequences

- `scripts/check-profile-bundles.ts` learned to read `dsh.bundle.members` for `kind: 'mode'` too (it keyed on `'family'` only; the mode-kind commit updated check:plugins and deploy:3080 but missed this one — bundle-eval's web-eval profile turned red the moment the kind flipped). It now imports `FAMILY_LIKE_KINDS` from check-plugin-independence so the two cannot drift again.
- The mode bundles and the presets bundle overlap by design while both exist (same `preset-<mode>` row id in two family-like patches — exempt from the row-id ledger; installing both collapses to the same declaration). The presets package's retirement is the cleanup point.
- `docs/packages.md` regenerated (48 packages, 45 self-mounting); seven new/changed i18n sidecars recorded.
- npm: six new 0.1.0 lines (`@khorsheed/dsh-basic`, `-dev`, `-writing`, `-learning`, `-video`, `-gamedev`) await the next release wave; bundle-eval ships its mode upgrade at its first publish.

## Testing

Per package: build + test green against the 0.2.1-rc.1 harness tree (DSH_HARNESS=deepseek-harness-021) — basic 6, dev 6, writing 7, learning 6, video 6, gamedev 6, bundle-eval 8. Repo gates: `pnpm check:plugins` 48 packages 0 findings; `pnpm test:scripts` 388 passed (preset-mode-parity 18, eval-preset-parity 3, check-profile-bundles 18); `pnpm check:profiles` / `check:release-groups` / `check:packages` / `check:hygiene --all` all clean; all seven packs `pack-all-dist`-packed and verified.
