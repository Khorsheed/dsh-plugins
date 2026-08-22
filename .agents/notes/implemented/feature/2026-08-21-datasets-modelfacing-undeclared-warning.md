# Agent Note: warn on undeclared modelFacing in mixed-sensitivity datasets

Status: implemented

English | [中文](2026-08-21-datasets-modelfacing-undeclared-warning.zh.md)

## Problem

`modelFacing` defaults to `true` when a layer omits the key. In a MIXED-sensitivity dataset — one that declares any `modelFacing: false` layer — a layer that left the key undeclared is much more likely an authorial oversight than a deliberate public layer: descriptors get copied as templates, and a verify layer leaking to participants means overfitting. Flipping the default's meaning is wrong (a generic dataset's default behavior must not be polluted), and a hard error would reject existing valid-by-default datasets. The right strength is a warning.

## Decision

Shape validation now computes warnings alongside errors. `DatasetLayerDecl` records `modelFacingDeclared` (whether the key was present); `descriptorWarnings(descriptor)` in `src/dataset.ts` applies exactly one rule: when ANY layer is explicitly `modelFacing: false` and ANOTHER layer left the key undeclared, emit one `MODELFACING_UNDECLARED` warning per undeclared layer. All-public datasets (no `false` layer) and fully explicit datasets (either direction) stay silent. Warnings never block a read.

The warnings ride the dataset summary (`DatasetSummary.warnings`), so every face surfaces them without a new verb: the CLI prints them to stderr on `list`/`show`/`describe` (the describe verb now reads through `show` — identical descriptor JSON, and the summary comes with it), the slash command appends them to its output via `formatWarnings`, the model tools carry them in their JSON output (the agent sees the same signal), the Remote results carry them on the summary (additive object field — the exact-arity lesson does not apply; artifacts regenerated), and the web tab renders one quiet line per warning under the dataset row (localized from `{code, layer}` data, not the host's English message). A mount-time host-log warning was deliberately skipped: there is no load-time dataset scan, and adding one is noise machinery for a per-dataset fact the read faces already surface.

## Alternatives considered

- **Hard shape error on undeclared layers in mixed datasets** — rejected: it would break existing datasets that are valid under the documented default; suspicion is not a contract violation.
- **Changing the default to `false` when any hidden layer exists** — rejected by the premise: the default's meaning is generic-dataset behavior and must not flip with content.
- **Mount-time scan + host log warning** — rejected: no such scan exists, the plugin does not know bound repositories at load time, and per-dataset warnings belong with the reads, not the boot log.
- **Warnings only on the CLI** — rejected: the signal's consumer is the dataset author, who works through every face; the summary is the one carrier all faces already share.

## Consequences

- Descriptor authors get the nudge where they work: one line per undeclared layer, naming it, on every face. The warning vocabulary is additive everywhere (`DatasetSummary.warnings`, `DescriptorWarning`) — consumers pinning exact shapes must tolerate the new fields.
- `validateDescriptor`'s return shape is unchanged (the decl gains a field); the warning computation is a pure function over the descriptor, independently testable.
- The tools' JSON output now includes warnings, which means the agent may surface them to users unprompted — desired.

## Testing

`packages/datasets/tests/` — 66 tests over 9 files green. New coverage: the three trigger cases (mixed → one per undeclared; fully explicit → silent; all-public → silent), `modelFacingDeclared` tracking in validation, the summary carrying warnings on service and Remote results, CLI stderr on `list`/`show`/`describe`, and the tab's quiet warning line. Every read path runs unaffected alongside the warnings.

## Cross-references

- [datasets store M1](2026-08-19-datasets-store-m1.md) — the visibility-class declaration this adds warnings to.
- [dataset-level layers](2026-08-20-datasets-dataset-level-layers.md) — layer names span both levels; the declaration (and this warning) attaches to the name, so both levels are covered by construction.
- [datasets proposal](../../../proposals/active/2026-08-19-datasets-store.md) — the visibility-class semantics (`modelFacing` is a data declaration; the export gate is the exporter's).
