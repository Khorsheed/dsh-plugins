# Agent Note: Community packages publish 0.MINOR.PATCH only — no prerelease versions

Status: implemented

## Problem

Two lines carried `-rc.N` versions: the local-agent family (`0.2.0-rc.3` on npm) and the evaluation family (`0.2.0-rc.1`, unpublished). The suffix told users nothing — every package is 0.x, which already says "not stable yet", and host compatibility lives in `engines.dsh` / `dsh.compat.minHost` — but it kept causing work: npm matches a prerelease range only within one version triple (`^0.2.0-rc.4` misses `0.2.1-rc.x`, the peer-range trap docs/publishing.md records), npm 12 refuses to stage a prerelease without an explicit `--tag` (the 2026-10-24 wave stopped on it), and the family's one-version-line rule multiplied every rc step across seven packages (the same wave was blocked once because dsh-headless had not moved to rc.4 with the rest).

## Decision

From 2026-10-24, community packages publish `0.MINOR.PATCH` only, written down in docs/publishing.md 「版本号规则」:

- MINOR for breaking changes, new capability, and a suite's membership or card-name change; PATCH for fixes, docs-only changes and following a dependency forward;
- the local-agent family keeps one version line;
- a new package debuts at `0.1.0`; a package with an existing version line debuts at that line's release;
- do not burn version numbers: a staged version is only replaced when it cannot be reused.

`release:wave` enforces it: `check` reports any prerelease target as an error, and `plan` suggests a prerelease line's release (`0.2.0-rc.3` → `0.2.0`) instead of the next rc. The `--tag latest` workaround added to `stage` earlier the same day is removed — no prerelease reaches it.

This wave: the local-agent family moves to `0.2.0` (above npm's `0.2.0-rc.3`; `0.2.0` was never published, so no number is reused), and datasets / eval / lab debut at `0.2.0`.

## Alternatives considered

**Keep rc lines and teach the tooling (`--tag`, range rewrites).** Rejected: it fixes the symptoms one at a time and keeps a suffix that carries no information for users.

**Restart the rc lines at `1.0.0`.** Rejected: nothing here is stable enough to promise 1.x semantics; 0.x stays honest.

## Consequences

- No more `--tag` handling, no prerelease range surprises in pack-dist's `^` rewrites.
- A package that needs a soft launch ships at a normal 0.x version and is kept out of the suites until ready (sidechat's pattern), rather than going out as an rc.

## Testing

`scripts/release-wave.spec.ts`: a prerelease target is a check error; plan and `bumpVersion` graduate an rc line to its release. `pnpm check:release-groups --release` green with the family at 0.2.0.
