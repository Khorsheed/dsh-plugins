# Agent Note: gen-typert overlay — generation root after the harness removal

Status: implemented

English | [中文](2026-08-16-gen-typert-overlay.zh.md)

## Problem

The harness commit "remove migrated plugin packages now hosted in dsh-plugins" (2026-08-16) deleted the in-tree copies of message-tools, file-preview, and local-agent. `scripts/gen-typert.mts` generated their Typert face artifacts by running the harness's `WorkspaceTypertGenerator` over the harness checkout, so every build of the three packages failed with `no host artifact generated`. The analyzer is monorepo-coupled: Remote marker detection and merged-interface face attribution require contributing harness packages (typert-protocol, session, …) as registered workspace *source* packages under the generator root — npm-installed copies never satisfy that.

The first overlay implementation copied every registered community Typert plugin even when `GEN_TYPERT_ONLY` selected one output package. A scoped capability-catalog build therefore read message-tools first and then every other Typert sibling; removing any unrelated sibling source made the target build fail. That contradicted the repository rule that plugins build independently and made the filter ineffective against a broken or absent neighbor.

## Decision

Generation runs against a scratch **overlay** at `$DSH_HOME/scratch/typert-overlay`: an APFS clonefile copy of the harness checkout (packages, vendor, native, apps, node_modules, face tsconfigs) with the selected community plugin packages copied in as real directories and referenced from the overlay's `tsconfig.host.json`. Real directories are required because the analyzer realpaths package roots and filters out anything that resolves outside `<root>/packages`. Each process builds its own overlay (concurrent `pnpm -r build` invocations share no mutable scratch), cloned fresh from the current harness checkout (`DSH_HARNESS`) and removed when generation finishes; the harness checkout itself is never modified. Copied manifests already carry the `@khorsheed` self-name, so the generator stamps the right owner natively and the old sourceName→distName rewrite step is gone.

`GEN_TYPERT_ONLY` resolves the selected package set before the overlay is built. Source copies, `@khorsheed/*` path mappings, aggregate project references, generation inputs, and written artifacts all use that same set. An unfiltered repository build still analyzes every registered Typert plugin in one batch; a package-scoped build neither reads nor requires any unrelated plugin source.

## Alternatives considered

- **npm-resolved harness types, no overlay** — rejected: `@Remote` marker detection keys on the declaration's registered package being `@deepseek-ai/dsh-typert-protocol` (or a `declare module` block), which npm d.ts resolution never yields.
- **Symlink the plugin packages into a harness copy** — rejected: the analyzer realpaths package roots, so symlinks resolve outside the root and are filtered out.
- **Copy the plugin sources back into the real harness checkout per run** — rejected: the harness checkout is tracked, not modified; it is also the watchdog-guarded deployment checkout, where stray uncommitted files are at risk.
- **Always copy every community Typert plugin** — rejected: host framework sources remain shared analyzer inputs, but unrelated community plugins are independent products. Requiring all sibling sources makes one missing or broken plugin block every scoped build without contributing to the selected artifact.

## Consequences

- Verified by golden diff: regenerated `lib/typert.host.js` / `typert.remote-client.js` for message-tools are byte-identical to the harness-era artifacts except `sourceLocation.file` paths, which now name this repo's layout.
- The five capability-catalog Typert files generated from the full registered set and from a capability-catalog-only overlay are byte-identical. A regression test also builds the selected copy plan from a source tree where message-tools is absent.
- An unfiltered build regenerates the full registered set in one batch. A scoped build analyzes one selected set per invocation; each invocation still adds one clonefile copy of the harness.
- The overlay depends on the harness layout (`tsconfig.host.json`, `packages/typert/generator`); a harness-side restructure breaks generation loudly at the missing-entry check.
