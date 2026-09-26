# Agent Note: preflight-runner mounts the runtime resolution it computes (tarball-profile false FAIL)

Status: implemented

## Problem

On the runtime-resolution host lines (0.1.6 and 0.1.7), a profile tree's plugin imports resolve only through an in-memory interception: `createRuntimeResolution` (0.1.7; `createProfileResolutionGeneration` on 0.1.6) computes an immutable package table, and the launcher's boot prepare mounts it in-process via `hostCtx.plugin(PluginPackages, { resolution })` — nothing is written into the profile's `node_modules`. The preflight runner computed the same value at compose time and then **discarded it**: its `boot()` prepare never mounted `PluginPackages`, so entry imports fell back to native Node resolution. On a tarball profile — every plugin installed as a `file:` tgz into the profile's own pnpm-shaped `node_modules`, which holds no `@deepseek-ai/*` entries at all — native resolution finds nothing, and the dry-run reported ~176 official packages as "failed to import" (exit 1) on a profile whose real boot was verified clean. The rc/0.1.2 lines were unaffected: their `healProfilesModuleFallback` materializes real fallback links, so native resolution works. The 0.1.7 probe added in the [rc.1 adaptation wave](../architecture/2026-09-24-host-017-rc1-adaptation.md) mirrored the compose-side call but missed the boot-side mount, so the bug shipped exactly when the compat instances moved to tarball profiles on rc hosts.

## Decision

The runner mirrors the launcher's boot prepare end to end, per host line:

- `composePreflightPatches` keeps the computed value and returns it on the composition as `pluginPackagesConfig` — `{ resolution }` on the 0.1.7 line, `{ generation }` on the 0.1.6 line (the config key each line's `PluginPackages` service actually reads, verified against the launcher's `runProfile` on both lines). On the heal-based lines (rc, 0.1.2) the field is absent — their launcher mounts nothing, and materialized links carry resolution.
- `composePreflightPatches` also builds the launcher-owned `profileContext` service value field-for-field (`name`, `dir`, `patchPath`, `installAnchor`, `startedBundles`, `cwd`, `home`, `overlays`, `telemetryDisabledEnv`) on the 0.1.6/0.1.7 lines, whose launchers have provided it since 0.1.6-alpha.2. Without it the 0.1.7 `settings` service — `static inject = ['configEditor', 'profileContext']` — never activates, and every settings-dependent apply the contract promises to exercise stays pending.
- `runPreflight`'s boot prepare follows `runProfile`'s order: provide `profileContext`, provide the launch environment, `await hostCtx.plugin(PluginPackages, composed.pluginPackagesConfig)`, then `provideCmdline` — all inside prepare, so the interception is installed before `boot()` mounts the root include and every entry import routes through it. A missing `PluginPackages` export on a line whose compose produced a mount config is thrown, surfacing as a FAIL verdict (the next real boot would fail the same way).
- Providing `profileContext` satisfies the `hmr` row's disable expression (`!ctx.get('profileContext')`), which would start the dev file watchers in a one-shot dry-run — the boot's own tree write-back queues a config refresh on hmr's operations queue and `dispose()` then awaits a queue that never drains (observed: preflight hung past boot, process exited 13 on an unsettled top-level await). The runner's documented contract is "no HMR, no user-patch watchers", so on the lines where `profileContext` is provided the compose appends a dry-run overlay `{ id: 'hmr', disabled: true }` when the composition carries the row.

The verdict contract is untouched: 0 clean, 1 composition verdict, 3 infrastructure. No diagnostic was relabeled to make the failure go away — the resolution is now actually installed.

## Alternatives considered

**Treat import failures as warnings, or otherwise soften the audit.** Rejected: exit codes 0/1/3 are the contract the guard's gated restart consumes; softening would pass genuinely broken trees through the one gate that exists to stop them.

**Materialize fallback links for the new lines (revive the heal in the runner).** Rejected: the 0.1.7 host deleted the projection functions outright, so the runner would have to re-implement host internals and — worse — write into the deployment's profile directory, the exact side-effect class the in-memory design exists to eliminate.

**Provide `profileContext` but leave the hmr row active.** Rejected empirically: the dry-run then hangs in `dispose()` (hmr's operations queue awaits a refresh that never settles once the tree is tearing down), and a dry-run must not own file watchers regardless.

**Skip `profileContext` and accept the pending-`settings` warnings.** Rejected: the exit code stayed 0, but the settings service and its dependents never applied, so the dry-run silently stopped booting "the whole plugin tree" the module contract claims to verify — a coverage hole on exactly the line where settings became central.

## Consequences

Bought: the dry-run boots the same module graph the real launcher boots — the tarball-profile false FAIL is gone (the compat017rc2 repro went from 177 failed entries / exit 1 to `preflight PASS` / exit 0, output line-identical to a real boot), and the settings subtree's applies actually run under preflight. The fix rides the launcher's own service (`PluginPackages`), so future host-line changes to routing rules arrive through the same seam the drift tripwire already watches.

Cost: the runner now mirrors one more piece of launcher state (`profileContext`, field-for-field) — another hand-maintained mirror surface the drift tripwire cannot fully pin (it compares composition, not boot prepare). The hmr row is disabled in dry-runs on the runtime-resolution lines, so an hmr-apply regression would slip through preflight on those lines — accepted, as hmr was never exercised by any dry-run line (it self-disabled without `profileContext` before).

## Testing

`tests/preflight-drift.spec.ts` gains a fixture-based describe (a fake built host surface: install anchor + stub `dsh-app-boot`/`dsh-home-paths`/`dsh-launch-environment`/`dsh-cmdline` packages) that pins, per host line: the 0.1.7 mount passes the compose-produced object through as `{ resolution }`, the 0.1.6 mount as `{ generation }`, the prepare order (profileContext → launch environment → PluginPackages → cmdline), the heal-based lines mounting nothing and building no `profileContext`, the hmr-disable overlay present exactly when `profileContext` is provided, and a boot failure with the mount in place still exiting 1. The lane inventory in `scripts/run-test-lane.mjs` accounts for the five new tests.

## Related

- [host 0.1.7-rc.1 adaptation wave](../architecture/2026-09-24-host-017-rc1-adaptation.md) — added the fourth-generation probe whose compose-side mirror missed the boot-side mount.
