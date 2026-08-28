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
- The runner mirrors TWO host API generations, feature-detected per run from the loaded app-boot module. The rc line (through 0.1.1-rc.*) heals the module fallback positionally before the profile load and adds the launcher's agent-presets shipped-root overlay; the 0.1.2 line heals through an async options object after the profile load, drops that overlay (the preset package self-ships its root — so the overlay follows the `apps/cli/config/agent-presets/` directory's existence, not the line), and publishes an `appReady` service through provideCmdline, which the runner stubs and commits once boot settles. `DEFAULT_PROFILE_PATCH_RELOAD` — a value export only the 0.1.2 app-boot carries — is the detection marker; parsing the host version would break on exactly the unreleased builds this runner exists to dry-run. Both lines stay supported because prod hosts run the rc line until 0.1.2 reaches npm.
- The runner rewrites the profile's empty root `cordis.yml` exactly like the launcher's prepareProfile — without it a fresh home (one the launcher never booted) fails the dry-run on a tree the first real boot composes fine.

## Alternatives considered

- **Import the launcher's composeProfile from the harness source** — rejected: upstream does not export it (the fork's export patch was wiped by an upstream reset); depending on an unexported file recreates the same fragility through a thinner seam.
- **Compare against `dsh dump-config` output verbatim (config text)** — rejected: the dump's own assembly differs from boot's (it skips the agent-presets and telemetry overlays); entry-id sets are the comparable contract.

## Consequences

- A source-edit-without-rebuild on the harness now fails the preflight the same way it would fail the boot — the intended behavior for a source-launched prod.
- The tripwire only covers entry-id sets on shared layers; config-level drift inside a layer (e.g. a new default) is still invisible — acceptable, since boot itself is the deep check.
- The tripwire fired as designed when 0.1.2-alpha.1 re-layered the composition: the heal's new options-object signature crashed the runner's old positional call (an unhandled rejection in the tripwire run), and the re-mirror above is that loop working. Both seeds verify green — the full ankh-guard suite plus end-to-end `preflight PASS` boots on fresh homes, once against the rc.2 checkout and once against the alpha tag with `DSH_HARNESS` pointing at it.
