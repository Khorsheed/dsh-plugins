# Agent Note: preflight runner engine fidelity + composition drift tripwire

Status: implemented

English | [中文](2026-08-18-preflight-engine-fidelity.zh.md)

## Problem

Two review findings on the standalone preflight runner (2026-08-17, `guard: standalone composition preflight runner`):

1. **Engine fidelity.** The runner imported the harness's BUILT `lib/` while the prod instance boots the harness SOURCE via tsx — a stale build makes the preflight greener than the real boot in both directions (source-only breakage passes, fixed-but-unbuilt code fails).
2. **Composition drift.** The runner mirrors the launcher's private `composeProfile` by hand (layer order, agent-presets roots, telemetry switch); upstream does not export it, so any upstream composition change silently desyncs the preflight from the boot it protects.

## Decision

- `loadHarnessPackage` loads the harness package **source first** (`src/index.ts`) whenever the runtime can import TypeScript (the runner is always launched through tsx) and the source exists; a broken source import is a composition verdict (exit 1), never a silent fallback to a stale build — it is exactly what the next source boot would hit. The built `lib/` remains the fallback for artifact-only harnesses.
- The hand assembly stays (no upstream export to import), and gets a tripwire instead: `tests/preflight-drift.spec.ts` compares the runner's composed entry ids against the launcher's own `dsh --dump-config` output for the same profile, so an upstream composition change fails the suite before a restart would. The test runs only where a harness checkout and the profile both exist, and spawns the dump with `cwd` set to the harness — otherwise the child resolves this repo's published packages instead of the harness's workspace ones.
- The composition is extracted as the exported `composePreflightPatches` so the tripwire compares data, not boot behavior.

## Alternatives considered

- **Import the launcher's composeProfile from the harness source** — rejected: upstream does not export it (the fork's export patch was wiped by an upstream reset); depending on an unexported file recreates the same fragility through a thinner seam.
- **Compare against `dsh dump-config` output verbatim (config text)** — rejected: the dump's own assembly differs from boot's (it skips the agent-presets and telemetry overlays); entry-id sets are the comparable contract.

## Consequences

- A source-edit-without-rebuild on the harness now fails the preflight the same way it would fail the boot — the intended behavior for a source-launched prod.
- The tripwire only covers entry-id sets on shared layers; config-level drift inside a layer (e.g. a new default) is still invisible — acceptable, since boot itself is the deep check.
