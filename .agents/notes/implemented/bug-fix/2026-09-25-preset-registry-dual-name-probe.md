# Agent Note: preset-registry consumers dual-name-probe the module at runtime — pack-dist strips dependencies, and 0.1.5 has no install gate

Status: implemented

## Problem

The 0.1.7-rc.1 host renamed the official package `@deepseek-ai/dsh-agent-presets` to `@deepseek-ai/dsh-agent-preset-registry` — the API (`resolve` / `mount` / `livePresetMounts` / `agentPresetProjectionDefinition`) carried over unchanged. 0.1.5/0.1.6 hosts install only the old name; 0.1.7 hosts install only the new one.

The rc.1 adaptation wave rewrote the three consumers' value imports of that package as top-level STATIC imports of the new name. That is fatal on 0.1.5 for a reason specific to how this repo ships: pack-dist deletes `dependencies` from the published manifest (`@deepseek-ai/*` is externalized and resolved against the HOST's install tree at runtime), so a value import of an `@deepseek-ai/*` specifier is a hard requirement that a package of exactly that name exists in the host's install tree. On a 0.1.5 host the loader-entry import dies with `Cannot find package '@deepseek-ai/dsh-agent-preset-registry'`, the whole plugin tree fails to load, and the instance never boots. And 0.1.5 has no install-time version gate at all: the tarballs install cleanly, and boot is the first moment anything can refuse — so a runtime probe is the only line of defense that exists on that host line.

The post-0.1.5 audit found exactly one renamed package name in value-import position, at four points: `packages/ankh-guard/src/index.ts` (the preset-derivation namespace), `packages/capability-catalog/src/scoped-delivery.ts` (`livePresetMounts`), `packages/capability-catalog/src/client/preset-display.ts` (the `/display` subpath — safe: tsdown inlines it into the browser bundle, no runtime import survives), and `packages/room/src/agent-setup.ts` (the derivation namespace). Verified against the 0.1.5 checkout: the old-name package exports both `livePresetMounts` and `agentPresetProjectionDefinition`, so probing through to it on 0.1.5 yields FULL function, not a degrade.

## Decision

Each of the three packages owns a minimal dual-name probe loader in the module that already consumes the package (no new cross-package dependency), with a module-level cached promise and an exported reset seam for tests:

```ts
let presetRegistryProbe: Promise<unknown> | undefined

export function loadPresetRegistry(): Promise<unknown> {
  presetRegistryProbe ??= import('@deepseek-ai/dsh-agent-preset-registry')
    .catch((): unknown => import('@deepseek-ai/dsh-agent-presets'))
    .catch((): null => null)
  return presetRegistryProbe
}
```

Three rules make the probe safe:

- Both specifiers stay static string literals: tsdown externalizes them (the old name is an optional peer) and tsc type-checks them (the old name is a devDependency, `^0.1.0-rc.6` — npm's published old-name line). One consumer of that resolution context was not the package tsc but gen-typert's harness overlay, which has no copy of the old-name package: `scripts/gen-typert.mts` now aliases the old name onto the new name's source-plane mapping in the overlay tsconfig paths — the surfaces are identical by upstream contract, and every consumer casts structurally anyway.
- Never `createRequire`: the host's vendored loader resolves through an install-anchor fallback that `createRequire` bypasses, so the probe itself would fail on exactly the production topology (3080) it must keep working on.
- New name first: on 0.1.7+ the resolution is byte-identical to the pre-fix static import; on 0.1.5/0.1.6 the old name answers full function; with neither (a preset-less host) the probe settles `null` and the consumer takes its established no-preset degrade — the same outcome a preset-less session always had.

Per-package wiring:

- **ankh-guard** (`src/index.ts`): the static namespace import is deleted; `buildResumeOptions` — already async — awaits `loadPresetRegistry()` and passes `(host ?? {}) as PresetDerivationSurface` to `deriveSessionPreset`, whose `{}`-in/undefined-out/fallback-to-deployment-default contract is unchanged.
- **capability-catalog** (`src/scoped-delivery.ts`): `ScopedSkillDelivery.start()` (async) preloads the probed module's `livePresetMounts` into a private field before the first reconcile; `liveKeys()` returns the empty set while the field is undefined (a file event can fire before `start()` completes, and on a host with neither name it stays undefined) — the same semantics the call's own pre-existing catch branch already encoded: nothing is KNOWN to be live, registrations for needed presets are kept, only stale generations are dropped.
- **room** (`src/agent-setup.ts`): the exported `agentPresetsDerivationHost` namespace constant is replaced by a module-level `probedHost = {}`, a `presetDerivationHost()` getter, and `preloadPresetDerivationHost()`; `RoomService`'s constructor (the plugin's apply) runs the preload as its first `ctx.effect`, and both derivation call sites (`roomSessionPreset`, the cold-room load in `src/index.ts`) read the getter. Every derivation happens on the resume/create paths that run after apply, so the probe always lands first.

