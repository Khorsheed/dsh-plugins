/**
 * Host-side MCP server store: keeps the user's configured MCP servers, their
 * discovered tools, credential state, and enable flags. Persistence is a pluggable
 * seam: the host hands the store an `onPersist` callback (backed by the settings
 * namespace) and seeds it with `loadFrom` at boot, so servers survive a restart.
 * Tool discovery connects via the SDK connector and caches the tool list.
 */

import type { CatalogMcpCredentialDecl, CatalogMcpServerConfig, CatalogMcpTool } from './types.ts'
import { resolveConfigSecrets } from './mcps.ts'

interface StoredServer {
  config: CatalogMcpServerConfig
  /** Credential values by (namespaced) ref; empty = unconfigured. */
  credentials: Map<string, string>
  /** Discovered tools (from connect + tools/list). */
  tools: CatalogMcpTool[]
  /** Error from the last connect/discover attempt. */
  error: string | undefined
}

/** Wire/persisted form of one stored server (config + enabled + discovered tools). */
export interface PersistedMcpServer {
  readonly config: CatalogMcpServerConfig
  readonly tools: readonly CatalogMcpTool[]
}

/** The full persisted MCP state block (stored under the settings namespace `mcp` key). */
export interface PersistedMcpState {
  readonly servers?: readonly PersistedMcpServer[]
  /** Namespaced credential ref -> value (the user's own config document). */
  readonly credentials?: Readonly<Record<string, string>>
}

/** The catalog's own MCP management store (one per process). */
export class McpStore {
  private readonly servers = new Map<string, StoredServer>()
  /** Persistence hook, set by the host after the settings scope is available. */
  onPersist: (() => void) | undefined = undefined

  /** Seed the store from the persisted state (boot or external config edit). */
  loadFrom(state: PersistedMcpState | undefined): void {
    if (state === undefined) return
    for (const server of state.servers ?? []) {
      this.servers.set(server.config.serverName, {
        config: server.config,
        credentials: new Map(),
        tools: [...(server.tools ?? [])],
        error: undefined,
      })
    }
    for (const [ref, value] of Object.entries(state.credentials ?? {})) {
      const s = this.servers.get(refServer(ref))
      if (s !== undefined) s.credentials.set(ref, value)
    }
  }

  /** Serialize the current state for persistence. */
  toPersisted(): PersistedMcpState {
    const servers = [...this.servers.values()]
      .sort((a, b) => a.config.serverName.localeCompare(b.config.serverName))
      .map(s => ({ config: s.config, tools: s.tools }))
    const credentials: Record<string, string> = {}
    for (const s of this.servers.values()) for (const [ref, value] of s.credentials) credentials[ref] = value
    return { servers, credentials }
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
      error: existing?.error,
    })
    this.persist()
  }

  remove(serverName: string): void {
    if (this.servers.delete(serverName)) this.persist()
  }

  /** Set server-level enable flag (discovery/registration is the caller's job). */
  setEnabled(serverName: string, enabled: boolean): void {
    const s = this.servers.get(serverName)
    if (s === undefined) return
    s.config = { ...s.config, enabled }
    this.persist()
  }

  /** Set one credential value (empty clears it). */
  setCredential(ref: string, value: string): void {
    const serverName = refServer(ref)
    const s = this.servers.get(serverName)
    if (s === undefined) return
    if (value === '') s.credentials.delete(ref)
    else s.credentials.set(ref, value)
    this.persist()
  }

  /** Configure a tool's enable flag. */
  setToolEnabled(serverName: string, toolName: string, enabled: boolean): void {
    const s = this.servers.get(serverName)
    if (s === undefined) return
    s.tools = s.tools.map(t => (t.name === toolName ? { ...t, enabled } : t))
    this.persist()
  }

  /** Connect + discover tools for a server; caches the list (connect errors surface). */
  async discover(serverName: string): Promise<readonly CatalogMcpTool[]> {
    const s = this.servers.get(serverName)
    if (s === undefined) return []
    try {
      // Dynamic import keeps the SDK-backed connector out of the typert-analyzed
      // host face (third-party SDK types aren't resolvable in the gen-typert overlay).
      const { connectMcpServer } = await import('./mcpConnector.ts')
      // Resolve secretRef markers to the stored credential values before connecting,
      // so a configured API key is sent as its real value (never the secretRef).
      const resolved = await resolveConfigSecrets(s.config, async (ref) => {
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
      })
      const connection = await connectMcpServer(resolved)
      s.tools = connection.tools.map(t => ({ ...t, enabled: true }))
      s.error = undefined
      await connection.close()
      this.persist()
      return s.tools
    } catch (error) {
      s.error = String(error)
      this.persist()
      return s.tools
    }
  }

  /** A server's most recent connection/dev error. */
  errorOf(serverName: string): string | undefined {
    return this.servers.get(serverName)?.error
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

/** Whether a config value is an unresolved secret marker. */
export function isSecretRef(value: string): boolean {
  return value.startsWith('secretRef:')
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
