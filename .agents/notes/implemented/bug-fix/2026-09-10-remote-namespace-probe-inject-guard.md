# Agent Note: Remote namespace probes must go through ctx.get, not property access

Status: implemented

English | [中文](2026-09-10-remote-namespace-probe-inject-guard.zh.md)

## Problem

Live verification of the [local-files open-in-app restore](../feature/2026-09-10-local-files-open-in-app-restore.md) on a 0.1.5-rc.1 instance surfaced a dead gesture: the workspace tab's "choose workspace" button threw `cannot get property "remote.directoryPicker" without inject` on every click. The gesture had silently died with the 0.1.2 adaptation, which probed the picker namespace by property access — `(ctx.remote as unknown as { directoryPicker?: … }).directoryPicker`.

## Decision

Property access on `ctx.remote` resolves through the context proxy (`vendor/cordis/src/reflect.ts`), which enforces per-fiber visibility: a service registered by another plugin's fiber is reachable only when the consuming fiber declares it in `inject`. Declaring `remote.directoryPicker` was rejected — a namespace absent from the host composition (every host line before the picker seam existed) never registers, and an injected-but-never-provided service pends the whole plugin: the workspace tab would vanish on old hosts instead of degrading one button. The probe therefore reads `ctx.get('remote.directoryPicker')` — the reflect mixin reads the root store without the inject requirement and returns undefined when unprovided, which the picker gesture already translates to a cancelled-shaped null. The `pick()` RemoteResult envelope handling was already correct (verified against the official `UiWorkspaceService.pickDirectory`).

## Alternatives considered

**Declaring `'remote.directoryPicker'` in `inject` (the official ui-workspace pattern).** Rejected for a community plugin: ui-workspace ships inside the composition that always provides the namespace; local-files must stay loadable on compositions and host lines that have no picker at all, where the inject would pend the entire plugin.

**Wrapping the property access in try/catch.** Rejected: it silences the crash but leaves the gesture dead exactly where it should work — the namespace is present on 0.1.5; only the access path was wrong.

## Consequences

The "choose workspace" gesture works on 0.1.5 (live-verified on the 3092 instance: no console error, the picker RPC dispatches) and stays cancelled-shaped where the namespace is absent. The same `ctx.get` probe pattern already carried `remote.localFiles` in the same file; the mistake was the one property-access probe introduced by the 0.1.2 adaptation. Any future "probe an optional Remote namespace" code in this repo uses `ctx.get`, never `ctx.remote.<ns>`.
