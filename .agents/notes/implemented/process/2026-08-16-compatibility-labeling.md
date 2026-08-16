# Agent Note: Compatibility labeling — npm line verdicts per package

Status: implemented

English | [中文](2026-08-16-compatibility-labeling.zh.md)

## Problem

Every plugin's runtime depends only on the official public stable surface (slots, core services, core events, cordis 4.x, schemastery), but that fact lived in a dependency-audit conversation, not in the repo. Users installing from npm could not tell which host release each package needs, and the genuinely degraded case (ankh-guard's preflight gate rides the fork-only `dsh preflight`) was invisible.

## Decision

Every package carries two synchronized labels: a `Compatibility` section in both READMEs (one verdict per host line — npm release `@deepseek-ai/dsh@0.1.0-rc.6` vs deepseek-harness master — as ✅ full / ⚠️ degraded / ❌ requires newer) and a machine-readable `dsh.compat` field in package.json (`minHost`, plus `notes` for degraded items). AGENTS.md makes both mandatory and requires re-checking degraded items after each official release, retiring the degraded path once the release ships the missing capability. The 2026-08-16 audit seeded the verdicts: ankh-guard is ⚠️ on the npm line (preflight gate unavailable, everything else intact); the two open items were verified against the published tarballs — `@deepseek-ai/dsh-session@0.1.0-rc.6` exports `./surface` (`isAppendSurfaceEvent` / `isReplacementSurfaceEvent`, message-tools) and `@deepseek-ai/dsh-client-ui-conversation@0.1.0-rc.6` exposes `conversation.input` with `SessionInput.submit('steer')` (ui-shortcuts) — so both are ✅. Remaining npm lags (ConversationEventRegistry, dsh-api-remotes, shell.overlay) are test/type-only or unused and do not lower any runtime verdict.

## Alternatives considered

- **peerDependencies ranges only** — rejected: a range cannot express "full vs degraded", and the degraded item (a CLI command, not a package API) has no dependency to constrain.
- **Labels only in the audit note** — rejected: notes are maintainer-facing; the compatibility answer belongs where a user decides to install (README) and where tooling can read it (package.json).

## Consequences

- Verdicts age: each official release can move a ⚠️ to ✅, and the AGENTS.md rule assigns that re-check to the release-following workflow rather than to memory.
- `minHost` is a floor, not a tested matrix: it records the oldest host line the runtime surface is known to exist on, verified by tarball inspection, not by running every old host.
