# Agent Note: retire dsh-ui-shortcuts — the host owns shortcut settings now

Status: implemented

## Problem

`@khorsheed/dsh-ui-shortcuts` (`packages/ui-shortcuts`) shipped a community shortcut action registry (`ctx.shortcuts`), five default actions, and a settings card with per-action rebinding. Since host 0.1.7-rc.2 the official client carries built-in, rebindable shortcut settings: an official `shortcuts` service resident in the web-app bundle owns the same `shortcuts` cordis key, so on current hosts the package's own provide, settings card, and keydown layer all disabled themselves and what remained was a thin steer of two command defaults (`ui-shortcuts.steerSend` / `ui-shortcuts.compact`) into the official registry. A whole package — tests, locales, host-API adaptation every wave — to contribute two command defaults is cost without benefit, and its unpublished 0.2.5 delta was pure host-021 adaptation chores: nothing is lost by retiring it.

## Decision

The package retires whole — directory deleted, no successor package:

- `scripts/retired-packages.ts` gains the registry entry (replacement: the host's built-in rebindable shortcut settings, the ≥ 0.1.7-rc.1 line; the npm name is deprecated at 0.2.4), so `check:profiles` fails any composition that names it again.
- `profiles/basic` and `profiles/eval` drop the dependency and the bundles row. The eval pack's `install.sh` drops the member from `UNPUBLISHED_DIRS` and its three count comments step down one (22 tarballs / 18 direct @khorsheed dependencies / 23 distinct dump names); both eval READMEs move the same numbers (21 members / 18 direct dependencies, base-experience group 12 → 11), and both dev READMEs drop `shortcuts` from the dsh-basic recommendation list.
- `COMMUNITY_SERVICE_INJECTORS` loses its `shortcuts: /^ui-shortcuts$/` row — the key is the official host service now, so no community owner remains.
- The install-spec-floor spec's parser fixture moves to `@khorsheed/dsh-whalesong` (it had named the retired package as example text).
- `docs/packages.md` regenerates (49 → 48 packages); `docs/release-status.md` loses the row by the same single-row hand removal the typesafe-tool fold used (a full regeneration would churn unrelated npm columns).

The unpublished 0.2.5 repo line (host-021 adaptation) never ships; npm keeps 0.2.4 as the final published version, deprecated registry-side outside this change.

## Alternatives considered

- **Keep publishing the package for old hosts (the 0.1.2 – 0.1.7-rc.1 lines).** Rejected: the published 0.2.4 stays on npm and keeps working on those hosts exactly as before — retirement ends development, not the artifact. Carrying host-021+ adaptation for a package whose only remaining audience is frozen old lines would be chore churn for no user.
- **Keep it in profiles/basic as an optional enhancer.** Rejected: on ≥ 0.1.7-rc.2 hosts the package already degraded itself to contributing two command defaults to the official registry — a bundle seat for that is weight without function, and the basic README had already dropped it from the member story.
- **Fold the two extra command defaults into another community package.** Rejected: the official shortcut catalog and rebind panel own this surface now; a community package re-offering command defaults would compete with the host's own registry semantics. Rebinding lives in the host's settings panel.

## Consequences

- Old hosts (0.1.2 – 0.1.7-rc.1) keep their install path: `@khorsheed/dsh-ui-shortcuts@^0.2.4` remains on npm, deprecated but installable; the repo simply no longer develops it.
- The `shortcuts` service name now belongs to the host alone; any future community `inject: ['shortcuts']` reads to check-plugin-independence as an official-service inject.
- packages/quote keeps three prose mentions of "the ui-shortcuts `ctx.shortcuts` precedent" (source comments, READMEs, compat notes) — they cite a design lineage, not an installable edge, and other packages' sources stay untouched in this change.
- Pre-existing skew NOT fixed here: the basic profile README promises 14 members including context-lens, but `profiles/basic/package.json` never carried context-lens — after this change the profile has 13 dependencies while the README still says 14. Adding context-lens belongs to the basic-suite update that already announced it.
