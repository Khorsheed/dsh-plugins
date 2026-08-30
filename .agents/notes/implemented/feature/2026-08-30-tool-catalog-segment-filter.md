# Agent Note: The tools tab is a three-segment filter (内置 / 插件 / 其他) and MCP renders as server cards

Status: implemented

English | [中文](2026-08-30-tool-catalog-segment-filter.zh.md)

This note records the tool-catalog restructure shipped in `@khorsheed/dsh-capability-catalog` 0.1.69 (the tools half of the 工具与技能 settings tab).

## Problem

The tools tab originally filtered with a source `<select>` (全部 / 内置 / 插件) and rendered MCP tools folded-by-server in a separate section below the grid. That left two problems: the filter did not map cleanly onto the three real user-facing buckets, and MCP management sat pushed below the tall tool grid. A sort-by-recent update was proposed, but tool rows carry no `updatedAt` (tools are dynamically registered, with no file mtime to key off), so a recency sort was not meaningfully available.

## Decision

**1. The tools tab is driven by a three-segment filter (内置 / 插件 / 其他) below the search box, replacing the source dropdown.** The segments map 1:1 onto `CatalogToolChannel`'s user-facing buckets: 内置 = `builtin`, 插件 = `plugin`, 其他 = `mcp`. Each segment button shows its own count. The sort dropdown is dropped for tools — the search box is the only remaining control, matching the earlier decision to defer recency sorting (no `updatedAt`).

**2. 其他 is the user-imported MCP view, rendered as server cards indistinguishable in anatomy from the builtin/plugin cards.** MCP is no longer a separate section pushed below the grid; it is a third grid view. Each MCP server renders as a tile (name + transport pill + tool count + external enable switch + detail/remove foot actions). Clicking the card opens a **manage modal** whose inner view deliberately differs from the builtin/plugin detail modal: masked config JSON, per-credential inputs (no plaintext on the wire), per-tool enable toggles, and a «connect & discover» action. The old folded-by-server MCP group cards are removed.

## Alternatives considered

- **Keep MCP as its own folded-by-server section below the grid.** Rejected: it sat below the tall tool grid and split MCP management from browsing.
- **Render the mcp segment as flat per-tool cards (like builtin/plugin).** Rejected: the MCP-server unit is not an individual tool but a configurable server with per-tool toggles and credentials; the user explicitly wanted «toggle the tools inside, configure credentials» as the card's inner view, so the card is the server.
- **Keep the sort dropdown for tools.** Rejected for now: tool rows have no `updatedAt`, so a recency sort would be a no-op/opaque. Deferred until tools carry a timestamp.

## Consequences

- **MCP server cards carry no description body.** `CatalogMcpServerConfig` (and the server group) has no `description`; only the individual MCP *tools* do. The card body therefore shows the tool count instead of prose.
- The 其他 segment counts **MCP servers**, not MCP tools (the grid shows one card per server, not per tool), so its count column does not sum to the tools-tab total (which counts individual tool rows, including MCP tools).
- The default segment is 内置 (the largest/host bucket). The `新增 MCP` toolbar button remains available in every segment; an empty 其他 view points to it.
- MCP server management moved from an in-place expand to a modal; the manage modal reads fresh state (derived by server name from the current groups) so mutations re-render it in place.
- **A server with many tools does not balloon the modal page.** The manage modal (0.1.70) collapses the masked config JSON into a `<details>` (default closed, summary is the 配置 label), gives the tool list a bounded, independently-scrolling column (`max-height: min(34vh, 360px)` + `overflow-y`), and adds a per-server tool sub-search box that filters by name/description — so a large tool list stays navigable and the discover/actions row stays reachable. The tools header also shows an enabled count (`N/M 启用`, live-only groups count all tools as enabled) since the collapsed config no longer exposes every per-tool toggle at once; the tool-list height and the expanded-config `max-height` (160px) are tuned so opening the config does not push the modal past the viewport.
