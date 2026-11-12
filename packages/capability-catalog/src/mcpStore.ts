/**
 * Host-side MCP server store: keeps the user's configured MCP servers, their
 * discovered tools, credential state, and enable flags. Persistence is a pluggable
 * seam: the host hands the store an `onPersist` callback (backed by the settings
 * namespace) and seeds it with `loadFrom` at boot, so servers survive a restart.
 * Tool metadata comes from the official manager for migrated servers and the
 * legacy connector only for per-tool filters or hosts without that manager.
 */

import type { CatalogMcpCredentialDecl, CatalogMcpServerConfig, CatalogMcpTool } from './types.ts'
import { resolveConfigSecrets } from './mcps.ts'

interface StoredServer {
  config: CatalogMcpServerConfig
  /** Credential values by (namespaced) ref; empty = unconfigured. */
  credentials: Map<string, string>
  /** Discovered tools (from connect + tools/list). */
  tools: CatalogMcpTool[]
}

/** One tool's persisted record: the user's toggle choice only. Descriptions and
 * parameter schemas are discovered at connect time and deliberately NOT persisted
 * (they bloat settings.yaml and go stale); the service re-fills them at boot by
 * re-connecting the enabled servers. */
export interface PersistedMcpTool {
  readonly name: string
  readonly enabled: boolean
}

/** Wire/persisted form of one stored server (config + enabled + tool toggles). */
export interface PersistedMcpServer {
  readonly config: CatalogMcpServerConfig
  readonly tools: readonly PersistedMcpTool[]
}

export interface McpMigrationState {
  readonly version: 1
  readonly official: readonly string[]
  readonly backups: Readonly<Record<string, PersistedMcpServer>>
}

/** The full persisted MCP state block (stored under the settings namespace `mcp` key). */
export interface PersistedMcpState {
  readonly servers?: readonly PersistedMcpServer[]
  /** Namespaced credential ref -> value (the user's own config document). */
  readonly credentials?: Readonly<Record<string, string>>
  readonly migration?: McpMigrationState
}

/** The catalog's own MCP management store (one per process). */
export class McpStore {
  private readonly servers = new Map<string, StoredServer>()
  private readonly official = new Set<string>()
  private readonly backups = new Map<string, PersistedMcpServer>()
  /** Persistence hook, set by the host after the settings scope is available. */
  onPersist: (() => void) | undefined = undefined

  /** Replace the persisted state while retaining freshly discovered tool metadata. */
  loadFrom(state: PersistedMcpState | undefined): void {
    if (state === undefined) return
    const nextNames = new Set((state.servers ?? []).map(server => server.config.serverName))
    for (const name of this.servers.keys()) if (!nextNames.has(name)) this.servers.delete(name)
    this.official.clear()
    for (const name of state.migration?.official ?? []) if (nextNames.has(name)) this.official.add(name)
    this.backups.clear()
    for (const [name, backup] of Object.entries(state.migration?.backups ?? {})) {
      if (nextNames.has(name)) this.backups.set(name, backup)
    }
    for (const server of state.servers ?? []) {
      const existing = this.servers.get(server.config.serverName)
      const known = new Map((existing?.tools ?? []).map(t => [t.name, t]))
      const tools = (server.tools ?? []).map(t => {
        const prev = known.get(t.name)
        return prev !== undefined
          ? { ...prev, enabled: t.enabled }
          : { name: t.name, description: '', enabled: t.enabled }
      })
      this.servers.set(server.config.serverName, { config: server.config, credentials: new Map(), tools })
    }
    for (const [ref, value] of Object.entries(state.credentials ?? {})) {
      this.servers.get(refServer(ref))?.credentials.set(ref, value)
    }
  }

