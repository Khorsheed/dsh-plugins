# Agent Note: Per-mode packs — the six `dsh-<mode>` mode bundles and the `@khorsheed/dsh-basic` family pack

Status: implemented

## Problem

The community modes (开发 / 写作 / 学习 / 剪辑 / 游戏开发 / 评测) shipped as two disconnected halves: `@khorsheed/dsh-presets` (a preset-declarations bundle carrying the six `preset-dsh-*` rows and nothing else) and the member plugins a mode's preset grants tools from, each installed one by one. Installing a mode meant knowing the roster by heart; installing only the presets gave a mode whose `xxx-tool` rows resolved to nothing. The family-bundle shape ([2026-09-24-family-bundle-meta-packages](2026-09-24-family-bundle-meta-packages.md)) already proved "one card, many rows" for local-agent and the evaluation family, but a mode pack needs one row MORE than a family bundle: the preset row that turns the family into a mode.

## Decision

`dsh.bundle.kind: 'mode'` (checker mechanics landed the same day, commit `99b7183b`) gets its fleet: six mode bundles, each a family bundle whose patch closes with exactly one `@deepseek-ai/dsh-agent-preset` row (id `preset-<mode>`, `dsh.bundle.mode` declaring `<mode>`, unique across the tree):

- `packages/dev-suite` (`@khorsheed/dsh-dev-suite`): local-agent core + the kimi/codex/claude-code/dsh providers, worktrees, room, typesafe; `local-agent-dsh-headless` rides along deps-only (same treatment as bundle-local-agent, sanctioned in `ALLOWED_EDGES`).
- `packages/writing-suite` (`@khorsheed/dsh-writing-suite`): canvas + canvas-novel.
- `packages/learning-suite` (`@khorsheed/dsh-learning-suite`): library.
- `packages/video-suite` (`@khorsheed/dsh-video-suite`): video-studio.
- `packages/gamedev-suite` (`@khorsheed/dsh-gamedev-suite`): game.
- `packages/eval-suite` (`@khorsheed/dsh-eval-suite`): upgraded family → mode `dsh-eval`; members and the 评测套件 card unchanged, version line untouched (still unpublished 0.1.0).

`packages/basic` (`@khorsheed/dsh-basic`) stays `kind: 'family'`, with no preset row — there is no "basic mode". It started with eighteen members; the reader and capture moved to the learning/writing packs, sidechat left and ui-shortcuts retired (2026-10-19 to 10-22), and on 2026-10-24 ankh-guard and context-lens moved to the dev pack, leaving twelve. The rule behind the last move: basic holds what an everyday user wants in every session; ankh-guard only matters on a watchdog-guarded, self-modifying instance and context-lens is a debugging view of model requests, so both are developer tools. capability-catalog stays in basic as an everyday "what can this instance do" view.

The preset row is a VERBATIM mirror of the same-named row in `@khorsheed/dsh-presets`, appended after the member rows in the same `- insert:` list. Drift is a red test: `scripts/preset-mode-parity.spec.ts` compares each mode bundle's row against the presets copy (parsed `plugins:` composition plus `name`/`description`/`order` — unlike the web-eval parity, `order` must match, both copies riding the same deployment's chip list), and `scripts/eval-preset-parity.spec.ts` is now three-way (web-eval canonical ↔ presets ↔ bundle-eval). The two specs share `scripts/preset-row-blocks.ts` (`rowLines`/`unquote`/`composition`/`field`). When the presets package retires (next release wave), the mode bundles' patches become the canonical copies — each patch header says so — and the parity spec is deleted.

Companion rows have since gone composition-only — see [2026-10-19-composition-only-companion-rows](2026-10-19-composition-only-companion-rows.md): pack patches insert member ROOT rows only, the inline preset grants the `./tool` / `./agent` entries per session, and member patches ship their agent rows ENABLED so standalone installs work out of the box (same-id profile + preset rows shadow rather than fail the boot on host 0.2.x). The `canvas-agent` bare override and the disabled `game-agent` / `canvas-novel-agent` handle rows this fleet started with are gone.

