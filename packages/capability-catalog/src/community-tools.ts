/**
 * Community tool attribution: map a tool name to the community plugin that
 * declared it, so the catalog can attribute tools to `plugin` instead of
 * defaulting baseline-registered tools to `builtin`.
 *
 * The harness `ToolSchema` carries no source/owner field, so the catalog infers
 * channel (see `channels.ts`). Tools registered by a community (`@khorsheed/*`)
 * plugin are indistinguishable from harness builtins in `ctx.tools.schemas()`.
 * But the Cordis composition (`ctx.loader.entries()`) exposes each active
 * bundle-patch row, and the tool rows declare their tool name in `config.toolName`
 * (e.g. `tool-subagent-kimi` → `config.toolName: 'subagent_kimi'`). Scanning those
 * rows gives a reliable tool-name → plugin mapping with no host change.
 * @module @khorsheed/dsh-capability-catalog/community-tools
 */

/** The community scope prefix: tools declared by these plugins are community (plugin). */
const COMMUNITY_SCOPE = '@khorsheed/'

/** The composition-scan seam: entries yield rows with `options.name` + `options.config`. */
export interface CompositionEntry {
  readonly options?: {
    readonly name?: string
    readonly config?: Record<string, unknown>
  }
}

/** The minimal `ctx.get('loader')` shape the catalog reads (defensive). */
export interface CompositionLoader {
  entries?: () => Iterable<CompositionEntry>
}

/**
 * Collect tool-name → declaring-module for tools declared by a community plugin
 * row. Degrades to an empty map when the loader seam is absent or the composition
 * is not yet ready (the catalog falls back to the channel heuristics).
 * @param loader - `ctx.get('loader')`, optional.
 */
export function collectCommunityToolOwners(loader: CompositionLoader | undefined): Map<string, string> {
  const owners = new Map<string, string>()
  if (loader?.entries === undefined) return owners
  try {
    for (const entry of loader.entries()) {
      const options = entry?.options
      const name = options?.name
      const toolName = (options?.config as { toolName?: unknown } | undefined)?.toolName
      if (typeof name !== 'string' || !name.startsWith(COMMUNITY_SCOPE)) continue
      if (typeof toolName !== 'string' || toolName === '') continue
      owners.set(toolName, name)
    }
  } catch {
    // Composition not ready / seam unavailable — keep the heuristic fallback.
  }
  return owners
}
