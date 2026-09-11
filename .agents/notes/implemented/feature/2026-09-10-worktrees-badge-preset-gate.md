# Agent Note: The worktrees badge preset gate (per-session UI self-hide pilot)

Status: implemented

English | [中文](2026-09-10-worktrees-badge-preset-gate.zh.md)

## Problem

The [mode-switcher proposal](../../../proposals/active/2026-08-26-mode-switcher.md) wants whole work modes (one profile = one plugin composition) to differ in what chrome a session shows. Before committing the ecosystem to that machinery we needed to validate the smallest version of the underlying question: can a session-scoped UI surface hide itself based on the current session's agent preset, with zero behavior change for everyone who never opts in? The worktrees session-header badge is the pilot — it is dev chrome, it already returns null while loading, and the harness's own `ui-agent-preset` header label already demonstrates the exact session-preset read.

## Decision

The worktrees plugin config grows an optional `visiblePresets?: string[]` (host-side schema default `[]`). Absent or empty keeps the badge unconditionally visible — the zero-change default. A non-empty list hides the badge in sessions whose `agentPreset` projection id is outside the list; sessions with NO preset projection stay visible (fail-open: the gate exists to hide dev chrome in non-dev sessions, never to break preset-less deployments).

The config reaches the browser through the plugin's own Remote: the host `apply` forwards `visiblePresets` into `WorktreesRemoteService`, which serves it from a new session-independent `badgeConfig()` method. The client half's `apply` never sees plugin config — the web boot composes client entries with `loader.create({ name })` and no config (verified in the harness's `packages/client/web/src/boot.ts` and the client-modules boot-manifest row shape, which carries only `id`/`inject`/`immediately`), and the context-guard/message-timeline "client apply second parameter" path is nominal on the web line — so the Remote is the minimal honest channel rather than a pretend client-config one. The badge fetches the gate once per mount, treats a pending/failed/errored fetch as no gate (fail-open in both directions), reads the preset via `useSessions` (`state.byId[sessionId]?.projectionValues?.agentPreset`, the ui-agent-preset read), and returns null when gated out; the existing loading-null behavior is untouched.

## Alternatives considered

**Client `apply(ctx, config)` entry config (the context-guard / message-timeline signature).** Rejected: on the real web line the boot hands client entries no config, so the parameter is always undefined there — the README-documented YAML config of those plugins actually flows host-side (settings base layer) and reaches the browser through `settingsScope`. Wiring worktrees to that signature would document a knob that silently does nothing.

**A settings section (settingsScope) instead of plain config.** Rejected for the pilot: registering a settings namespace, a settings card, and locale copy is the full context-guard machinery — disproportionate for a gate whose purpose is to be configured once per composition by the deployer, not toggled by end users. If the mode-switcher later wants live switching, the section can be added without changing the gate semantics.

**Folding the gate into `summary(sessionId)`.** Rejected: `SessionSummary` is the git-facts payload shared by badge and drawer; a composition-level display flag is not a session git fact and would pollute every summary consumer. A dedicated `badgeConfig` method keeps the wire vocabulary honest.

**Hiding preset-less sessions too (fail-closed).** Rejected: a deployment without agent presets would lose the badge entirely the moment anyone sets the list — the gate's stated purpose is hiding dev chrome where a preset says "not dev", so absence of information must read as "show".

## Consequences

Default behavior is byte-identical for every existing composition (empty list = no gate; the one extra `badgeConfig` RPC per badge mount is the only new traffic, and it resolves from memory). The gate is composition-wide, not per-user, and requires a restart to change — acceptable for a dev-chrome pilot. Coverage: `tests/badge.client.spec.tsx` pins the four gate semantics (no gate, preset in list, preset outside list, projection absent) plus the untouched loading-null; host config normalization rides the schemastery schema default. If the mode-switcher validates, this pattern (config → Remote → per-session self-hide via `useSessions`) is the template for other session-scoped chrome.

## Addendum (2026-09-11): the default criterion moved to official composition data

The [tool-row split](2026-09-11-worktrees-tool-split.md) changed the DEFAULT: with `visiblePresets` empty the badge no longer means "always visible" — it reads the official `pluginInventory.list()` preset-composition data and shows exactly when the session's preset names the `@khorsheed/dsh-worktrees-tool` row. `visiblePresets` survives as the manual override with the semantics this note pins; every fail-open path (no preset, no namespace, failed RPC, missing/broken group) is unchanged.
