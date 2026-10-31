# Agent Note: host 0.2.1-rc.4 adaptation — exact source baseline with current main

Status: implemented

English | [中文](2026-10-27-host-021-rc4-adaptation.zh.md)

## Problem

The npm rc4 release initially had no public source tag, so the first adaptation used rc4 binaries with an rc3 type/test seed. The host later published `dsh-v0.2.1-rc.4` at `504a01a9578abc2c6f1fb896b1dc322c9fe24f66`, while local `main` had advanced by 80 non-merge commits since the adaptation branch was created. Final acceptance had to use the exact rc4 source, include the new plugin work, and avoid silently turning into rc5 acceptance.

## Decision

Pin the development graph and both fixed workflow harnesses to rc4. The read-only source checkout is the exact rc4 tag; `pnpm-workspace.yaml` carries the rc4 pins, and the regenerated lockfile also retains current main's agent-nav workspace edges and file-preview's PTC test dependencies. `.github/workflows/ci.yml` and `publish.yml` name the same tag. The dynamic forward lane still follows npm `next`, which is now rc5 and is not evidence for this wave.

Merge `main` at `39f598455` into the adaptation branch. File-preview keeps both main's independent 16 MiB image cap and the new PTC dispatch-diff consumer. S17 retains game's polling consumer but now describes its actual purpose: refresh a tab after a room binding changes without an official event; destination-line navigation owns automatic navigation.

The four-category verdict remains: **adopt** the MCP empty-resource and account-stderr fixes in local-agent-dsh-headless; **unblocked** file-preview now consumes the already-published PTC dispatch metadata; **switch** no new rc4 API; **retire** no whole package. Reader keeps its own HTTP provider because rc4 still cannot select a provider per request. File-preview mentions and mobile's legacy View CSS stay because their minimum supported hosts still need them. Minimum-host floors and `verifiedHost` labels do not move before production acceptance.

## Alternatives considered

**Accept against npm rc4 with an rc3 source seed.** Rejected once the exact tag exists: mixed source and binary baselines cannot prove the final type/test result.

**Follow `next`, master, or rc5.** Rejected as scope drift. The forward lane remains useful for early warning, but this wave names one immutable rc4 commit everywhere.

**Raise every minimum host and delete legacy shims.** Rejected: rc4 adds no requirement to abandon supported older hosts, and none of those shims blocks the new behavior.

## Consequences

The branch contains current main plus the rc4 baseline and has a complete green build, test, and pack result. No package retires and no production instance changes. Package compatibility labels still await the separately coordinated 3080 host migration and live acceptance. Game and library require clean rebuilds after main deleted source modules; incremental type emits otherwise retain stale files and fail artifact verification.

## Testing

A cross-host clean build/test used cleared TypeScript caches and forced typert generation against the exact rc4 checkout. After clean rebuilds of game and library, the final `pnpm gate --all` passed all 17 steps, including all package tests, 401 script tests, document gates, and 42 verified package tarballs.

Targeted runtime evidence is separate from the monorepo gate. Two real community headless `--serve` processes used a tools-only stdio MCP server: `resources` and `resourceTemplates` both returned empty arrays, every one of 69 stdout frames per run parsed as JSON-RPC, and both processes exited zero. Official rc4 tests passed for ACP stdout/account logging (2), MCP protocol behavior (5), and conversation View behavior (38). Real reader runs under both `http` and `deepseek-fetch-api` selections each parsed 20 live feed entries and read a 27,706-character HTML article; the selected DeepSeek Markdown provider received zero calls. File-preview passed 22 files and 221 tests, including real PTC create/edit dispatch metadata and the independent image-cap path.

## Related

- [File-preview PTC dispatch diffs](../bug-fix/2026-10-27-file-preview-ptc-dispatch-diffs.md)
- [Host 0.2.0-rc.2 adaptation](2026-09-29-host-020-rc2-adaptation.md)
- `docs/upstream-seam-registry.md`, especially S1, S17, and S22.
