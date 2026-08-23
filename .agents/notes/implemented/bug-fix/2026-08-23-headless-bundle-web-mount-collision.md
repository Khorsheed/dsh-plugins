# Agent Note: headless bundle auto-mounted into the web profile (2026-08-23 P0)

Status: implemented

[English](2026-08-23-headless-bundle-web-mount-collision.md) | 中文

## Problem

Prod 3080 failed to boot: `@khorsheed/dsh-local-agent-dsh-headless` was a
direct dependency of the web profile, and `dsh plugin`'s `reconcilePlugins`
auto-mounts every `dsh.bundle`-declaring direct dependency into the
composition's layer stack — so the bundle's sub-profile-only patch (whose
`code-runtime` insert row is legal only over dsh-base) was composed over
web-app, whose own `code-runtime` row made it a duplicate entry id. The
loader failed the whole instance, loudly but cryptically. The row itself is
unchanged since the bundle's creation commit (`1964e7f`); the defect is the
declaration bind: "must be installed" and "must be mounted" are the same
`dsh.bundle` declaration, and the layer-list side NEEDS it (app-boot fails
loud on a bundle-less layer entry), so nothing plugin-side could keep the
package installable-yet-unmounted (upstream seam registry S9).

## Decision

Deployment discipline plus a loud sentinel; deliberately NO idempotent
insert.

- **Ops rule** (docs/ops.md, both READMEs): family-internal bundles are never
  a direct dependency of any profile — a transitive install through the
  parent package (`@khorsheed/dsh-local-agent-dsh`) suffices for the
  sub-profile symlink, and reconcile only reads DIRECT dependencies, so a
  transitive bundle never mounts into an interactive composition.
- **Invariant** (`src/invariant.ts`): the bundle's companion now fails clear
  (`mounted into a web composition — this bundle is sub-profile-only…`) when
  the tree carries the web layer's `webStartup` service. In-box bundles mount
  before dependency-managed ones, so the marker is already provided when the
  companion applies. This catches the non-colliding case — an upstream row
  rename would otherwise leak the persona/`hmr`/`tools` overrides into real
  user sessions silently.
- **Patch pin** (`tests/patch.spec.ts`): the `code-runtime` insert row id is
  pinned, so renaming or dropping it is a conscious act that revisits S9.
- The `code-runtime` row stays an unconditional insert: applyEntryPatches'
  replace-by-id semantics would make an idempotent guard silently DROP the
  row in the bundle's own composition (dsh-base does not carry it). The
  loader's duplicate-id fail-loud is correct behavior; the bug was being
  mounted, not failing to be tolerated.
- Upstream ask (S9): split the declaration (`dsh.bundle.autoMount: false` or
  `profileOnly`) so reconcilePlugins skips profile-internal bundles.

## Alternatives considered

- **Idempotent/replace-if-present insert** — rejected: it would fix the web
  collision by silently dropping the row in the bundle's OWN composition,
  where dsh-base provides no code-runtime; fail-loud on a duplicate id is the
  loader's correct semantics.
- **Removing the `dsh.bundle` declaration from the headless package** —
  rejected: app-boot fails loud on a bundle-less layer entry, and the
  sub-profile lists the package in `dsh.profile.bundles`; the declaration is
  required there. The split declaration is the upstream answer (S9).
- **Loader-side composition-time guard from the plugin** — impossible: the
  duplicate-id failure happens at patch composition, before any plugin code
  runs; the runtime invariant cannot intercept the incident's exact failure,
  which is why the deployment rule is the primary fix.

## Consequences

- The incident's direct path is closed by discipline (prod profile was
  corrected by hand during the incident); the invariant + pin make the next
  mistake fail clear and the test suite pin the hazard's mechanics.
- The invariant's `fail` runs at companion apply; a web composition that
  mounts the bundle WITHOUT the id collision now fails boot with a readable
  message instead of leaking overrides.
- Nothing changed for the bundle's own sub-profile: patch, boot, and the
  one-shot/serve modes are untouched (36 package tests green).

## Testing

- `tests/invariant.spec.ts`: accepts the headless composition; rejects a
  composition carrying the `webStartup` marker with the clear message.
- `tests/patch.spec.ts`: pins the `code-runtime` insert row id alongside the
  existing entry-list dialect guard.
