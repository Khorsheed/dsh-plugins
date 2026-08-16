# Agent Note: gen-typert overlay — generation root after the harness removal

Status: implemented

English | [中文](2026-08-16-gen-typert-overlay.zh.md)

## Problem

The harness commit "remove migrated plugin packages now hosted in dsh-plugins" (2026-08-16) deleted the in-tree copies of message-tools, file-preview, and local-agent. `scripts/gen-typert.mts` generated their Typert face artifacts by running the harness's `WorkspaceTypertGenerator` over the harness checkout, so every build of the three packages failed with `no host artifact generated`. The analyzer is monorepo-coupled: Remote marker detection and merged-interface face attribution require contributing packages (typert-protocol, session, …) as registered workspace *source* packages under the generator root — npm-installed copies never satisfy that.

## Decision

Generation now runs against a scratch **overlay** at `$DSH_HOME/scratch/typert-overlay`: an APFS clonefile copy of the harness checkout (packages, vendor, native, apps, node_modules, face tsconfigs) with this repo's three packages copied in as real directories and referenced from the overlay's `tsconfig.host.json`. Real directories are required because the analyzer realpaths package roots and filters out anything that resolves outside `<root>/packages`. Each process builds its own overlay (concurrent `pnpm -r build` invocations share no mutable scratch), cloned fresh from the current harness checkout (`DSH_HARNESS`) and removed when generation finishes; the harness checkout itself is never modified. Copied manifests already carry the `@khorsheed` self-name, so the generator stamps the right owner natively and the old sourceName→distName rewrite step is gone.

## Alternatives considered

- **npm-resolved harness types, no overlay** — rejected: `@Remote` marker detection keys on the declaration's registered package being `@deepseek-ai/dsh-typert-protocol` (or a `declare module` block), which npm d.ts resolution never yields.
- **Symlink the plugin packages into a harness copy** — rejected: the analyzer realpaths package roots, so symlinks resolve outside the root and are filtered out.
- **Copy the plugin sources back into the real harness checkout per run** — rejected: the harness checkout is tracked, not modified; it is also the watchdog-guarded deployment checkout, where stray uncommitted files are at risk.

## Consequences

- Verified by golden diff: regenerated `lib/typert.host.js` / `typert.remote-client.js` for message-tools are byte-identical to the harness-era artifacts except `sourceLocation.file` paths, which now name this repo's layout.
- Each package build still regenerates the full set in one batch (shared type-declaration metadata depends on the analyzed set); the overlay rebuild adds one clonefile copy of the harness per invocation.
- The overlay depends on the harness layout (`tsconfig.host.json`, `packages/typert/generator`); a harness-side restructure breaks generation loudly at the missing-entry check.
