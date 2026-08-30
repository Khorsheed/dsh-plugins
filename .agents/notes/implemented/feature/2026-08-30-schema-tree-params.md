# Agent Note: Tool parameter schemas render as a schema tree, not a nested table

Status: implemented

English | [中文](2026-08-30-schema-tree-params.zh.md)

This note records the parameter-display rework in `@khorsheed/dsh-capability-catalog` (the `SchemaView` shared by the tool detail modal and the MCP manage modal's per-tool schema).

## Problem

The parameter view was a `<table>` (参数/类型/描述/必填) that rendered nested `object`/`array<object>` schemas as flat `<tr>`s with per-depth `paddingLeft` and an inset box-shadow rail. In practice it read badly: the hierarchy was invisible until you stared at the indent, the 必填 column wasted a full column on one 是, every row carried a heavy separator line, and the rail only appeared on nested rows so the table looked broken at the seam. Nested schemas are fundamentally tree-shaped, and a table fights that shape.

## Decision

**The parameter view is a schema tree.** Each property is one node: a head row (chevron + monospace name + red `*` for required, with a `必填` tooltip + type chip), and the description on a second line aligned to the name column. Children render inside a single vertical guide line at the parent chevron's center — one continuous line per level, no per-row rails. All levels start expanded (state tracks the *collapsed* set, default empty), so the full hierarchy is visible at a glance; a parent node's whole head row is the toggle button. The 必填 column, the `paramName`/`paramType`/`paramDesc` locale keys, and the entire `toolParamsTable*`/`toolParamsNestedRow`/`toolParamsExpand` CSS block are gone; the 表格 toggle tab is renamed 结构 (`paramsTree`). In the MCP tool card (compact mode) the tree is transparent — the card's own layer-1 band carries it. The JSON view and 复制 JSON are unchanged. The same change removed the dead CSS the earlier iterations left behind (the pre-card `.card`/`.cardHead`/`.preview`/`.open`/`.scroll`/`.body`/`.divider`/`.title` chrome, the removed password eye button's `.eyeBtn` and its 64px input padding, `.infoBtn`, `.fieldGroup`, `.fieldLabelStrong`, `.pvDate`).

## Alternatives considered

- **Keep the table, polish the indent/rail/columns.** Rejected: the flat-row table's problems are structural — a nested schema is not tabular data, and every fix (deeper indent, rails, zebra) adds chrome that fights the grid. The 必填 column alone costs ~15% width for one glyph.
- **Nest a separate mini-table per expanded level.** Rejected earlier and confirmed here: column alignment across tables is impossible without fixed widths, and the visual seam between tables is worse than the rail.
- **JSON-only view.** Rejected: raw JSON is the fallback for non-object schemas and stays one toggle away, but it buries the required/type signal in braces for the common case.

## Consequences

- The hierarchy is readable without interaction, and the required/type signal is scannable per row; collapsed state is per-node and resets with the view (acceptable — the view is transient).
- `nestedSchemaOf`/`schemaProps`/`requiredNames`/`typeLabel` are unchanged — the tree consumes the same schema walking the table did, so MCP `array<object>` items behave identically.
- No client-side tests exist for this component; verification was visual on the 3090 instance (deep builtin schema, MCP compact tree, JSON toggle, collapse). The 68 host-side tests are unaffected.
- `CapabilityCatalogCard.tsx` remains a ~1.8k-line single file (15 components); splitting it is a known, deliberately deferred cleanup — this change does not grow it.
