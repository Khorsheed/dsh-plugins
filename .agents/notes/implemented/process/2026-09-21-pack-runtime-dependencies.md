# Agent Note: pack-dist keeps `dsh.runtimeDependencies` (unbundled runtime deps survive packing)

Status: implemented

## Problem

`@khorsheed/dsh-capture` answered every render request on the production instance
with `Cannot find package '@puppeteer/browsers'` (2026-09-21, first live click of
「渲染抓取」). The package deliberately does NOT bundle puppeteer-core /
@puppeteer/browsers — they are consumed through runtime dynamic imports — but
`pack-dist`'s `rescopePackageJson` dropped the entire `dependencies` section, on
the standing assumption that runtime deps are bundled into `lib/` or provided by
the host composition. The unit tests passed, the tarball shipped, and the deployed
plugin could not run its one verb.

## Decision

A package opts specific runtime dependencies into the dist manifest with a new
manifest field, `dsh.runtimeDependencies` (an array of names, each of which MUST
exist in `dependencies` — naming anything else throws at pack time). Listed entries
survive `rescopePackageJson` verbatim (name and range unchanged); everything else in
`dependencies` is still dropped per the bundled-into-lib assumption, and family edges
keep their existing rewrite. `@khorsheed/dsh-capture` declares
`['@puppeteer/browsers', 'puppeteer-core']`.

The rule "runtime deps are bundled" stays the default: the field exists for deps a
package consciously keeps unbundled (large automation runtimes, native modules),
not as a second way to declare ordinary imports.

## Alternatives considered

**Bundle puppeteer into `lib/` (tsdown alwaysBundle).** Rejected: puppeteer-core +
@puppeteer/browsers are multi-MB automation machinery with their own dependency
tree; bundling hides a large third-party surface inside an artifact the repo treats
as transparent, and the next unbundleable dep (native modules) would need the
manifest path anyway.

**Keep all `dependencies` in every dist manifest.** Rejected: it double-declares
what is already bundled, invites version skew between the bundle and the install,
and hides the bundled-by-default contract that keeps tarballs honest.

## Consequences

- Dist manifests can now carry real runtime dependencies again — the installer
  (profile `pnpm install`) resolves them, so dynamic imports at runtime work.
- `scripts/pack-dist.spec.ts` pins both directions (kept verbatim; unlisted dropped;
  unknown name throws) — red-first verified.
- The capture package's first production render after the fix must confirm the
  profile actually resolves puppeteer (the incident's reproduction).
