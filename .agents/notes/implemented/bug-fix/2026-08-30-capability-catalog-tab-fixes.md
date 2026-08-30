# Agent Note: capability-catalog tab fixes (MCP refresh, source default-collapse, drop the 全部 fallback)

Status: implemented

English | [中文](2026-08-30-capability-catalog-tab-fixes.zh.md)

This note records three small behavior fixes shipped together in `@khorsheed/dsh-capability-catalog` (tools/skills settings tab).

## Problem

- **Deleting/adding an MCP server did not disappear from the tools grid until a manual page refresh.** `removeMcp` (and the other MCP mutators) only refreshed the MCP store via `mcpSnapshot()`, not the catalog snapshot that feeds the tool grid. The host had already unregistered the `mcp__<server>__<tool>` tools from `ctx.tools`, but the client's cached `snapshot.tools` still held them, so `buildMcpGroups` re-created the group.
- **The skill detail modal opened with 查看源码 (view source) expanded by default**, pushing the metadata/credential content down.
- **Empty-states showed a confusing「全部」jump-link** ("没有匹配的工具 全部" / "没有匹配的技能 全部") that implied clicking it navigates to "all", and was copy-pasted into both the tools and skills empty states with a `resetFilter` handler.

## Decision

1. **`refreshMcp` now re-fetches the catalog snapshot too** — any MCP add/remove/enable/discover changes which `mcp__` tools are registered on the host tool registry, so the catalog grid must refresh alongside the MCP store. Implemented as `Promise.all([refresh(), mcpSnapshot().then(setMcps)])`.
2. **`sourceOpen` defaults to `false`** — 查看源码 collapses by default (chevron-right), matching the metadata block's collapsed `<details>`.
3. **Removed the「全部」fallback jump-link from both empty states** and deleted the now-dead `resetFilter` function/prop and `.ghostLink` CSS. The segment buttons keep their「全部」label (that is the tab, not the fallback).

## Alternatives considered

- **Only refresh the MCP store after a mutation (the old behavior).** Rejected: an MCP add/remove/enable/discover also changes which `mcp__` tools the host registers, so the catalog grid must refresh or it serves a stale tool list.
- **Keep 查看源码 open by default.** Rejected: it pushed the metadata/credential content down; collapsing by default matches the metadata block's collapsed `<details>`.
- **Keep the「全部」jump-link on skills only but drop it on tools.** Rejected: the same confusing pattern applies to both empty states, so both drop it for consistency.

## Consequences

- Applies to all MCP mutators (remove/add/enable/tool-enable/discover) since they all call `refreshMcp`.
- Behavior-only; no data-model or locale-key change. (`filterAll` stays, used by the segment button; `noFilterMatch`/`toolNoMatch` stay as plain empty-state text.)
