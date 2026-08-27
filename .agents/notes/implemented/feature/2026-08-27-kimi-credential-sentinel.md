# Agent Note: kimi credential sentinel (empty-shell backup + restore + attribution logging)

Status: implemented

English | [中文](2026-08-27-kimi-credential-sentinel.zh.md)

## Problem

The kimi scoped home's `credentials/kimi-code.json` has twice been found wiped into an empty shell (both OAuth tokens zero-length strings) — 2026-08-22 and again 2026-08-27 at 18:52, two seconds before a delegation failed with "Authentication required" on prod 3080. Our plugin code never writes that file (only `config.toml`, plus the logout delete), so the wipe is the kimi CLI's own failure path — most plausibly a non-atomic refresh write intersecting our process lifecycle (idle reclaim's EOF→grace→SIGTERM ladder, or a restart). Each incident needed a manual restore from a surviving copy.

## Decision

`packages/local-agent-kimi/src/credential-guard.ts` — a sentinel on the credential read path:

- **Backup on valid**: any observation of a credential with non-empty tokens rewrites `credentials/kimi-code.json.bak` (mode 600). Living inside `credentials/` means the family's logout (a directory delete) clears the backup too — a logout never leaves a restorable ghost.
- **Restore on empty shell only**: the exact signature is both tokens as empty strings. Unparseable content is left untouched for a human (unknown corruption shape), and a missing file stays missing.
- **Attribution logging**: every empty-shell detection warns with the file mtime, the previous observed state, and a one-line `ps` snapshot of kimi/dsh processes — the next wipe tells us which process was around. Valid→valid refreshes log at the same channel when the mtime changes (token refresh trace).
- Wired at three points: `kimiAuthenticated` (every status probe — which also FIXES the probe: the pre-sentinel check "directory non-empty" read an empty shell as authenticated), the exec provider's `onAuthFailure`, and the live driver's `reportAuthIfShaped` — a mid-run wipe is restored at the failure moment, so the caller's retry (or the next round) succeeds.

Deliberate narrowness: a revoked-elsewhere credential never takes the empty-shell shape, and restoring a rotated-out backup at worst yields one more loud 401 — never silent misbehavior.

## Alternatives considered

- **Auto-retry the failed round after restore** — rejected: the settle contract already fired; re-driving a round from the error path risks double side effects. Restoring at detection time makes the model's natural retry (both incidents show the parent retries) succeed.
- **Preventive write-lock around our reclaim ladder** — rejected as over-engineering: we cannot pause kimi's internal refresh, and the sentinel already bounds the damage to one loud failure.
- **Backup outside `credentials/`** — rejected: logout must clear it; inside is self-cleaning.

## Consequences

- An empty-shell wipe now self-heals at the next probe or auth-failure report, with a warn trail; worst case without a backup is the same loud failure as before, plus a "needs fresh login" log.
- `kimiAuthenticated` is now content-aware: an unrestorable empty shell reads unauthenticated (red dot) BEFORE any delegation fails.
- If wipes keep recurring, the process snapshots in the log give the next investigation concrete suspects; the true root fix (atomic credential write) belongs to kimi CLI upstream.

## Testing

`tests/credential-guard.spec.ts` (6): backup-on-valid, restore-on-shell (file content + warn lines), no-backup false, absent false, unparseable never restored, and the `kimiAuthenticated` wiring. Suite: kimi 121/121.

## Cross-references

- [kimi live mirror fold fixes](2026-08-27-kimi-live-mirror-fold-fixes.md) — the acceptance round that surfaced the second wipe.
