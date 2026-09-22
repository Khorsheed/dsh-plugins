# Agent Note: the plugin-decomposition review batch — three blockers, one mainline collision

Status: implemented

## Problem

A four-reviewer Codex review of this repo's plugin decomposition (the local-agent
family, file-preview, and the datasets/eval line) produced a must-fix (P0) and a
scheduled (P1) list. The batch implemented them and then went back to the same
reviewers for a fix verification, which found three blockers:

1. Nothing froze the contract that made the local-agent split safe. The docs say
   a provider patch must never re-insert the core row (two providers installed
   would mount the core row twice), but `packages/local-agent/tests/patch.spec.ts`
   only read the core's own patch — a provider could re-insert the core row and
   every check stayed green.
2. `check-plugin-independence` validated the `dsh.references` a package declared
   but not the reverse. A core could drop its declaration while its client bundle
   still carried the companion row's module name, and only the pack stage noticed.
3. WP8's minimum delivery set had not landed: the root READMEs still claimed 26
   packages (24 self-mounting plus 2) against a 32-package tree, the protocol
   documents described the `dataset-authoring` skill as if it shipped with the
   datasets package, `release-status.ts` read a sibling checkout that usually is
   not there, and "why does this package have no patch?" lived only in a
   hand-maintained list of directories.

While the batch was in flight, mainline independently landed the same
reverse-edge fix for the fourth finding — with `dsh.references` instead of this
branch's `dsh.composition.gateRefs` — plus the script-spec timeout fix this
branch had also made. Two mechanisms for one fact cannot both live in the tree.

## Decision

- **Adopt mainline's mechanism.** The branch dropped `dsh.composition.gateRefs`
  and its two duplicate timeout commits and rebased onto main. The four conflicts
  were resolved by union, not by picking a side: mainline's "cross-package edges
  go one way; a data mention lives in `dsh.references`" rule and this branch's
  "an npm dependency makes a module resolve, it does not mount a row" contract
  both survive in `AGENTS.md` and in `pack-dist`'s docstrings.
- **Freeze the patch contract tree-wide, not per family.** `check-plugin-independence`
  now rejects any bundle patch that mounts a row for a package that self-mounts
  (`patch row ownership`). The local-agent spec separately discovers the family
  from the tree and asserts each provider mounts its own row and no other
  self-mounting row, with an injected core row proving the assertion has teeth.
- **Close the data-reference loop with no central list.** Every declared
  `dsh.references` entry must name a real repo package and must not duplicate a
  dependency edge; every sibling name a package's own sources carry (comments
  stripped) must be declared as an edge or a reference. Deleting a declaration
  now fails `pnpm check:plugins`, not only a pack.
- **Composition metadata replaces the list.** The seven packages that
  deliberately do not self-mount declare `dsh.composition.component`
  (`preset-composed-row` ×5, `provider-mounted-row`, `sub-profile-patch`), and
  the checker reads the manifest. `NO_OWN_PATCH` stays as a cross-check so the
  metadata and the historical list cannot drift apart while it is retired.
- **The package map is generated.** `pnpm map:packages` writes `docs/packages.md`
  from the manifests (counts, form, component, browser half, `minHost`, profile
  membership) and `pnpm check:packages` is a gate step, so hand-maintained counts
  cannot rot again. `release-status.ts` reads this repo's own `profiles/web-basic`.
- **Ownership of the HTML skills.** The `3d-artifact` skill moved from
  file-preview to inline-html-render, its actual subject; both skills are
  registered by that package with `provider: 'inline-html-render'`.
- **The browser half is gated on evidence.** `ui-file-preview` installs its
  surfaces only after the host half answers a zero-session `capabilities` probe;
  an absent host means absent surfaces — no error card, no empty tab, no new
  locale string.

## Alternatives considered

- **Keep both metadata mechanisms** (`gateRefs` and `references`) — rejected: two
  names for one fact is exactly the drift the review was about, and only one of
  them can be the documented convention.
- **Keep a central list of the packages that must declare references** — rejected:
  such a list has to be maintained in lockstep with the tree, which is the failure
  mode being fixed. The package's own sources are the evidence, so the rule needs
  no list; the remaining list is demoted to a cross-check.
- **A local-agent-only regression test** (reviewer A's minimum) — accepted and
  implemented, but not as the only guard: A's own stronger suggestion, a generic
  rule, is what covers the next provider and the other four core/companion pairs.
- **Regenerate `docs/release-status.md` with `--offline`** — rejected: it writes
  the offline placeholder into every published column. `npm view` failed here only
  because `~/.npm` is unwritable in this sandbox; pointing `NPM_CONFIG_CACHE` at a
  workspace directory produced the real versions.

## Consequences

- The checker is stricter in two directions and needs no new list: a package that
  neither self-mounts nor declares a component fails, and a patch that mounts a
  sibling's row fails.
- `NO_OWN_PATCH` is now metadata-mirrored rather than authoritative, and is retired
  by removing entries as the historical Agent Notes stop being cited.
- A stale `docs/packages.md` fails the gate, which means any manifest change that
  alters form, component, client half or profile membership must be regenerated in
  the same commit.
- WP9 (renaming three client packages to `@khorsheed/dsh-client-ui-*`) stayed out of
  this batch deliberately: it needs a lockfile window coordinated with mainline, and
  splitting it out keeps this branch mergeable.

## Testing

- `pnpm gate` checkpoint A (pre-rebase, 12 steps) and checkpoint B (post-rebase,
  on mainline's code) — both green; see `docs/acceptance/plugin-decomposition-review-fix-batch-2026-09-12.md`
  for the per-item table and the environment caveats (no interactive Docker, no
  `/bin/ps` inside the agent sandbox).
- `pnpm test:scripts` covers the new rules: the injected-sibling-row case, the
  dropped-declaration case, the metadata/list cross-check, the package-map render
  and its `--check`, and the numeric prerelease comparison (`rc.10` > `rc.6`).
- Reviewer verdicts (A and C, freeze range `cf8f663..a0fa7c6`) live in
  [reviewer A](../../../../docs/acceptance/plugin-decomposition-review-A-round2-2026-09-12.md) and [reviewer C](../../../../docs/acceptance/plugin-decomposition-review-C-round2-2026-09-12.md); the blockers they raised
  are the commits `test(local-agent): freeze the provider patch contract`,
  `fix(scripts): make the family data-reference loop self-closing` and the WP8
  commits.
