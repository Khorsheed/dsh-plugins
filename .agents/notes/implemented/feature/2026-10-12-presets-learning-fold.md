# Agent Note: the learning preset folds into dsh-presets; bundle-learning retired; plugin-card display metadata becomes a convention

Status: implemented

Follows [the writing-preset fold](2026-10-06-writing-preset-fold.md).

## Problem

A plugin-list review surfaced three drifts:

1. 学习模式 shipped as its own one-row package `@khorsheed/dsh-bundle-learning` instead of living in the presets bundle, and the bundle's card text could not grow with the modes: the locale description still said 三种预设模式 while the patch already carried four (gamedev landed without a copy update).
2. Two self-mounting packages (canvas-novel, game) shipped no `locale/` at all, so their plugin cards rendered the raw package name; bundle-eval's zh card 评测 was identical to the eval member's card; context-lens's zh card was untranslated.
3. The conventions pinned the identity triangle, self-mounting and panels, but said nothing about display metadata — the gap was invisible until someone looked at the plugin list.

## Decision

- **One bundle for scene presets.** `preset-learning` moved into `@khorsheed/dsh-presets` verbatim — row id and preset id unchanged, so existing deployments keep their composition state — and `dsh.references` gained `@khorsheed/dsh-library`. The bundle's card copy no longer enumerates the roster ("…按会话授予人设与工具；模式随版本增加"); the per-preset provenance table in the README is where enumeration lives.
- **bundle-learning retired whole**, registered in `scripts/retired-packages.ts`. Unlike bundle-writing it WAS published (npm 0.1.0), so npm deprecation rides the next publish wave. 3080 order matters: drop bundle-learning from the profile BEFORE the new presets tarball lands — both installed mounts `preset-learning` twice.
- **Card metadata is load-bearing, so it is now checked.** The host discovers card text through the `locale/en.json` anchor (app-boot `package-meta.ts`) and falls back to the raw package name without it. canvas-novel and game gained their locale pairs (+ the `./locale/*.json` export and files entry); bundle-eval is 评测套件 / Evaluation Suite; context-lens's zh card is 上下文透镜. `pnpm check:plugins` now pins locale presence, both meta fields, the export/files entries, and per-language title uniqueness across self-mounting packages; AGENTS.md → Package conventions → Display metadata is the written rule (package.json `description` stays English — it is the host's ultimate `en` fallback and the npm copy; the five Chinese-primary descriptions were rewritten).

## Alternatives considered

- **One single-preset bundle per mode.** Rejected: the bundle's own description proves the shape does not scale, and preset-declarations packages are data — five rows in one patch are easier to audit than five packages.
- **A standalone display-conventions doc.** Rejected in favor of the repo's existing shape: a Package conventions bullet plus mechanical enforcement, the same pattern as check:panels.

## Consequences

- The published `@khorsheed/dsh-bundle-learning@0.1.0` stays installable forever (npm never reuses a name); the retired-registry entry keeps any in-repo composition from naming it again and makes `deploy:3080` warn while prod still carries it.
- `docs/packages.md` is regenerated (42 packages, 38 self-mounting); the five retired-package build leftovers (`packages/{datasets,eval,mission}-tool`, `request-inspector`, `story-bible` — gitignored `lib/`+`node_modules/` only) were deleted locally.
- Tests: presets `presets.spec.ts` (the learning row's grant, diet and quiet-list, ported from bundle-learning's spec; the evaluation-row isolation loop now covers learning), check-plugin-independence's new display-metadata describe.
