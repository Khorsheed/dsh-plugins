# Agent Note: The worktrees tool-row split (session-granted model tools)

Status: implemented

English | [中文](2026-09-11-worktrees-tool-split.zh.md)

## Problem

The [mode-switcher proposal](../../../proposals/active/2026-08-26-mode-switcher.md) needs community model tool rows to live in agent presets, never at the profile root — a session gets a tool exactly when its preset grants it, and modes differ without a restart. The worktrees plugin was a fused package: it provided the `worktrees` service, mounted the Remote data face, AND registered the model-facing `worktrees` tool at the profile root, so the tool was granted to every session of every preset. A fused package cannot enter a preset at all: the official preset mount rejects any row that `ctx.provide`d a service outside an isolate realm (verified live on 3092). The badge's self-hide pilot ([the gate note](2026-09-10-worktrees-badge-preset-gate.md)) additionally left a maintenance smell: the `visiblePresets` hand-maintained list duplicates what the preset composition files already say.

## Decision

**Split the tool row into a companion package** (`@khorsheed/dsh-worktrees-tool`), the local-agent core/companion pattern sanctioned by `check-plugin-independence` (a deliberate `ALLOWED_EDGES` + `NO_OWN_PATCH` entry):

- The companion provides NO service (the only preset-mountable shape) and registers the one model tool, delegating to the global `ctx.worktrees` service core the main plugin still provides at the profile root — the official tool-row shape (the shipped `tool-bash` rows consume host services the same way).
- The companion declares NO `dsh.bundle` patch: installing it as a dependency only makes the module resolvable (the `@khorsheed/dsh-local-agent-dsh-headless` plain-dependency precedent); granting happens by naming the row in a preset's `agent.cordis.yml`. `static inject = []` — the worktrees service is probed with `ctx.get` at apply time and the row silently skips registration when the core is absent (a preset naming it still mounts cleanly); the tools registry joins through deferred `ctx.inject` (the mount-order race lesson carried over from the in-core registration).
- The tool-definition factory (`defineWorktreesTool(service)`) is exported from the core's `./tool` entry so business logic is not copied; the companion applies its own origin tag — attribution follows the mounting package.
- The core **stops registering the tool at the profile root (BREAKING)**; UI/service/Remote are untouched. Migration: install the companion and name the row in the target preset (the web-dev dev preset already carries it).

**The badge's default visibility criterion now reads the official composition data**, not the hand list: the client probes `ctx.get('remote.pluginInventory')` (never injected — a namespace-less host must not pend the client), fetches `pluginInventory.list()` once per mount, and shows the badge exactly when the current session's preset group names the `@khorsheed/dsh-worktrees-tool` row. `visiblePresets` stays as a manual override (a non-empty list gates exactly as the pilot pinned). Fail-open on every unreadable path: no namespace, failed RPC, a missing or `broken` preset group, and preset-less sessions all keep the badge.

**The dev mode preset** (`profiles/web-dev/presets/dev`) is the shipped consumer: the official `standard` composition (0.1.5-rc.1) plus the three local-agent delegation tool rows (the web-eval patch shape minus `tools: none`) and the `worktrees-tool` row; `profiles/web-dev/scripts/install.sh`/`update.sh` drop it into `$DSH_HOME/.agent-presets/dev` (the web-eval form — presets are pack apparatus replaced whole, the roster is per-HOME and outlives the profile). The pack's patch layer stays the user's; nothing pins the default preset there.

## Alternatives considered

**A second export inside the core package (`@khorsheed/dsh-worktrees/tool` as the mountable row).** Deferred, not rejected: whether the Loader mounts a package's non-default export as a plugin row is unverified; the companion-package form is the proven local-agent precedent and `check-plugin-independence` already knows how to police it. If the loader supports subpath rows later, the companion can collapse back into the core with no wire or behavior change.

**Keeping an opt-in config switch for the root registration in the core (back-compat flag).** Rejected: a `registerTool?: boolean` knob would carry the old global-grant shape forward as a permanent second path, and every composition would have to know which of two granting semantics is live. The break is announced in the CHANGELOG/README with a two-line migration, and the companion row restores the tool wherever a deployment actually wants it.

**Fail-closed when the inventory is unreadable.** Rejected, same reasoning as the pilot's fail-open: a pre-0.1.5 host has no `pluginInventory` namespace at all, and hiding the badge there would silently remove shipped UI on upgrade for every older-line deployment. Fail-open keeps those lines byte-identical to before (badge always visible), which is exactly the old default.

**Hiding when the row is present but `disabled`.** Deferred: the criterion reads row PRESENCE (the proposal's "组合里有我的行"). A dormant-but-present row is a composition the deployer deliberately wrote; presence-only keeps the read one field wide. Revisit if a real pack ships dormant tool rows and expects the UI to follow the grant rather than the name.

## Consequences

- **Breaking, announced**: sessions lose the `worktrees` model tool on upgrade unless their preset names the companion row; badge/sidebar/service/Remote are unchanged. The two-line migration (install companion, add row) is in the core README and CHANGELOG.
- **Default visibility on 0.1.5 changed for companion-less deployments**: a 0.1.5 profile whose presets name no `worktrees-tool` row now hides the badge by default (composition criterion); the `visiblePresets` override restores explicit control. Pre-0.1.5 hosts are unaffected (no namespace → fail-open → the old always-visible default).
- **Sanctioned-pair surface grew**: `check-plugin-independence` gained the `worktrees-tool → @khorsheed/dsh-worktrees` edge and a `NO_OWN_PATCH` entry; the checker's spec keeps the tree conformant.
- Live-verified on 0.1.5-rc.1 (port 3299, throwaway HOME): the dev preset's session-plugins group lists the row (count 28→32 with the delegation rows), live-mount reads report `fiberPhase: active` for it, the badge flips cleanly between dev and standard sessions with zero console errors, the composed profile carries no `worktrees-tool` row, and removing the package marks the dev preset `broken` ("row ... cannot be resolved") while the instance boots and other presets mount fine. Evidence: `scratch-screenshots/m4-*.png`. Real model calls of the tool are deferred to the 3080 acceptance (no API key in the pilot instance), recorded in the verification report.