package.json, one rule across the three: the old name joins `devDependencies` (`^0.1.0-rc.6`, compile-time resolution) and `peerDependencies` marked `optional: true` — the established spelling of "may be absent"; the host compatibility gate only semver-checks installed packages, so 0.1.5/0.1.6/0.1.7 all pass. The new-name peer moves to optional in ankh-guard and room (their use was always probe-shaped); capability-catalog keeps the new name in `dependencies` (compile-time resolution — pack-dist strips it, runtime resolves through the loader).

## Verification

Builds and full test suites are green for all three packages (ankh-guard 215 across its lane inventory, capability-catalog 241, room 296). New per-package probe specs mock BOTH names to reject: the loader settles `null` instead of throwing (and caches it), ankh-guard's and room's derivation receives `{}` and yields `undefined` — the deployment-default fallback already pinned by their existing derive specs — and catalog's `start()` completes with `liveKeys()` empty while delivery into the named preset's layer is unaffected.

Real-machine 0.1.5 evidence (proof profile with the three tarballs — capability-catalog 0.1.95, ankh-guard 0.3.0, room 0.1.0 — installed from the fixed `lib/`): all three `lib/index.js` artifacts now IMPORT cleanly against the 0.1.5 install tree, where the boot previously died with `Cannot find package '@deepseek-ai/dsh-agent-preset-registry'`; the probe chain resolves to the old-name module and its `agentPresetProjectionDefinition` folds a header-plus-selection log correctly (`from-header` → `switched`) — full function on 0.1.5, not a degrade. A real 0.1.5 boot on port 3095 now passes the module-import phase with zero `Cannot find package` and zero `failed to import loader entry`.

The boot then died one phase LATER on a second, independent 0.1.5 incompatibility this change deliberately did not touch: the 0.1.5 typert-loader validates every invocation codec as an EAGER zod-v4 `schema`, while the current (rc.1) typert generator emits a LAZY `create()` factory — the 0.1.7 loader accepts `create`, the 0.1.5 loader rejected it (`parameter codec is not backed by a zod v4 schema`). The published capability-catalog 0.1.95 tarball's face was byte-identical to the regenerated one, so this second blocker predated the probe fix and was merely masked by the import-phase death. It is now fixed by dual-shape codec emission at the gen-typert write seam — see [typert strict codecs emit both an eager `schema` and a lazy `create()`](../../implemented/bug-fix/2026-09-25-typert-codec-dual-shape.md) — and with both layers shipped the same three tarballs boot the 0.1.5 proof profile clean.

The 0.1.7 path needed no re-verification beyond the probe order: the new name is tried first, so 3080 (rc.1) resolves exactly as before the fix and was not touched.

## Alternatives considered

**Raise `minHost` to 0.1.7 across the three packages.** Rejected: the npm stable host line is still 0.1.5, and — decisively — 0.1.5 has no install-time version gate, so a raised floor would not stop a 0.1.5 user from installing the tarball and having the instance killed at boot. On a gate-less host the only defense is runtime probing.

**Probe synchronously through `createRequire`.** Rejected: it bypasses the vendored loader's install-anchor fallback resolution, so the probe itself fails to resolve on the production topology (3080) it must keep working on; and only the static-literal dynamic-import form is what tsdown externalizes and tsc type-checks.

## Consequences

Bought: the three packages boot on 0.1.5 with FULL preset function (the old name answers), keep byte-identical resolution on 0.1.7+ (the new name is probed first), and degrade instead of dying on a preset-less host. The invariant is now explicit for the whole repo: a pack-dist-published package's `@deepseek-ai/*` value import is a hard dependency on that exact name in the host's install tree, so any upstream rename — or any newly-added official package a plugin wants — goes through a dual-name runtime probe, never a top-level static import.

Cost: the first preset derivation / mount-list read per process pays one cached asynchronous probe per package; three modules carry a probe plus a test seam that a future single-name world could delete; and gen-typert's overlay paths now carry one rename alias to retire if the old name ever disappears from plugin sources.

## Related

- [capability-catalog resolves rc.1 preset scopes through the leased roster face](../../implemented/bug-fix/2026-09-24-capability-catalog-rc1-leased-scope.md) — the same rc.1 adaptation wave, from the roster-face side.
