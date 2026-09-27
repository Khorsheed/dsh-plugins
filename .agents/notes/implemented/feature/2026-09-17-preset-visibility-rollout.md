# Agent Note: preset visibility rollout — sidebar tab self-hide (single/double check) and slash commands move to companion rows

Status: implemented

English | [中文](2026-09-17-preset-visibility-rollout.zh.md)

## Problem

The 2026-09-17 convention doc (docs/plugin-visibility.md) drew the line and the full-repo matrix found the gaps: the worktrees right-sidebar tab was unconditionally registered while its own badge already self-hid (a self-contradiction), the canvas tab had no gate even though 3080 already scopes its tools to the writing preset, and the `/eval` `/datasets` `/mission` slash commands registered at the profile root, so they appeared in every session's completion list although their tools exist only where a preset grants them. This note records the rollout that closed those gaps (proposal: `proposals/active/2026-09-17-preset-visibility-rollout.md`).

## Decision

**A1 — worktrees right-sidebar tab self-hides at the registration level** (`packages/worktrees/src/client/preset-visibility.ts`). The criterion is the badge's, verbatim (a non-empty `visiblePresets` overrides; otherwise the official `pluginInventory` composition data; every unreadable path fails open, including the no-session home state). Hidden means NOT registered: the guide enumerates the tab-type registry, opened tabs are stored per session (an ungranted session's layout never held one), and an unregistered kind renders the host's designed `tab.unavailable` fallback. The badge keeps its component-level gate; the row constant moved to the new module and the badge imports it.

**A2 — canvas right-sidebar tab self-hides on a TWO-PATH criterion** (`packages/canvas/src/client/preset-visibility.ts`). The `./agent` entry mounts in two legal shapes — profile-root (the package's own patch default: tools in every session) or preset-scoped (the writing recipe: root row disabled, the entry named in the preset). The criterion therefore checks the inventory's `entries` for an ENABLED `@khorsheed/dsh-canvas/agent` row first (a deployment-level constant grant), and only then the current session's preset group. Checking only the preset slice would hide the entry forever in the community default shape — that is the 2026-09-16 incident's complete lesson: the mistake was never "a preset gate on the entry" but "a criterion that does not enumerate every grant path" (back then NO row existed in any preset, so the criterion was constantly false).

**A3 — the slash commands moved into the companion packages.** The host's `CommandDefinition` carries no visibility predicate and the client completion list has no filter seam, but the OFFICIAL precedent answers it: `/goal` `/plan` `/compact` hide by registering inside preset-mounted rows, landing in the preset's scope layer (`web-app/cordis.patch.yml` disables the root rows). So `/eval` `/datasets` `/mission` register from eval-tool / datasets-tool / mission-tool via `ctx.inject(['commands'], …)`, delegate to the core service probed with `ctx.get`, and carry a roster guard (`agentPresets.composedPreset` + `compositionInventory()`, fail-open) as the belt-and-braces fallback for direct invocations. Zero upstream change; the client's per-session directory and `agent-preset/selected` refresh do the rest.

**Not done, deliberately**: the local-agent family's four provider settings cards and member composer stay always-on — a settings card's content binds the INSTANCE (provider credentials), the settings page has no current session, and the composer's select already matches only family delegation sessions (the A4 re-classification, recorded in the convention doc). `/<harness>` and `/local-agent` stay put (runtime-dynamic registration; moving them drags the harness callback along — a separate topic). The helper package is still not extracted: with this rollout the inlined copies number seven (eval/mission/datasets/room + worktrees badge variant + worktrees tab + canvas tab), which TRIPS the mode-switcher M3' "fifth consumer" decision point — the helper's home is now owed a decision, scheduled as its own change.

## Alternatives considered

- **A client-side completion filter for slash commands** — rejected: `ui-commands`' `candidates()` admits host rows unconditionally; there is no seam. The scope-layer move is the official mechanism and needs no seam.
- **A registry/config center mapping presets to visibility** — rejected (mode-switcher section C): the preset composition file is the single source of truth.
- **Waiting for an upstream `available?(agent)` predicate** — the upstream ask stays on the mode-switcher proposal's enhancement list; the scope-layer move ships today and remains correct even if the predicate lands.
- **Gating canvas on the preset slice only** — the incident re-run; see A2.

## Consequences

- Behavioral: in dev, standard-preset sessions no longer see the worktrees tab (the badge already hid); on 3080, only dsh-writing sessions see the canvas tab; in web-eval, `/eval` `/datasets` `/mission` appear only in eval-preset sessions. The no-session home state fails open everywhere (entries visible).
- Breaking: the slash commands leave the profile root — sessions without the grant lose the completion entries (the point) and direct invocation gets the guard's error text.
- canvas's client `inject` regains `sessions`; `@deepseek-ai/dsh-api-session-controller` returns as a devDependency (the revert had dropped both).
- docs/plugin-visibility.md: the cheat sheet gains the slash and settings-card rows; the criterion axis now reads "a verdict value on every grant path + a self-consistent hide semantics"; the anti-pattern list pins "not enumerating every grant path".
- Tests: worktrees 84 green (+12 criterion/toggle cases), canvas 177 green (+10, including the community-default regression guard), the six slash packages' suites green.

## Testing

Per-package `pnpm run build && pnpm run test` green in the worktree; the criterion specs pin every fail-open path, the override, the legacy top-level preset key, and the toggle's register/dispose flips. Live acceptance on 3080 follows the deploy flow (canvas: only writing sessions show the tab; a root-mounted deployment keeps it everywhere).

## Related

- [The convention doc](../../../docs/plugin-visibility.md) and [its process note](2026-09-17-plugin-visibility-convention.md).
- [The canvas self-hide revert](../feature/2026-09-16-canvas-preset-self-hide-reverted.md) — the incident A2's double check completes.
- [The worktrees badge gate](../feature/2026-09-10-worktrees-badge-preset-gate.md) — the criterion A1 reuses.
- [The mode-switcher proposal](../../../proposals/active/2026-08-26-mode-switcher.md) (section C; M3' owns the helper decision this rollout trips).
