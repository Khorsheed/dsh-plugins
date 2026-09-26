# Agent Note: capability-catalog resolves rc.1 preset scopes through the leased roster face (dual-face probe, caller-owned release)

Status: implemented

## Problem

rc.1's `@deepseek-ai/dsh-agent-preset-registry` deleted `standingKeyFor(id)` and replaced it with `acquireScope(id?)`, a LEASED read: the promise resolves to `{ key } & AsyncDisposable`, the `retain()` behind it increments the preset generation's user count, and a lease never released pins that count, so an unregistered preset's scope is never collected. Unknown presets reject `agent-preset/not-found`; broken ones reject `agent-preset/invalid` carrying the mount diagnostic. `list()` (with its `broken` rows) and the `defaultId` getter are unchanged.

capability-catalog's `resolvePresetScope` probed only `standingKeyFor`. On rc.1 every probe therefore fell into the "no roster" branch and silently degraded to the global layer: `snapshotAt('standard')` answered the global face with no `preset` stamp, and `snapshotFor` / `modeFaces` / preset-scoped skill delivery along with it. Measured on the 3093 instance against a healthy seven-preset roster with no broken rows: every per-mode read was the global layer. The degrade branch is the honest behavior for a rosterless composition — which is exactly why a wrong-face probe hid inside it without a sound.

## Decision

`packages/capability-catalog/src/preset-scope.ts` owns both roster faces behind one normalized read. `PresetRosterSlice` gains an optional `acquireScope(id?)`, the lease typed as `unknown`: the key is opaque to the catalog, and `Symbol.asyncDispose` is untyped under the repo's es2024 target, so the release is read structurally through a cast — any runtime hosting an rc.1 roster defines the symbol, because the roster's own lease literal is keyed by it. A new exported `acquireStandingScope(roster, id)` prefers the lease-free 0.1.5 `standingKeyFor` when present and otherwise leases through `acquireScope`, returning `{ key, dispose? }`.

`resolvePresetScope` keeps its signature and its strict/degrade contract verbatim on both faces — a listing still degrades to the unlabelled global layer, a fingerprint still throws naming the preset and the reason, with `agent-preset/not-found` / `agent-preset/invalid` messages riding the existing wording — and its result gains an optional `dispose`. Three rules keep the lease honest:

- A keyless read (the roster resolved no standing scope) is released by the resolver itself; no caller ever sees that lease.
- A caller holding the key across reads disposes in a `finally` after the LAST read. `collect` wraps its whole body in one try and now `return await`s `catalogSnapshot`, so the release cannot precede the fingerprint's body loads. `catalogScope` releases right after acquisition: the roster reaps a generation only once its preset is unregistered AND unleased, so releasing cannot unmount a live preset's scope — the same guarantee the lease-free 0.1.5 key carried. scoped-delivery's `resolveKey` releases after the key read; its delivery entries mint their own scope from the key and own that lifetime themselves.
- A release failure is logged, never thrown into the read it followed.

## Alternatives considered

**Probe `acquireScope` first.** Rejected: on a roster offering both faces the leased read would levy a retain/release pair for what the old face answers for free, and preferring the lease-free face keeps the 0.1.5 line byte-identical where both exist.

**Acquire once and hold the lease until plugin unload.** Rejected: that is precisely the leak rc.1's refcount exists to catch — a preset unregistered at runtime would never collect its scope — and it reinstates the "the standing mount is free" assumption the host just deleted.

**Type the lease as `AsyncDisposable` and add `esnext.disposable` to the shared tsconfig lib.** Rejected: widening the lib for one symbol changes every package's type environment; a structural read through a cast keeps the blast radius inside one module.

## Consequences

Bought: per-mode capability reads work on rc.1 again — the mode picker, `snapshotAt` / `snapshotFor`, `modeFaces`, and preset-scoped delivery all resolve real preset scopes — while the 0.1.5 line is untouched (its face is preferred when present), and neither face leaks a generation user. The strict/degrade wording is shared, so a fingerprint refusal reads the same on both host lines.

Cost: the probe order is one more face of host API to track, and the `dispose` contract is an optional property — a future consumer that ignores it compiles fine and leaks. The three current consumers are the enforcement; any new one must follow the same try/finally shape.

## Testing

`packages/capability-catalog` carries 232 tests (+6). The new cases pin the rc.1 arm: resolution and preset labelling through an acquireScope-only roster, exactly one release after the caller's read, resolver-side release of a keyless lease, broken and unknown presets degrading a listing and refusing a fingerprint with the 0.1.5 wording, and the 0.1.5 face winning when both are present. The scoped-delivery spec boots a real composition against a leased roster: delivery lands in the named preset's layer with exactly one release per resolved preset, and a broken preset becomes a per-preset status error rather than a delivery failure.

## Related

- [The capability hash — making a condition's `preset` checkable](../../implemented/feature/2026-09-11-capability-hash-and-sub-dsh-preset.md) — the listing/fingerprint split this fix keeps honest on rc.1.
- [The capability catalog's mode view](../../implemented/feature/2026-09-20-capability-catalog-mode-view.md) — the surface whose per-mode reads silently fell back to the global layer.
- [The community agent presets ship as one declarative bundle (host 0.1.7-rc.1)](../../implemented/feature/2026-09-24-community-presets-declarative-bundle.md) — the same rc.1 preset mechanism, from the declaration side.
