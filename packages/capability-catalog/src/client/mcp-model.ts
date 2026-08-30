import type { CapabilityCatalogSnapshot, CatalogMcpCredentialDecl, CatalogMcpServerConfig, CatalogMcpSnapshot, CatalogMcpTool, CatalogToolRow, McpTransport } from '@khorsheed/dsh-capability-catalog/types'
  import { maskSecret, SECRET_REF_PREFIX } from '../mcps.ts'
  import type { CapabilityCatalogKey } from './locales.ts'

/** One merged MCP server group shown in the MCP section. `managed` servers are
 * catalog-controlled (config + credentials + per-tool toggles); live-only ones
 * are read-only snapshots of already-registered MCP tools. */
export interface McpGroup {
  readonly serverName: string
  readonly transport: McpTransport | undefined
  readonly enabled: boolean
  readonly managed: boolean
  readonly config: CatalogMcpServerConfig | undefined
  readonly tools: readonly CatalogMcpTool[]
  readonly liveTools: readonly CatalogToolRow[]
  readonly credentials: readonly CatalogMcpCredentialDecl[]
  readonly toolCount: number
}

/** Fold the tool-graph MCP entries + the catalog's managed servers into one
 * server-grouped list (catalog-managed wins over a same-name live group). */
export function buildMcpGroups(
  snapshot: CapabilityCatalogSnapshot | undefined,
  mcps: CatalogMcpSnapshot | null,
  query: string,
): McpGroup[] {
  const q = query.trim().toLowerCase()
  const groups: McpGroup[] = []
  const seen = new Set<string>()

  for (const server of mcps?.servers ?? []) {
    if (q !== '' && !server.serverName.toLowerCase().includes(q)) continue
    const creds = (mcps?.credentials ?? []).filter((c) => c.ref.startsWith(`mcp.${server.serverName}.`))
    const tools = mcps?.tools[server.serverName] ?? []
    groups.push({
      serverName: server.serverName,
      transport: server.transport,
      enabled: server.enabled,
      managed: true,
      config: server,
      tools,
      liveTools: [],
      credentials: creds,
      toolCount: tools.length,
    })
    seen.add(server.serverName)
  }

  // Live-registered MCP tools (already in `ctx.tools`) folded by server. These
  // are not catalog-managed, so they are read-only in the section.
  const byServer = new Map<string, CatalogToolRow[]>()
  for (const tool of snapshot?.tools ?? []) {
    if (tool.channel !== 'mcp') continue
    const s = tool.serverName ?? 'MCP'
    const list = byServer.get(s)
    if (list !== undefined) list.push(tool)
    else byServer.set(s, [tool])
  }
  for (const [serverName, live] of byServer) {
    if (seen.has(serverName)) continue
    if (q !== '' && !serverName.toLowerCase().includes(q)) continue
    groups.push({
      serverName,
      transport: undefined,
      enabled: true,
      managed: false,
      config: undefined,
      tools: [],
      liveTools: live,
      credentials: [],
      toolCount: live.length,
    })
  }

  return groups.sort((a, b) => a.serverName.localeCompare(b.serverName))
}

/** Human label for a transport kind. */
export function transportLabel(t: (key: CapabilityCatalogKey) => string, transport: McpTransport): string {
  if (transport === 'stdio') return 'stdio'
  if (transport === 'streamable-http') return 'streamable-http'
  return t('mcpUnknown')
}

/** Mask any `secretRef:` markers in a URL for read-only display. */
function maskUrl(url: string): string {
  return url.replace(new RegExp(`${SECRET_REF_PREFIX}[A-Za-z0-9_.-]+`, 'g'), '·secretRef·')
}

/** Read-only JSON view of a server config, with secret values masked. */
export function configDisplay(config: CatalogMcpServerConfig): string {
  const env = (config.env ?? []).map(([k, v]) => [k, maskSecret(v)])
  const headers = (config.headers ?? []).map(([k, v]) => [k, maskSecret(v)])
  const url = config.url !== undefined ? maskUrl(config.url) : undefined
  const masked: Record<string, unknown> = {
    serverName: config.serverName,
    transport: config.transport,
    enabled: config.enabled,
    ...(config.command !== undefined ? { command: config.command } : {}),
    ...(config.args !== undefined ? { args: config.args } : {}),
    ...(config.cwd !== undefined ? { cwd: config.cwd } : {}),
    ...(url !== undefined ? { url } : {}),
    ...(headers.length > 0 ? { headers } : {}),
    ...(env.length > 0 ? { env } : {}),
  }
  return JSON.stringify(masked, null, 2)
}
