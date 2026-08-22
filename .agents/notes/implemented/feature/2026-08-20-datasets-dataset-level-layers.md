# Agent Note: dataset-level layers — shared content joins the layer whitelist's jurisdiction

Status: implemented

English | [中文](2026-08-20-datasets-dataset-level-layers.zh.md)

## Problem

Evaluation-suite layouts need content that is shared across items AND visibility-governed (a `verify/helpers/` directory mounted only at judging time). The [M1](2026-08-19-datasets-store-m1.md) layout had layers only at the item level; every dataset-root file was descriptor passthrough — carried, unread, and outside the layer whitelist's jurisdiction, so a rubric directory sitting at the dataset root was visible to every bound session. That is a real governance hole, not a missing convenience.

## Decision

A layer directory may now exist at two levels: `datasets/<id>/<layer>/…` (dataset-level, shared across items) alongside `datasets/<id>/items/<item>/<layer>/…` (item-level, unchanged). The rule is purely name-based: a top-level directory whose name is declared in the descriptor's `layers` manifest IS a dataset-level layer; every other top-level entry stays descriptor passthrough and remains unreachable through the read paths, exactly as before. `items` is the reserved item container and is rejected as a layer name at validation.

Every mechanism applies at both levels uniformly:

- **Whitelist**: `list`/`show` report dataset-level layers (`datasetLayers`, whitelist-filtered); `read` reaches a dataset-level file by omitting `item` (`ReadQuery.item` is now optional).
- **Declaration guard on dataset-level reads**: the item-less read path can address ANY top-level directory, so it additionally requires the layer to be declared (`LAYER_UNDECLARED`) — without this, undeclared passthrough directories would have become tool-readable, re-opening the very hole this change closes. Item-level reads keep M1 semantics (their path cannot leave `items/`).
- **Worktrees**: `layerSparsePatterns` emits both `/<dataset>/<layer>/` and `/<dataset>/items/*/<layer>/` per layer, so a managed worktree physically contains the allowed layers at both levels and nothing else.
- **`modelFacing`**: the declaration is per layer NAME, so it covers both levels by construction — no format change.
- **Tab**: dataset-level layers group under a quiet Shared (共享) label ahead of the items, rendered with the same folder rows as item-level layers; selecting a shared file reads it without an item selector, and the preview header names the Shared group.

Wire change (additive, pre-release line): `ListItemsResult`/`ShowResult` gain `datasetLayers`; `ReadQuery.item` becomes optional. Both are inside request/response objects, so the exact-arity lesson does not apply; gen-typert regenerates the artifacts in the same build.

## Alternatives considered

- **A separate `shared/` container convention** (`datasets/<id>/shared/<layer>/…`) — rejected: a third reserved directory name plus a second sparse-pattern family, where the name-based two-level rule needs neither and reads naturally in the repo.
- **Passthrough reachability via `read`** (treating any top-level directory as addressable) — rejected: it would hand every bound session a read path into undeclared content, the precise governance hole being fixed; the declaration guard keeps passthrough semantics intact.
- **A dedicated Remote verb for shared files** — rejected: `read` with an absent `item` is the same operation on a wider path; a second verb would fork the whitelist logic for zero semantic gain.
- **Changing `modelFacing` to a per-level declaration** — rejected as needless: visibility classes attach to layer semantics (what the content IS), not to where the directory sits.

## Consequences

- Suite layouts can govern shared content: `verify/helpers/` lives at the dataset level, whitelisted out of participant sessions, physically absent from their worktrees.
- A dataset mixing both levels with the SAME layer name works (item-level and dataset-level reads are distinct paths); tests pin the coexistence.
- The wire addition is source-compatible for the tab (fields added, one field relaxed to optional); any consumer pinning the exact result shape must tolerate the new key.
- Descriptor authors gain one validation error: a layer named `items` fails shape validation loud.

## Testing

`packages/datasets/tests/` — 57 tests over 9 files green. New coverage: dataset-level listing is whitelist-filtered and declared-only (`drafts/` passthrough never lists), dataset-level reads with the item omitted (including the same layer name at both levels), `LAYER_UNDECLARED` for passthrough directories and `LAYER_NOT_ALLOWED` for whitelisted-out shared layers, worktree sparse patterns and physical presence/absence at both levels, the reserved `items` layer name, the CLI's `shared:` listing line, and the tab's Shared group rendering plus item-less reads.

## Cross-references

- [datasets store M1](2026-08-19-datasets-store-m1.md) — the layout convention this extends (its layout bullet points here).
- [datasets M2](2026-08-19-datasets-m2-remote-tab.md) — the tab face; its tree and Remote facts updated for the Shared group and the wire addition.
- [datasets proposal](../../../proposals/active/2026-08-19-datasets-store.md) — the governance model this completes for shared content.
