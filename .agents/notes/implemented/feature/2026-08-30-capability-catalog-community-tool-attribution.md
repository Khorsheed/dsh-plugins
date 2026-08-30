# Agent Note: capability-catalog attributes community plugin tools via the composition

Status: implemented

English | [中文](2026-08-30-capability-catalog-community-tool-attribution.zh.md)

This note records how `@khorsheed/dsh-capability-catalog` now attributes tools registered by community (`@khorsheed/*`) plugins to the 插件 channel instead of defaulting them to 内置.

## Problem

The harness `ToolSchema` carries no source/owner field, so `attributeToolChannel` inferred channel from three signals: the `mcp__` prefix, the generated official-tools whitelist, and an apply-time baseline diff (`appearedAfterApply`). The official whitelist is **incomplete** — it omits real harness core tools (`run_code`, `glob`, `grep`, `skill`, `workflow`, `subagent`, `exit_plan_mode`). The baseline diff therefore classified every tool present at apply time that was NOT whitelisted as `builtin` (inferred) — which swept community plugin tools (`subagent_kimi`, `subagent_dsh`, …) into 内置, so the 插件 segment showed 0 and the tools tab was misleading. The naive "flip unknown → plugin" is wrong: it would mislabel those harness core tools as plugin.

## Decision

**Build a community-tool set from the active Cordis composition and attribute those tools to `plugin` (exact), before the baseline-builtin fallback.** The composition (`ctx.get('loader').entries()`) exposes each active bundle-patch row with `options.name` (the module id) and `options.config`; community tool rows declare their tool name in `config.toolName` (e.g. `@khorsheed/dsh-local-agent-tool-subagent` → `config.toolName: 'subagent_kimi'`). Scanning those rows yields tool-name → module with no host change.

- `community-tools.ts` — `collectCommunityToolOwners(loader)` returns `Map<toolName, module>` for `@khorsheed/*` rows that declare a `toolName`; degrades to empty when the loader/entries seam is absent or the composition is not ready.
- `channels.ts` — `attributeToolChannel` gains a `communityTools` param; a tool in that map attributes to `{ channel: 'plugin', confidence: 'exact', owner }`.
- `remote.ts` — `projectTools` / `catalogSnapshot` thread the map through.
- `index.ts` — the service computes the map once at apply (`ctx.get('loader')`) and passes it to every `catalogSnapshot` call.

Resolution order is now: `mcp__` prefix → self → community-tool map → official whitelist → baseline-inferred-builtin → post-apply-inferred-plugin. This keeps not-whitelisted harness core tools as 内置 (via the baseline fallback) while correctly surfacing known community tools as 插件.

## Alternatives considered

- **Flip unknown → plugin.** Rejected: the official whitelist is incomplete (missing `run_code`, `glob`, `grep`, `skill`, `workflow`, `subagent`, `exit_plan_mode`), so that mislabels harness core tools as plugin.
- **`Symbol.for('dsh.tool.origin')` on the `ToolDefinition`, read via `ctx.tools.get()`.** The durable community convention, but requires every tool-registering plugin to opt in (cross-package). The composition scan gives the catalog an immediate, catalog-only fix.
- **A `subagent_*` / naming prefix heuristic.** Partially effective but not authoritative and misses unrelated plugin tool names.

## Consequences

- Community plugin tools that declare a `toolName` row now show 插件; harness core tools not in the (incomplete) whitelist stay 内置 via the baseline fallback. Tools that are neither whitelisted nor a declared community row-and not mcp stay baseline-inferred-builtin (unchanged, conservative).
- Catalog-only change: `community-tools.ts` added to `tsconfig.host.json`'s file list; build + 71 host-side tests + `check:plugins` green. The composition seam degrades safely (empty map → the previous heuristics).
- Consumers can still read `owner` (currently the declaring tool module, e.g. `@khorsheed/dsh-local-agent-tool-subagent`); a later refinement could resolve it to the declaring plugin bundle.