  /** Serialize the current state for persistence. */
  toPersisted(): PersistedMcpState {
    const servers = [...this.servers.values()]
      .sort((a, b) => a.config.serverName.localeCompare(b.config.serverName))
      .map(s => ({ config: s.config, tools: s.tools.map(t => ({ name: t.name, enabled: t.enabled })) }))
    const credentials: Record<string, string> = {}
    for (const s of this.servers.values()) for (const [ref, value] of s.credentials) credentials[ref] = value
    return {
      servers, credentials,
      ...(this.official.size > 0 || this.backups.size > 0
        ? { migration: { version: 1 as const, official: [...this.official].sort(), backups: Object.fromEntries(this.backups) } }
        : {}),
    }
  }

  private persist(): void {
    this.onPersist?.()
  }

  list(): CatalogMcpServerConfig[] {
    return [...this.servers.values()].map(s => ({ ...s.config, enabled: s.config.enabled })).sort((a, b) => a.serverName.localeCompare(b.serverName))
  }

  /** Discovered tool list per server (name → tools). */
  toolsByServer(): Record<string, readonly CatalogMcpTool[]> {
    const out: Record<string, readonly CatalogMcpTool[]> = {}
    for (const [name, s] of this.servers) out[name] = s.tools
    return out
  }

  /** Credential declarations for all servers (whether configured, never the value). */
  credentials(): CatalogMcpCredentialDecl[] {
    const out: CatalogMcpCredentialDecl[] = []
    for (const [name, s] of this.servers) {
      for (const ref of this.credentialRefsOf(s.config)) {
        out.push({ ref, label: refLabel(ref), configured: s.credentials.has(ref) })
      }
      void name
    }
    return out
  }

  /** Add / replace a server config (keeps its credentials if already present). */
  add(config: CatalogMcpServerConfig): void {
    const existing = this.servers.get(config.serverName)
    this.servers.set(config.serverName, {
      config,
      credentials: existing?.credentials ?? new Map(),
      tools: existing?.tools ?? [],
    })
    this.persist()
  }

  remove(serverName: string): void {
    this.official.delete(serverName)
    this.backups.delete(serverName)
    if (this.servers.delete(serverName)) this.persist()
  }

  setEnabled(serverName: string, enabled: boolean): void {
    const s = this.servers.get(serverName)
    if (s === undefined) return
    s.config = { ...s.config, enabled }
    this.persist()
  }

  setCredential(ref: string, value: string): void {
    const s = this.servers.get(refServer(ref))
    if (s === undefined) return
    if (value === '') s.credentials.delete(ref)
    else s.credentials.set(ref, value)
    this.persist()
  }

  setToolEnabled(serverName: string, toolName: string, enabled: boolean): void {
    const s = this.servers.get(serverName)
    if (s === undefined) return
    s.tools = s.tools.map(t => (t.name === toolName ? { ...t, enabled } : t))
    this.persist()
  }

  isOfficial(serverName: string): boolean {
    return this.official.has(serverName)
  }

  backup(serverName: string): PersistedMcpServer | undefined {
    const s = this.servers.get(serverName)
    return s === undefined ? undefined : {
      config: { ...s.config },
      tools: s.tools.map(tool => ({ name: tool.name, enabled: tool.enabled })),
    }
  }

  markOfficial(serverName: string): void {
    const backup = this.backup(serverName)
    if (backup === undefined) return
    this.backups.set(serverName, backup)
    this.official.add(serverName)
    this.persist()
  }

  /** Return to the legacy connector without erasing the user's latest toggles. */
  rollback(serverName: string): void {
    const s = this.servers.get(serverName)
    if (s === undefined) return
    const backup = this.backups.get(serverName)
    if (backup !== undefined) s.config = { ...backup.config, enabled: s.config.enabled }
    this.official.delete(serverName)
    this.backups.delete(serverName)
    this.persist()
  }

