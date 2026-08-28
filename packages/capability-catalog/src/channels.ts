/**
 * Tool channel attribution and skill source labels.
 *
 * Tools have no source field on `ToolDefinition`, so the catalog infers the
 * channel from three signals (see the proposal "工具归因" section):
 *   1. the `mcp__` prefix (exact),
 *   2. the generated official-tools whitelist (exact),
 *   3. baseline-diff inference (`builtin?` / `plugin`).
 *
 * MCP serverName is resolved by longest-match: the mcp-client server-name
 * charset permits underscores (`[A-Za-z0-9_-]{1,32}`), so `mcp__a__b__tool`
 * could belong to server `a` or `a__b`; the longest configured prefix that
 * leaves a non-empty raw tool name wins.
 * @module @khorsheed/dsh-capability-catalog/channels
 */

import type { CatalogToolChannel } from './types.ts'

/** The `mcp__` prefix mcp-client stamps on every tool it registers. */
export const MCP_TOOL_PREFIX = 'mcp__'

/** Tool names this plugin itself registers (self-attribution). */
export const SELF_TOOL_NAMES = ['list_capabilities'] as const

/** One tool's channel attribution result. */
export interface ToolAttribution {
  readonly channel: CatalogToolChannel
  readonly confidence: 'exact' | 'inferred'
  readonly serverName?: string
  readonly owner?: string
}

/**
 * Resolve the channel for one tool name.
 * @param name - wire tool name.
 * @param officialTools - official-tools whitelist (Set).
 * @param mcpServerNames - configured MCP serverNames (longest first).
 * @param appearedAfterApply - whether the tool appeared after apply-time baseline.
 */
export function attributeToolChannel(
  name: string,
  officialTools: ReadonlySet<string>,
  mcpServerNames: readonly string[],
  appearedAfterApply: boolean,
): ToolAttribution {
  if (name.startsWith(MCP_TOOL_PREFIX)) {
    const serverName = resolveMcpServerName(name, mcpServerNames)
    return { channel: 'mcp', confidence: 'exact', ...(serverName !== undefined ? { serverName } : {}) }
  }
  if ((SELF_TOOL_NAMES as readonly string[]).includes(name)) {
    return { channel: 'plugin', confidence: 'exact', owner: '@khorsheed/dsh-capability-catalog' }
  }
  if (officialTools.has(name)) {
    return { channel: 'builtin', confidence: 'exact' }
  }
  if (!appearedAfterApply) {
    return { channel: 'builtin', confidence: 'inferred' }
  }
  return { channel: 'plugin', confidence: 'inferred' }
}

/** Longest-match MCP serverName resolution. */
export function resolveMcpServerName(name: string, serverNames: readonly string[]): string | undefined {
  const candidates = [...serverNames].sort((a, b) => b.length - a.length)
  for (const server of candidates) {
    const prefix = `${MCP_TOOL_PREFIX}${server}__`
    if (name.startsWith(prefix) && name.length > prefix.length) return server
  }
  const rest = name.slice(MCP_TOOL_PREFIX.length)
  const separator = rest.indexOf('__')
  if (separator > 0) return rest.slice(0, separator)
  return undefined
}

/** Human label for a skill channel bucket. */
export function skillChannelLabel(source: string): string {
  switch (source) {
    case 'bundled': return '官方 · bundled'
    case 'runtime': return '插件 · runtime'
    case 'project-dsh': return '项目 · .dsh'
    case 'project-agents': return '项目 · .agents'
    case 'custom': return '自定义'
    case 'user-dsh': return '用户 · dsh'
    case 'user-agents': return '用户 · agents'
    default: return source
  }
}
