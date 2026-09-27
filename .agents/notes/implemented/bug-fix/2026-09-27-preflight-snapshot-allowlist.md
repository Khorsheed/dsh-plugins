# Agent Note: preflight snapshot copies boot inputs (allowlist), not the live home — and anchors store links per package

Status: implemented

## Problem

A 2026-09-27 `reconfigure` (mobile tunnel `--trusted-host` switch) spent 848 s
of its 1062 s total (~80%) preparing the isolated preflight home. The snapshot
copied the whole live dsh home minus top-level `scratch/`, and two mechanisms
compounded: (1) plugin data directories the composition never reads at boot —
`sessions/` (331 MB), `state/` (584 MB, including a whole Chrome for Testing
tree), `local-agent/` sub-homes — were copied wholesale; (2) absolute symlinks
in those trees (and in `profiles/` itself: pnpm store links and launcher-healed
fallback links) resolve outside the home, and `externalMaterializationAnchor`
(transition.ts) anchored any `node_modules`-carrying target at the FIRST
`node_modules` segment — the host checkout's entire root `node_modules` (2.1 GB)
was dragged in by 32 profile links. Measured on the live home: ~4 GB copied,
234 distinct external anchors. The copy was also silent, so the prepare looked
like a hang, and at 848 s it exceeded the 10-minute credential freshness
window — the failure mode the code comments already warned about.

This was the second incident of the same class: the denylist
(`SNAPSHOT_SKIPPED_TOP_LEVEL = ['scratch']`) grew only per incident, and every
new plugin writing a top-level home directory silently joined the copy.

## Decision

`createPreflightSnapshot` (packages/ankh-guard/src/transition.ts) now copies an
ALLOWLIST of boot inputs — `SNAPSHOT_INCLUDED_TOP_LEVEL = ['profiles',
'settings.yaml', 'cordis.patch.yml', '.credentials.yaml', '.anonymous-user-id']`
— instead of everything-but-scratch. Plugin data directories are excluded by
default, so plugin growth no longer touches the snapshot; the list moves only
when the host's boot starts reading a new home input, and a miss fails the
dry-run loudly with the missing path. Verified empirically on host 0.1.7-rc.2:
a snapshot carrying only `profiles/` boots the real web profile to
`preflight PASS` (the runtime-resolution line mounts package resolution
in-memory; the credential/settings files are carried for boot fidelity across
lines).

`externalMaterializationAnchor` now anchors at the LAST `node_modules` segment
— the resolved package's own parent (`…/.pnpm/<name>@<version>/node_modules`),
which already holds the package's dependency siblings, so Node's ancestor
lookup survives at the tightest scope. Unlinked parts of a store root are never
copied.

Both snapshot factories accept `{ includeTopLevel, onProgress }`; a transition
plan's operation roots are unioned into the include list so rehearsals still
observe the exact paths. The factories return `copiedFiles`/`copiedBytes`, and
`reconfigure` prints throttled progress during the copy plus a one-line summary
(files / MB / seconds) when ready.

Measured on the live home after the fix: 1141 MB / 81k files / 43 s (from
~4 GB / 848 s), and the resulting snapshot home passes the real composition
preflight (`preflight PASS: profile "web" boots clean`).

## Alternatives considered

**Extend the denylist (add state/sessions/local-agent/… next to scratch).**
Rejected: the list would move every time any plugin adds a home directory —
maintenance by incident, silent failure mode (the copy just gets slower). The
user surfaced exactly this concern; the allowlist flip is the answer.

**Drop external-link materialization entirely on runtime-resolution host
lines.** Rejected: the snapshot is host-line-agnostic, the containment
guarantee (no writable link escapes the snapshot) is structural, and heal-based
lines still boot through materialized links. Per-package anchoring already
bounds the cost; host-line special-casing would add a drift surface for no
remaining win.

**Reuse a validated dependency-materialization cache across reconfigures.**
Deferred: with the copy at 43 s the cache's invalidation complexity buys
little. Revisit if profile growth pushes the copy past the credential window
again.

## Consequences

- `reconfigure` prepares are back to tens of seconds and narrate their own
  progress; an 848 s prepare can no longer silently eat the credential window.
- The gate's semantics shift from "reproduces the live home's data" to "the
  composition boots with this deployment's boot inputs" — a plugin whose apply
  needs previously written DATA would now fail preflight; that is a true
  positive (production first-boot would fail the same way).
- `tests/transition.spec.ts` pins: the default allowlist (plugin data never
  silently joins), per-package store anchoring (unlinked store content stays
  out), progress reporting, and the runtime-entry/link fixtures now run under
  explicit include lists.
- Both READMEs' snapshot paragraphs were updated in the same change.

## Testing

`pnpm --filter @khorsheed/dsh-ankh-guard test` (build + all lanes), plus the
live-home end-to-end above (snapshot → preflight PASS → cleanup).