  setOfficialTools(serverName: string, tools: readonly CatalogMcpTool[]): void {
    const s = this.servers.get(serverName)
    if (s === undefined || !this.official.has(serverName)) return
    const enabled = new Map(s.tools.map(tool => [tool.name, tool.enabled]))
    const next = tools.map(tool => ({ ...tool, enabled: enabled.get(tool.name) ?? true }))
    if (JSON.stringify(next) === JSON.stringify(s.tools)) return
    s.tools = next
    this.persist()
  }

  credentialValue(ref: string): string | undefined {
    return this.servers.get(refServer(ref))?.credentials.get(ref)
  }

  async discover(serverName: string): Promise<readonly CatalogMcpTool[]> {
    const s = this.servers.get(serverName)
    if (s === undefined || this.official.has(serverName)) return s?.tools ?? []
    try {
      const { connectMcpServer } = await import('./mcpConnector.ts')
      const resolved = await resolveConfigSecrets(s.config, this.secretResolver(serverName, s))
      const connection = await connectMcpServer(resolved)
      const prevEnabled = new Map(s.tools.map(t => [t.name, t.enabled]))
      s.tools = connection.tools.map(t => ({ ...t, enabled: prevEnabled.get(t.name) ?? true }))
      await connection.close()
      this.persist()
      return s.tools
    } catch {
      this.persist()
      return s.tools
    }
  }

  async callTool(serverName: string, rawName: string, args: Record<string, unknown>): Promise<unknown> {
    const s = this.servers.get(serverName)
    if (s === undefined) throw new Error(`unknown MCP server: ${serverName}`)
    if (this.official.has(serverName)) throw new Error(`MCP server "${serverName}" is managed by mcp-manager`)
    const resolved = await resolveConfigSecrets(s.config, this.secretResolver(serverName, s))
    const { connectMcpServer } = await import('./mcpConnector.ts')
    const connection = await connectMcpServer(resolved)
    try {
      return await connection.call(rawName, args)
    } finally {
      await connection.close()
    }
  }

  /** The `resolveConfigSecrets` callback for one server: a bare secret ref
   * resolves to the stored credential under the server's env/header/query
   * namespace (the same namespaces {@link credentialRefsOf} writes). */
  private secretResolver(serverName: string, s: StoredServer): (ref: string) => Promise<string | undefined> {
    return async (ref) => {
      const candidates = [
        `mcp.${serverName}.env.${ref}`,
        `mcp.${serverName}.header.${ref}`,
        `mcp.${serverName}.query.${ref}`,
      ]
      for (const candidate of candidates) {
        const value = s.credentials.get(candidate)
        if (value !== undefined) return value
      }
      return undefined
    }
  }

  /** Extract credential reference paths from a config (env/header/url-query).
   * Namespaced `mcp.<serverName>.env.<KEY>` so multiple servers don't collide. */
  private credentialRefsOf(config: CatalogMcpServerConfig): string[] {
    const refs: string[] = []
    for (const [k, v] of config.env ?? []) if (isSecretRef(v)) refs.push(`mcp.${config.serverName}.env.${k}`)
    for (const [k, v] of config.headers ?? []) if (isSecretRef(v)) refs.push(`mcp.${config.serverName}.header.${k}`)
    if (config.url !== undefined) {
      for (const m of config.url.matchAll(/secretRef:([A-Za-z0-9_.-]+)/g)) {
        refs.push(`mcp.${config.serverName}.query.${m[1] as string}`)
      }
    }
    return refs
  }
}

/** Whether a config value contains an unresolved secret marker (bare or scheme-prefixed). */
export function isSecretRef(value: string): boolean {
  return value.includes('secretRef:')
}

/** Human label for a namespaced ref (strip the `mcp.<server>.` prefix). */
function refLabel(ref: string): string {
  const idx = ref.indexOf('.')
  return ref.slice(idx + 1)
}

/** The server name a namespaced credential ref belongs to (`mcp.<server>…`). */
function refServer(ref: string): string {
  const m = /^mcp\.([A-Za-z0-9_-]+)\./.exec(ref)
  return m?.[1] ?? ''
}
