# Agent Note: MCP settings persist only tool name+enabled; descriptions are re-discovered at boot

Status: implemented

English | [中文](2026-08-30-mcp-persist-name-enabled.zh.md)

This note records the MCP persistence decision shipped in `@khorsheed/dsh-capability-catalog` 0.1.73 (the `capability-catalog.mcp` block in `settings.yaml`).

## Problem

The persisted MCP block stored each discovered tool's full `description` and the entire `parameters` JSON schema alongside `name` and `enabled`. For `mcp-server-everything` (13 tools) that was ~200 lines / ~8KB of an 8KB file — and far worse for a real server with dozens of tools and large schemas. Tool descriptions and parameter schemas are **discovered** from the server at connect time, not user-configured; persisting them bloated the config file and went stale when the server changed.

## Decision

**The settings block persists only the user's toggle choice per tool — `{ name, enabled }` — never `description` or `parameters`.** The full metadata is re-derived by re-connecting the enabled servers at boot:

- `McpStore.toPersisted()` reduces each tool to `{ name, enabled }`.
- `McpStore.loadFrom()` reconstructs tools with an empty description, then **merges** the persisted toggle into any existing in-memory tool by name (keeping its discovered `description`/`parameters`). This is essential: `discover()` fills descriptions in memory, `persist()` round-trips through the settings `watch`, and `loadFrom` must not wipe what discovery just produced.
- `McpStore.reconnectAll()` re-connects every enabled server at boot (async, per-server errors contained) to re-fill descriptions/parameters; the service calls it after the settings inject loads the persisted state and re-syncs `ctx.tools` registration once done.
- `discover()` preserves the user's per-tool enable flags (re-discovering refreshes schema without resetting toggles; new tools default on).

## Alternatives considered

- **Keep persisting the full tool list.** Rejected: bloats settings.yaml and goes stale. This was the diagnosed root cause (the file reached 8401 bytes / 203 lines for 13 tools).
- **Persist `{ name, enabled }` and never re-discover.** Rejected as the primary option (and is option B we declined): descriptions/parameters would stay empty until an explicit manual discover, degrading the model-facing registration.
- **A separate metadata cache file (desc/params) outside settings.yaml.** Not chosen: re-discovering at boot is simpler and self-healing — the cache would still need invalidation, and a downed server can't provide tools anyway.

## Consequences

- `settings.yaml` shrinks dramatically: measured 8401 → 1688 bytes, 203 → 39 lines, 28 → 0 `description:` lines for the 13-tool demo server.
- Tool `description`/`parameters` exist only in memory after a connect/discover. On boot, enabled servers are re-connected (spawning each stdio/HTTP client) to repopulate them; a server that cannot be reached leaves its tools name-only (and records an error) until it can be connected.
- Per-tool enable flags survive restart; re-discovering never resets a user's toggles.
- The `loadFrom` merge is the load-bearing detail: without it, the write→watch→reload round-trip after discovery wipes the descriptions it just filled.
