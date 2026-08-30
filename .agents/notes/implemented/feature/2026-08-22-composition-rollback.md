# Agent Note: composition-level rollback — the watchdog recovers out-of-repo boot failures

Status: implemented

English | [中文](2026-08-22-composition-rollback.zh.md)

> Lives on branch `ankh-guard/composition-rollback`; not yet merged to main — community release only after a 3080 tarball soak.

## Problem

The preflight gate proves the composition applies in a dry-run; it cannot see the boot-time world (real port, real state, timing). A freshly installed plugin that passes preflight but kills the real boot hit a deliberate gap: the watchdog's rollback only reverts the git checkout, and failures whose error subject lives outside the repository (profile overlay, installed plugin) skipped rollback by design — so four failures later the service sat on a crash page waiting for a human. Reproduced live with a demo plugin (apply throws only when `WD_PORT` is present): the published 8.9 died exactly this way.

## Decision

- Every healthy boot snapshots the profile's composition inputs (`cordis.patch.yml` + profile `package.json`) into `state/last-good-composition/` (next to the healthy-boot stamp).
- On a boot failure whose subject is outside the checkout, the watchdog restores that snapshot — unmounting the newest plugin change; the failing inputs are preserved under `composition-backup-*` — and retries with a clean failure count. One restore attempt per decline; if it doesn't fix the boot, the give-up path is unchanged.
- The recovery is reported through the restart-report machinery (`record-composition-recovery`): the report names what the rollback unmounted (bundle rows/deps delta, computed at restore time) and advises the user to repair or remove the offending plugin. The recovery record merges over a bare exit outcome (inheriting its initiator) but never clobbers a pending record that carries real diagnostics.
- A first-ever boot still files nothing; no snapshot means the old give-up behavior.

## Alternatives considered

- **Repo-rollback for everything** — the existing skip exists because reverting the checkout cannot unmount a profile plugin; composition restore is the operation that actually matches the failure class.
- **Reinstalling the profile after restore** — unnecessary: an unmounted row makes the leftover package inert; reinstalling adds pnpm to the watchdog's failure path for no boot-relevant gain.
- **Report-only first version** (log the intended rollback, don't touch files) — rejected for the branch: the whole point is the service coming back; the backup directory keeps the revert recoverable.

## Consequences

- The watchdog now WRITES to the profile directory (restore). The blast radius is bounded by the `composition-backup-*` preservation and the same/differ check, but this is a behavioral step-change worth a tarball soak on 3080 before any community release.
- The exit agent's bare outcome record can be upgraded by the recovery record; initiator routing is preserved.
- Known follow-up: if a healthy composition itself later breaks (dependency drift under an unchanged manifest), the snapshot restores to an equally broken state and give-up proceeds — acceptable, documented in the watchdog log.
