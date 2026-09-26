# Agent Note: deploy-3080 retreats a family bundle's members out of the profile's direct lists

Status: implemented

## Problem

The family meta packages (`bundle-local-agent`, `bundle-conversation-toolbox`)
mount their members' canonical rows through the bundle's own patch, while the
members arrive as transitive npm dependencies whose self-mount patches stay
inert — `reconcilePlugins` folds only the profile's DIRECT `dsh.bundle`
dependencies into the bundles layer. But the deploy flow had no "remove"
capability at all: members that were originally deployed standalone kept their
direct dependency and bundles-roster entries forever. A profile that installs
the bundle alongside such members double-registers every family row on the
overlap surface (the official bundle detail page's row switches mediate it,
but the rows mount twice), and the plugin inventory page — which enumerates
direct dependencies carrying card metadata — keeps issuing each member a
top-level card the family card is supposed to replace.

## Decision

`scripts/deploy-3080.mts` now performs **member retreat** when a named package
declares `dsh.bundle.kind: 'family'`, inside step 3 after the manifest refresh:

- Every member leaves the profile manifest's `dependencies` and
  `dsh.profile.bundles`. A member already absent from both is skipped with a
  log line, so retreat is idempotent and a repeated deploy is a no-op there.
- The member's `file:` pin in the profile `pnpm-workspace.yaml` overrides
  STAYS — the bundle's pack-dist-rewritten `^<version>` edges resolve
  transitively through it (overrides apply to transitive specs too). A missing
  pin is restored from the co-deployed member's fresh tarball, else the newest
  matching stashed tarball; with neither, the deploy refuses before the
  profile install, because an unpinned member edge would fall through to the
  registry (404 for unpublished members, a silently stale release for
  published ones).
- A member co-named in the same call (`--package packages/bundle-x --package
  packages/<member>`, any order) packs first — step 2 refreshes its tarball
  and pin — and the bundle registers/retreats after; the member is excluded
  from official `plugin add` so its own row is never (re)registered on top of
  the bundle patch's copy. This is the documented way to ship a member update.
- Post-install verification extends symmetrically: the bundle stays in
  `dependencies`, members stay out of the bundles roster AND the direct
  dependency list, and each member must still `require.resolve` from the
  bundle's installed tree — starting at the bundle's REAL directory, because
  pnpm keeps a package's dependencies beside its store entry, not under the
  symlinked top-level path. A co-named member additionally re-checks the
  resolved artifact's name/version.

The bundle's own first install is unchanged: official `plugin add <tgz>
--profile web` still registers it.

## Alternatives considered

**Leaving members as direct dependencies alongside the bundle.** Rejected:
that is the double-mount the family patch header warns about, and it keeps the
redundant top-level inventory cards — the two things the family form exists to
remove.

**Deleting the member's overrides pin during retreat.** Rejected: the bundle's
member edges are `^<version>` ranges that only resolve because the pin maps
the name to a `file:` tarball; unpinned, pnpm walks to the registry and either
404s or silently installs a stale published release. The pin is load-bearing
for transitive resolution, so retreat keeps (and if necessary restores) it.

**Silently keeping a missing pin on the registry fallback.** Rejected: for
members already published on npm the install would succeed with yesterday's
release — a silent downgrade. The refusal names the fix (co-name the member),
which is also the documented member-update workflow.

**Resolving members from the symlinked `node_modules/<bundle>` path.**
Rejected: under pnpm that path's `node_modules` chain never reaches the
bundle's store neighborhood, so the check would false-fail on a healthy
profile; verification realpaths the bundle directory first.

## Consequences

- Deploying a family bundle migrates the profile to the intended end state in
  one run: members out of the direct lists, one family card in the inventory,
  rows mounted once by the bundle patch.
- `scripts/deploy-3080.spec.ts` gains seven family cases pinning the exact
  pre/post shape of `dependencies`, the bundles roster and the overrides
  block, idempotency, co-deploy ordering, bundle first-install through
  official add, the skip log for an absent member, pin restoration from the
  stash, and the refuse-before-install failure path.
- The stub command boundary in the spec now models two real behaviors the
  family cases depend on: pack-dist's `workspace:*` → `^<version>` edge
  rewrite and transitive resolution through the overrides pins.
- Member updates must be co-named with the bundle (documented in docs/ops.md);
  deploying a member alone still works and keeps it standalone — retreat only
  fires when its bundle is named.
