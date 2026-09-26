# Agent Note: host 0.1.7-rc.2 adaptation — breaking-change inventory and what we actually had to do

Status: implemented

English | [中文](2026-09-27-host-017-rc2-breaking-changes.zh.md)

## Problem

The host moved from 0.1.7-rc.1 (`46a7f68b`) to 0.1.7-rc.2 (`477b4f42`, 346 commits). Every plugin line needs a verified statement of what broke and what is new, and the eval-line coordinator asked for this inventory by category (typert shapes, preset registry, icons, session/tab API) so they can adapt without rediscovering it.

## Decision

Adopt rc.2 as the repo baseline in place (pins + CI tag), fix the single type stub it breaks, and keep every plugin on the wide peer ranges — the full categorized inventory below is what that decision rests on.

## The inventory (rc.1 → rc.2)

**Typert shapes — no change.** The four typert packages carry only the version bump and README re-recordings; the vendored schemastery tree is byte-identical; regenerated Remotes are equivalent to rc.1's. No plugin action.

**Preset registry — one removal.** `modeSelectionEnabled` is gone (`a44534e27`, PR #5108): `AgentPresetRegistry.Config` stops declaring it, the roster stops returning it, `remoteExportList()` returns only `presets`, and `defaultId` is now always `selectedDefault ?? default`. Chooser visibility moved to Developer tools (`configForms.developerTools`). A stale `modeSelectionEnabled` key in an old patch is silently ignored. Standing-scope mount timing and pending-row semantics did NOT change again after rc.1. Plugin action: drop any read of the field; cleaning the key from patches is optional. This repo: zero references.

**Icons — no renames, one component deletion.** No `Icon*Outline*` churn this time. `OnboardingSurface` was deleted from ui-primitives (zero references here). `IconQueueOutline{Regular,Medium}` now reuse the chat-lines glyph and `IconClockOutline*` was redrawn — same names, different pixels. New: `IconArchiveOffOutline*`, `MenuSurface`, `ShortcutKeys`, `useModalLayer`, `observeComposition`, `GuideArtwork*`.

**Session/tab API — additive only; no slot key or prop changed.** `conversation.view`, `sidebar.workspaces.session.*`, and header-action keys are unchanged. New surface worth knowing: `ComposerBarInjected.hooks.stopShortcut` (required reading only for plugins that render their own composer — none here), `ConversationBinding.openTurn`, ui-sidebar-right's `bindCommands({ refresh })` + `tab.refreshShortcut` + a focus/command method group (`openWithFocus`, `closeTarget`, `openTabFromTarget`, …) — this is the official answer to "right-pane tab wants a refresh affordance", additive and optional. ui-workspace adds two session-row slots (`sidebar.session.row.leading`, `sidebar.session.row.hover`, owner props `{ sessionId }`). ui-approval adds `displayReason` for localized approval explanations. Internal constant `DEVELOPER_TOOLS_VIEW_ID` renamed to `TRAJECTORY_VIEW_ID` (value still `'trajectory'`).

**The one thing that actually broke our build**: `ModelDirectoryState` (ui-model-selection) gained a required `pending: ModelSelection | null` (`d55f434cdf`, the directory now owns the in-flight selection). message-tools' never-rendered `EMPTY_MODEL_DIRECTORY_STATE` stub missed it (TS2741). Fixed by dropping the `: ModelDirectoryState` annotation and adding `pending: null` — a non-fresh binding is checked structurally, so the same literal compiles on both the rc.1 shape (where a fresh literal with `pending` would trip the excess-property check) and rc.2's. Pattern to copy for dual-line stubs of host state types.

**New official capability — `@deepseek-ai/dsh-client-shortcuts`.** Client service name `shortcuts`: `register(command)` (user-editable, throws on id/binding conflict), `registerFixed(command)` (read-only fixed keys), `catalog`/`fixedCatalog` snapshots, `edit()`, `recording()`. Plus `@deepseek-ai/dsh-client-ui-shortcuts`: a settings row and a `Cmd/Ctrl+/` reference panel. Both are ENABLED in the default web composition. Our ui-shortcuts rides it via the dual-path adaptation (own registry on ≤rc.1, contributes steerSend/compact to the official catalog on rc.2).

**Default web composition changes.** `time-context`, `schedule`, `ui-schedule` rows exist but are `disabled: true` (`cad6fef2fd`) — probes must treat "row present but disabled" as different from "not installed". The `llm-deepseek` row's package split into `dsh-llm-deepseek-api-key` + a new `llm-deepseek-account` row (row id unchanged; deployments that wrote fine-grained config onto the row must re-check fields against the new package — we did not). plugin-manager adds `ctx.pluginNavigation.openBundle(packageName)` (deep-link to a bundle detail page) and bounded waits when a previous operation's pnpm subtree outlives it. app-boot: bundle load failures now aggregate into `Profile.skippedBundles` printed once by the launcher instead of stderr at failure time.

**source.kind / format v4 producer constraints — no change.** Session-format packages are version bumps only.

## What we did for this adaptation

Baseline pins (`pnpm-workspace.yaml`, 174 entries) and the CI/publish workflow harness tag moved to rc.2; full acceptance with a tsbuildinfo purge (per the 构建卫生 rule): build green after the message-tools fix, tests green end-to-end. The eval/datasets/mission family additionally ran against the 0.1.5 checkout (`DSH_HARNESS=~/code/deepseek-harness-015`): **tests green** under 0.1.5 source resolution; the 015-checkout build fails exactly as it already did before this bump — `eval/src/job.ts` names 0.1.7-only `dsh-jobs` exports (`import type`, erased at runtime), and capability-catalog's `scoped-delivery.ts` imports the 0.1.7-only preset-registry package. The family's 0.1.5 line is a runtime-probe path by design (built once against the new baseline, dual-shaped at runtime); rc.2 touched none of it.

## Alternatives considered

**Pin every plugin's peer ranges to exact rc.2.** Rejected: the wide `^0.1.0-rc.6` peer ranges plus workspace `overrides` already pin the dev graph; narrowing peers would make the npm line uninstallable on older hosts for no gain.

## Consequences

main now builds and tests green against rc.2 with zero plugin-code changes beyond the one message-tools stub. Follow-ups worth doing (not blockers): right-sidebar tabs can adopt `bindCommands({ refresh })`; bundle cards can deep-link via `pluginNavigation.openBundle`.

## Testing

Full-monorepo `pnpm run build` + `pnpm run test` against `DSH_HARNESS=~/code/deepseek-harness-rc2` after a tsbuildinfo purge: both green. Eval family six packages against the 0.1.5 baseline: tests green; 015-checkout build fails on pre-existing 0.1.7-only type imports (see above), unchanged by this bump.

## Related

- [ui-shortcuts rides the official shortcuts service](2026-09-26-ui-shortcuts-official-service-dual-path.md) (dual-path details).
- [Preset tool rows declare their core as an inject](../bug-fix/2026-09-27-preset-tool-rows-declared-core-inject.md) — the rc.1-era mount-order lesson this inventory confirms unchanged for rc.2.
