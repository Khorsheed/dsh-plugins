# Agent Note: typert-faced tarballs carry zod as a real dependency — a generated face's bare `import 'zod'` must never drink a profile-hoisted zod@3

Status: implemented

## Problem

Every generated typert face (`lib/typert.host.js`, `lib/typert.remote-client.js`) begins with a bare `import { z } from 'zod'`, and every strict codec's zod schema is built from whatever that specifier resolves to **in the install tree at runtime**. pack-dist strips `dependencies`, so until this change no tarball pinned that resolution: it landed on whatever the profile's hoisted linker put at the root `node_modules/zod`.

The full-line 0.1.5 verification (42 packages in one profile) showed what that means in practice. `@khorsheed/dsh-capture` legitimately ships `puppeteer-core` as a runtime dependency (`dsh.runtimeDependencies`, consumed via dynamic import); puppeteer-core → chromium-bidi → `zod@3.25.76`, and the hoisted linker placed exactly that v3 at the profile root. All 15 typert-faced packages then resolved `zod` to v3, every generated schema came out brand-less (v3 classic carries `spa`/`_def`/`parse`, no `_zod`), and the 0.1.5 typert-loader's `_zod` brand check rejected all 13 initially-scanned contributors — boot dead, whole plugin tree down. The rc.1 loader performs no brand check, so on that line the same composition **silently runs v3 codecs**: measured on the live 3080 profile, whose root `zod` is 3.25.76 today — a latent production bug this change also closes. Smaller profiles (the three-package proof profile) only escaped because with no v3 present the faces climbed through the loader's install-anchor fallback to the host's own zod@4.

## Decision

`scripts/pack-dist.ts`'s `rescopePackageJson` gains a third keep-rule beside family edges and `dsh.runtimeDependencies`: when the manifest's `exports` carries `./typert` or `./remote`, `zod` joins the keep set and survives into the dist manifest verbatim. A typert-faced package that declares NO zod dependency now fails packing loud — the error names the root-cause chain — because silently stripping it would author exactly this failure.

The mechanism is ordinary package-manager resolution, not a new concept: with `zod: ^4.4.3` as a real dependency of every typert-faced tarball, pnpm either hoists v4 to the profile root (what happened in verification: root `zod@4.6.5`, chromium-bidi's v3 nested at `chromium-bidi/node_modules/zod`) or nests v4 inside each package when the root is taken. Both layouts resolve every face's bare import to v4 deterministically, on both host lines, for npm consumers and file:-tarball profiles alike — no per-profile manual override, and chromium-bidi keeps the v3 its own manifest declares.

## Verification

`pnpm test:scripts` is green (226; three new `rescopePackageJson` pins: zod kept for a typert-faced manifest, dropped for a face-less one, loud failure for a typert-faced manifest without zod). All 42 non-presets packages repack clean; the room tarball's `dependencies` is exactly `{ zod: ^4.4.3 }` while the face-less ankh-guard tarball keeps none. In the rebuilt 42-package proof profile — **capture included, which is the whole point** — per-package resolution checks show 15/15 typert faces resolving `zod@4.6.5` while chromium-bidi resolves its own nested 3.25.76; node import assertions on four sampled faces confirm `_zod: true` and `create() === schema`. The 0.1.5 boot on port 3096 is clean: zero `plugin tree failed to load` / `failed to import loader entry` / `Cannot find package` / `not backed by a zod v4 schema`, the instance listens, `curl /` answers 401, and a 65-second window logs no errors. 3080 was deliberately not touched; eliminating the silent v3 codecs there rides the next human-decided deploy wave.

## Alternatives considered

**Pin `zod: ^4` through each profile's pnpm overrides.** Rejected: it makes every consumer profile hand-carry the fix — npm-installed users get nothing, a forgotten override silently recreates the poisoned profile, and the artifact remains non-self-sufficient. The dependency belongs to the artifact that bears the import.

**Override capture's chain off zod@3** (force chromium-bidi onto v4). Rejected: it rewrites a third-party package's declared range and adopts puppeteer's runtime compatibility as our own risk — and it treats one known v3 producer while any future dependency bringing any zod@3 reintroduces the same poisoning.

**Do nothing for the rc.1 line, since its loader skips the brand check.** Rejected: the brand check is the 0.1.5 line's only voice for a problem that exists on both — measured on 3080, strict codecs are materializing v3 schemas in production right now, an unobserved correctness exposure on the stable deployment.

## Consequences

Bought: every typert-faced tarball — current and future — self-pins its face's zod to v4 on both host lines and for npm consumers; capture's legitimate puppeteer chain coexists with 14 other typert faces in one profile; and the next deploy wave can retire the silent v3 codecs on 3080 without a code change. The rule is keyed on the `exports` shape, so any package that grows a `./typert`/`./remote` face without declaring zod fails at pack time with the root cause in the message — the tripwire is structural, not documented.

Cost: 15 dist manifests carry one extra dependency line, and the keep-rule joins family edges and `dsh.runtimeDependencies` as the third exception to "pack-dist strips `dependencies`" — each exception exists because one class of bare import resolves against the install tree, and any fourth class must come with the same proof.

## Related

- [typert strict codecs emit both an eager `schema` and a lazy `create()`](../../implemented/bug-fix/2026-09-25-typert-codec-dual-shape.md) — the second 0.1.5 layer; its brand-checked `schema` key is what this v3 poisoning defeated.
- [preset-registry consumers dual-name-probe the module at runtime](../../implemented/bug-fix/2026-09-25-preset-registry-dual-name-probe.md) — the first 0.1.5 layer; all three share the root invariant that a pack-dist-published artifact resolves its imports against the host's install tree.
