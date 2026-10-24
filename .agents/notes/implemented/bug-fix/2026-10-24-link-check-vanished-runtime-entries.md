# Agent Note: The deploy link check skips entries that vanish mid-scan

Status: implemented

## Problem

`pnpm deploy:3080` aborted after the profile install with `dependency link check failed: ENOENT ".../local-agent/member-bridge.sock"`, and every agent deploying that day hit it. The check (`scripts/dependency-links.mts`) lists each directory of `$DSH_HOME` and then lstats each name. The live instance keeps re-creating runtime files there: the member bridge unlinks and re-binds `local-agent/member-bridge.sock`, and the member inbox / control stores write a temp file and rename it. When an entry disappears between the listing and the lstat, the lstat throws ENOENT and the check reported it as a dangling dependency link. Nothing was broken: sockets are already ignored by design, and the entry was simply gone. The more rooms and local agents were in use, the more often deploys lost the race.

## Decision

An entry that was found by a directory listing and is gone by the time it is lstat'ed is skipped. Everything else is unchanged: a symlink whose target is missing is still reported (with its target), a missing scan root is still reported, and unreadable directories are still reported. The directory listing is injectable (`LinkScanIo`) so the spec can list an entry that no longer exists.

## Alternatives considered

**Exclude `member-bridge.sock` (or `local-agent/`) by name.** Rejected: the temp-and-rename files next to it lose the same race, and any future runtime file would bring the failure back.

## Consequences

Deploys no longer race the live instance's runtime files. A genuinely broken link under `$DSH_HOME` or the harness still stops the deploy before the restart.

## Testing

`scripts/dependency-links.spec.ts` gains a case where the listing names a vanished `member-bridge.sock` next to a real dangling link: only the dangling link is reported. With the skip removed the case fails; with it, all 7 cases pass. `checkDeploymentLinks` over the real `~/.dsh-official` and harness checkout is clean.