Each bundle pins its composition in `tests/bundle.spec.ts` (rows = members' canonical rows via `parseTopLevelPatchRows` + exactly one preset row + per-member contribution), and carries the usual surface: locale card metadata, bilingual README, CHANGELOG, the constants-only `src/index.ts` (`MODE` / `FAMILY_MEMBERS` / deps-only or override rosters where they exist).

`dsh.compat.minHost` is the HIGHER of the members' highest floor and the preset-row mechanism floor: an `@deepseek-ai/dsh-agent-preset` declaration row exists only on host 0.1.7-rc.1+. This bites dev (members floor 0.1.5-rc.1 → bundle floors 0.1.7-rc.1) and video (same); learning (library 0.1.7-rc.1), gamedev (0.2.0-rc.1), writing (canvas-novel 0.2.0-rc.2) and bundle-eval (0.2.0-rc.2) are at or above it already.

**Package names carry `-suite` (2026-10-24, before first publish).** The six mode packs publish as `@khorsheed/dsh-<mode>-suite` (`dsh-dev-suite`, `dsh-writing-suite`, `dsh-learning-suite`, `dsh-video-suite`, `dsh-gamedev-suite`, `dsh-eval-suite`). The trigger was the eval pack: `@khorsheed/dsh-eval` is the evaluation core, so the pack could not take the plain `dsh-<mode>` form. The rest followed for one rule: the package name matches the card title (「…套件」), and stays distinct from the same-named mirror repos and collections (`Khorsheed/dsh-dev` is the dev collection's front door, `@khorsheed/dsh-dev-suite` is the bundle it installs). Directories, preset ids (`dsh-dev`, …) and row ids are unchanged, so sessions and settings are unaffected. None of the old names was ever published, so nothing needs deprecating.

**gamedev and video carry the multi-agent family (2026-10-24).** Both packs add the local-agent core, the four delegation providers and the room as members (rows verbatim, the same ones bundle-local-agent and dev mount; local-agent-dsh-headless rides deps-only), and their presets grant the three local delegation tools, `room-tool`, and the official `tool-subagent-control` / `list-agents` so the agent can wait on, read and stop what it started. The official spawn/fork subagent tools stay out: these modes delegate to the local agents, not to in-process dsh children. Why the pack and not an add-on: packages alone grant nothing (tools ride the preset), so "install bundle-local-agent next to the mode" would leave the mode's sessions without the tools; and a mode pack is meant to be a complete install for an ordinary user. Cost accepted: users without the codex / claude CLIs see provider cards in a pending state. Note for the video mode: its preset has no shell by design (shell would bypass the proposal discipline), but a delegated codex / claude-code run has its own shell — delegation is a deliberate widening the user chose.

## Alternatives considered

**Keep modes in @khorsheed/dsh-presets, document "also install these packages".** Rejected: that is the status quo — the mode and its family install separately, and nothing stops a preset from naming tool entries the profile cannot resolve. The mode bundle makes the mode ONE install with the family guaranteed present as hard dependencies.

**Fold the preset row into the family CORE package (e.g. canvas carries preset-dsh-writing).** Rejected: a self-mounting package's patch must not mount another package's rows without the family sanction, and a core that installs a mode forces the mode on everyone who wants the core alone. The bundle keeps "install the plugin" and "install the mode" as separate choices.

**Bundle-local-agent gains the preset row instead of a new dsh-dev package.** Rejected: its card and name say "the local-agent family"; dev mode is wider (worktrees/room/typesafe are not local-agent members). A mode bundle's members are exactly the family its preset grants from.

## Consequences

- `scripts/check-profile-bundles.ts` learned to read `dsh.bundle.members` for `kind: 'mode'` too (it keyed on `'family'` only; the mode-kind commit updated check:plugins and deploy:3080 but missed this one — bundle-eval's web-eval profile turned red the moment the kind flipped). It now imports `FAMILY_LIKE_KINDS` from check-plugin-independence so the two cannot drift again.
- The mode bundles and the presets bundle overlap by design while both exist (same `preset-<mode>` row id in two family-like patches — exempt from the row-id ledger; installing both collapses to the same declaration). The presets package's retirement is the cleanup point.
  **Retired 2026-10-24**: `packages/presets` is deleted and `@khorsheed/dsh-presets` is listed in `scripts/retired-packages.ts`; each mode pack's patch is now the only copy of its preset row, `scripts/preset-mode-parity.spec.ts` is deleted, and `scripts/eval-preset-parity.spec.ts` is two-way again (web-eval pack ↔ eval mode pack).
- `docs/packages.md` regenerated (48 packages, 45 self-mounting); seven new/changed i18n sidecars recorded.
- npm: six new 0.1.0 lines (`@khorsheed/dsh-basic`, `-dev`, `-writing`, `-learning`, `-video`, `-gamedev`) await the next release wave; bundle-eval ships its mode upgrade at its first publish.

## Testing

Per package: build + test green against the 0.2.1-rc.1 harness tree (DSH_HARNESS=deepseek-harness-021) — basic 6, dev 6, writing 7, learning 6, video 6, gamedev 6, bundle-eval 8. Repo gates: `pnpm check:plugins` 48 packages 0 findings; `pnpm test:scripts` 388 passed (preset-mode-parity 18, eval-preset-parity 3, check-profile-bundles 18); `pnpm check:profiles` / `check:release-groups` / `check:packages` / `check:hygiene --all` all clean; all seven packs `pack-all-dist`-packed and verified.
