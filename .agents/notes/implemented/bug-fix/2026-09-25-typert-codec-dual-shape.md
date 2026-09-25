# Agent Note: typert strict codecs emit both an eager `schema` and a lazy `create()` — dual-shape for the 0.1.5↔rc.1 loader split

Status: implemented

## Problem

The typert strict-codec contract changed shape between host lines. The 0.1.5 typert-loader validates and consumes an EAGER zod-v4 instance: `requireStrictCodec` (packages/typert/loader/src/index.ts:263-274 @ 0.1.5) demands `mode: 'strict'`, a `typeSymbol`, and `codec.schema` carrying `_zod` and `parse`; `TYPERT.schemas` entries are checked the same way (:82-88). rc.1 replaced the instance with a LAZY factory: the same function (:265-284 @ rc.1) demands `codec.create` be a function, and the rc.1 protocol type carries `create: () => TypertSchema`. Neither loader rejects the other line's key — each validates and reads only its own.

The rc.1 generator followed the rc.1 loader: schemas emit as memoized lazy factories (`const X$schema = () => (X$schema$value ??= z…)`, recursion deferred through `z.lazy`), and codec literals carry only `create: X$schema`. Any typert face regenerated against the rc.1 harness therefore fails 0.1.5's manifest validation — `parameter codec is not backed by a zod v4 schema` — and the 0.1.5 boot dies in the typert-loader's apply phase, taking the whole plugin tree with it. This was pre-existing in the published capability-catalog 0.1.95 tarball (its face is byte-identical to a fresh regeneration); it surfaced only because the [preset-registry dual-name probe](../../implemented/bug-fix/2026-09-25-preset-registry-dual-name-probe.md) fixed the import-phase death that had been masking it. The blast radius is every package with a typert face (15 packages × host and remote-client faces — the 0.1.5 browser-side typert runtime consumes the same old shape), not one plugin. And 0.1.5 has no install-time version gate, so the failure can only ever be caught at runtime, on the host itself.

## Decision

Dual-shape emission at our own write seam. `scripts/gen-typert.mts`'s `generate()` owns the callback that writes every generated artifact; before writing a `.js` artifact it runs `dualShapeCodecs(content)`, which rewrites every `create: <identifier>,` literal into the same line plus `schema: <identifier>(),` at the same indentation. `.d.ts` artifacts are untouched.

Why one narrow transform is safe and sufficient:

- **0.1.5 reads `schema`**: one eager factory call materializes the zod instance. The factory's own `$value` memoization makes that call return the same single instance every later `create()` hands out (`create() === schema`), and all recursion is `z.lazy`-deferred, so the eager call never re-enters a factory mid-construction.
- **TDZ safety is verified, not hoped-for**: across all 30 generated faces every factory const is declared before the first manifest literal that references it, and no factory body calls another factory directly (checked mechanically before the transform was written). Inserting `<factory>()` at the literal site can never touch the temporal dead zone.
- **rc.1 reads `create`**: byte-identical to before, so the current host line is unchanged by construction.
- **Each loader ignores the other's key**, so the extra key costs nothing on either side.
- **One literal shape covers every emission site**: invocation parameter/result/Context codecs and `TYPERT.schemas` entries all emit as `create: <ident>,` (today every face's `schemas` list is empty; the transform covers entries the day one appears).
- **The freshness cache needs no special handling**: the script itself is a hashed cache input, so this edit invalidates the stamp and one forced full build regenerates every typert package — exactly the intended coverage.

## Verification

A forced full regeneration (`GEN_TYPERT_FORCE=1 pnpm run build`) left all 30 faces across the 15 typert packages carrying `schema`+`create` pairs, with zero unpaired `create:` literals remaining. Node import assertions on the capability-catalog and room faces confirm for every codec: `schema._zod !== undefined`, `typeof create === 'function'`, and `create() === schema` (the memoized single instance). The full-repo build is green; the three proof packages' full build+test suites are green (ankh-guard 215, capability-catalog 241, room 296); `pnpm test:scripts` is green (223, including the new `dualShapeCodecs` pins).

Real 0.1.5 boot: the three repacked tarballs (capability-catalog 0.1.95, ankh-guard 0.3.0, room 0.1.0) install into the proof profile and the instance boots on port 3095 with no `failed to import loader entry`, no `not backed by a zod v4 schema`, and no `plugin tree failed to load`; the log carries the capability-catalog / ankh-guard / room fibers and `curl /` answers 401 without a token (303 with one). rc.1-side regression needs no restart: the rc.1 loader validates only `create`, which is byte-identical — 3080 was not touched. The rc.1 loader's only other codec checks are the same `requireStrictCodec`'s three call sites plus the `TYPERT.schemas` entry check, all `create`-only; there is no third strict shape to pair.

## Alternatives considered

**Raise `minHost` to 0.1.7 for the typert-faced packages.** Rejected: 0.1.5 has no install-time version gate, so a raised floor does not stop a 0.1.5 user from installing the tarball and having the instance killed at boot — the same reason the probe layer rejected it.

**Request loader tolerance upstream (accept both keys) and wait.** Rejected as the fix: the upstream-change pipeline could land that for FUTURE host releases, but the 0.1.5 hosts already published never receive it — the artifact itself must speak both shapes. The request may still be filed as the retirement path.

**Pin the last 0.1.5-shape faces by never regenerating.** Rejected: that was the de facto state the freshness cache created, and it broke the moment a legitimate full regeneration happened (this very compatibility wave) — the published 0.1.95 tarball already carried the rc.1-only shape. Faces must track the current generator, so the compatibility has to live in the write seam, not in avoiding it.

## Consequences

Bought: every current and future regenerated typert face boots on both host lines, and the 0.1.5 verification gate (clean boot plus an HTTP answer) passes end-to-end for the three proof packages. The compatibility lives in exactly one place — the write seam in our own tooling — so the upstream generator and both upstream loaders stay untouched per the track-don't-fork rule.

Cost: generated `.js` artifacts grow by one line per codec literal (about a thousand lines across the repo today), and the transform assumes the generator's single `create: <ident>,` emission shape — a future generator that emits codecs in a second form must revisit `dualShapeCodecs` (the verification step's zero-unpaired-literals check is the tripwire). When the supported host lines no longer include schema-era loaders, the function and its spec delete cleanly.

## Related

- [preset-registry consumers dual-name-probe the module at runtime](../../implemented/bug-fix/2026-09-25-preset-registry-dual-name-probe.md) — the first 0.1.5 boot blocker, whose fix unmasked this one.
