import type { ToolSchemaLike } from './tool-face.ts'
import type { McpStore } from './mcpStore.ts'
import type { CatalogMcpServerConfig, CatalogMcpTool } from './types.ts'
import {
  officialCredentialRef, officialMcpEntry, officialPublicToolName, sameOfficialEntry,
  type McpCredentialKind, type OfficialMcpEntry,
} from './mcp-official.ts'

interface ManagerStatus {
  state: string
  reason?: string
}

export interface McpManagerSlice {
  readonly config: { readonly servers: { get(): Readonly<Record<string, OfficialMcpEntry>> } }
  list(): readonly { name: string; configured: boolean; status: ManagerStatus }[]
  probe(name: string): Promise<{
    ok: boolean
    toolNames?: string[]
    closeConfirmed: boolean
    cleanupError?: string
    message?: string
  }>
  restart(name: string): Promise<void>
  watch(signal: AbortSignal): AsyncIterable<readonly { name: string; status: ManagerStatus }[]>
}

export interface McpOfficialSettings {
  update(ns: string, patch: Record<string, unknown>): Promise<void>
  mutate(ns: string, ops: readonly { op: 'set' | 'unset'; path: readonly string[]; value?: unknown }[]): Promise<void>
}

export interface McpOfficialCredentials {
  set(ref: string, value: string): Promise<void>
  unset(ref: string): Promise<void>
  resolve(ref: string): Promise<{ value: string } | undefined>
}

export interface McpOfficialTools {
  schemas(): readonly ToolSchemaLike[]
}

interface CredentialMove {
  kind: McpCredentialKind
  stored: string
  ref: string
  value?: string
}

/** Migrate catalog-owned entries into the official manager, one server at a time. */
export class McpManagerBridge {
  private tail: Promise<void> = Promise.resolve()

  constructor(
    private readonly store: McpStore,
    private readonly manager: McpManagerSlice,
    private readonly settings: McpOfficialSettings,
    private readonly tools: McpOfficialTools,
    private credentials: McpOfficialCredentials | undefined,
    private readonly warn: (message: string) => void,
    private readonly changed: () => void,
  ) {}

  bindCredentials(credentials: McpOfficialCredentials): void {
    this.credentials = credentials
  }

  private entries(): Readonly<Record<string, OfficialMcpEntry>> {
    return this.manager.config.servers.get()
  }

  private entry(name: string): OfficialMcpEntry | undefined {
    return this.entries()[name]
  }

  private owned(name: string, config: CatalogMcpServerConfig): boolean {
    const actual = this.entry(name)
    return actual !== undefined && sameOfficialEntry(actual, { ...officialMcpEntry(config), enabled: actual.enabled })
  }

  private foreign(name: string, config: CatalogMcpServerConfig): boolean {
    return this.entry(name) !== undefined && !this.owned(name, config)
  }

  /** Do not create a second registration for any existing manager entry. */
  legacyServers(): CatalogMcpServerConfig[] {
    return this.store.list().filter(config => !this.store.isOfficial(config.serverName)
      && (this.entry(config.serverName) === undefined || this.entry(config.serverName)!.enabled === false && !this.foreign(config.serverName, config)))
  }

  /** Withdraw our old entry before a migrated server's configuration is replaced. */
  async prepareEdit(config: CatalogMcpServerConfig): Promise<boolean> {
    return this.enqueue(async () => {
      const name = config.serverName
      if (this.store.isOfficial(name)) {
        if (!this.owned(name, this.store.list().find(server => server.serverName === name)!)) return false
        await this.settings.mutate('mcp-manager', [{ op: 'unset', path: ['servers', name] }])
        this.store.rollback(name)
      }
      if (this.foreign(name, config)) {
        this.warn(`capability-catalog: MCP server "${name}" is already managed elsewhere; choose a different name`)
        return false
      }
      return true
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.tail.then(operation)
    this.tail = run.then(() => undefined, () => undefined)
    return run
  }

  schedule(): void {
    void this.reconcile().catch((error: unknown) => this.warn(`capability-catalog: MCP manager reconcile failed: ${error instanceof Error ? error.message : String(error)}`))
  }

  async reconcile(): Promise<void> {
    return this.enqueue(async () => {
      for (const config of this.store.list()) {
        if (this.store.isOfficial(config.serverName)) {
          if (this.hasDisabledTools(config.serverName)) await this.rollbackNow(config.serverName)
          else if (this.owned(config.serverName, config)) {
            const credentials = this.credentialMoves(config, true)
            if (credentials !== undefined) await this.moveCredentials(credentials)
            const desired = officialMcpEntry(config)
            if (!sameOfficialEntry(this.entry(config.serverName), desired)) {
              await this.settings.update('mcp-manager', { servers: { [config.serverName]: desired } })
            }
            await this.refresh(config.serverName)
          } else {
            this.warn(`capability-catalog: MCP server "${config.serverName}" changed outside the catalog; using its legacy connector`)
            this.store.rollback(config.serverName)
          }
          continue
        }
        if (!config.enabled || this.hasDisabledTools(config.serverName)) continue
        if (this.foreign(config.serverName, config)) {
          this.warn(`capability-catalog: MCP server "${config.serverName}" is managed elsewhere; the catalog did not replace it`)
          continue
        }
        await this.migrate(config)
      }
      this.changed()
    })
  }

  private hasDisabledTools(name: string): boolean {
    return (this.store.toolsByServer()[name] ?? []).some(tool => !tool.enabled)
  }

  private credentialMoves(config: CatalogMcpServerConfig, allowMissing = false): CredentialMove[] | undefined {
    if (this.credentials === undefined) return undefined
    const refs = new Map<string, McpCredentialKind>()
    for (const [key, value] of config.env ?? []) if (value.includes('secretRef:')) refs.set(`mcp.${config.serverName}.env.${key}`, 'env')
    for (const [key, value] of config.headers ?? []) if (value.includes('secretRef:')) refs.set(`mcp.${config.serverName}.header.${key}`, 'header')
    for (const match of config.url?.matchAll(/secretRef:([A-Za-z0-9_.-]+)/g) ?? []) refs.set(`mcp.${config.serverName}.query.${match[1]}`, 'query')
    const out: CredentialMove[] = []
    for (const [stored, kind] of refs) {
      const value = this.store.credentialValue(stored)
      if (value === undefined && !allowMissing) return undefined
      out.push({ kind, stored, ref: officialCredentialRef(kind, stored), ...(value === undefined ? {} : { value }) })
    }
    return out
  }

  private async moveCredentials(moves: readonly CredentialMove[]): Promise<() => Promise<void>> {
    const previous: { ref: string; value: string | undefined }[] = []
    try {
      for (const move of moves) {
        previous.push({ ref: move.ref, value: (await this.credentials!.resolve(move.ref))?.value })
        if (move.value === undefined) await this.credentials!.unset(move.ref)
        else await this.credentials!.set(move.ref, move.value)
      }
    } catch (error) {
      await this.restoreCredentials(previous)
      throw error
    }
    return () => this.restoreCredentials(previous)
  }

  private async restoreCredentials(previous: readonly { ref: string; value: string | undefined }[]): Promise<void> {
    for (const item of [...previous].reverse()) {
      if (item.value === undefined) await this.credentials!.unset(item.ref)
      else await this.credentials!.set(item.ref, item.value)
    }
  }

  private async migrate(config: CatalogMcpServerConfig): Promise<void> {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(config.serverName)) return
    if (config.transport === 'stdio' && (config.command ?? '') === '') return
    if (config.transport === 'streamable-http' && (config.url ?? '') === '') return
    const moves = this.credentialMoves(config)
    if (moves === undefined) return
    const restore = await this.moveCredentials(moves)
    const name = config.serverName
    try {
      if (this.foreign(name, config)) throw new Error('the manager entry changed before migration')
      const desired = officialMcpEntry(config)
      await this.settings.update('mcp-manager', { servers: { [name]: { ...desired, enabled: false } } })
      const probe = await this.manager.probe(name)
      if (!probe.ok || !probe.closeConfirmed || probe.cleanupError !== undefined) throw new Error(probe.message ?? 'MCP probe cleanup failed')
      this.store.markOfficial(name)
      this.changed()
      if (desired.enabled) await this.settings.update('mcp-manager', { servers: { [name]: desired } })
      this.store.setOfficialTools(name, this.officialTools(probe.toolNames ?? [], name))
    } catch (error) {
      this.warn(`capability-catalog: MCP migration for "${name}" rolled back: ${error instanceof Error ? error.message : String(error)}`)
      if (this.owned(name, config)) {
        try { await this.settings.update('mcp-manager', { servers: { [name]: { ...officialMcpEntry(config), enabled: false } } }) } catch (rollbackError) { this.warn(String(rollbackError)) }
      }
      this.store.rollback(name)
      await restore()
      this.changed()
    }
  }

  private officialTools(rawNames: readonly string[], serverName: string): CatalogMcpTool[] {
    return rawNames.map(name => {
      const publicName = officialPublicToolName(serverName, name)
      const definition = this.tools.schemas().find(tool => tool.name === publicName)
      return { name, description: definition?.description ?? '', ...(definition?.parameters !== undefined ? { parameters: definition.parameters } : {}), enabled: true }
    })
  }

  async refresh(name: string): Promise<readonly CatalogMcpTool[]> {
    if (!this.store.isOfficial(name)) return this.store.toolsByServer()[name] ?? []
    const probe = await this.manager.probe(name)
    if (!probe.ok || !probe.closeConfirmed || probe.cleanupError !== undefined) return this.store.toolsByServer()[name] ?? []
    const status = this.manager.list().find(row => row.name === name)?.status
    if (status?.state === 'failed' && status.reason === 'load' && this.store.list().find(server => server.serverName === name)?.enabled) {
      await this.manager.restart(name)
    }
    const tools = this.officialTools(probe.toolNames ?? [], name)
    this.store.setOfficialTools(name, tools)
    return this.store.toolsByServer()[name] ?? []
  }

  async discover(name: string): Promise<readonly CatalogMcpTool[]> {
    if (!this.store.isOfficial(name)) return this.store.discover(name)
    const config = this.store.list().find(server => server.serverName === name)
    if (config?.enabled && this.owned(name, config)) await this.manager.restart(name)
    return this.refresh(name)
  }

  /** Disable only our entry before returning this server to the legacy bridge. */
  async rollback(name: string): Promise<void> {
    return this.enqueue(() => this.rollbackNow(name))
  }

  private async rollbackNow(name: string): Promise<void> {
    const config = this.store.list().find(server => server.serverName === name)
    if (config !== undefined && this.store.isOfficial(name) && this.owned(name, config)) {
      await this.settings.update('mcp-manager', { servers: { [name]: { ...officialMcpEntry(config), enabled: false } } })
      await this.manager.restart(name)
    }
    this.store.rollback(name)
    this.changed()
  }

  async remove(name: string): Promise<boolean> {
    return this.enqueue(async () => {
      const config = this.store.list().find(server => server.serverName === name)
      if (config === undefined) return false
      if (this.foreign(name, config)) {
        this.warn(`capability-catalog: MCP server "${name}" belongs to another settings owner; its official entry was left unchanged`)
        this.store.remove(name)
        this.changed()
        return true
      }
      if (this.store.isOfficial(name) && this.owned(name, config)) {
        await this.settings.mutate('mcp-manager', [{ op: 'unset', path: ['servers', name] }])
        const moves = this.credentialMoves(config, true) ?? []
        for (const move of moves) await this.credentials!.unset(move.ref)
      }
      this.store.remove(name)
      this.changed()
      return true
    })
  }

  /** Follow manager status updates; tool schemas are read from its registry. */
  async watch(signal: AbortSignal): Promise<void> {
    try {
      for await (const rows of this.manager.watch(signal)) {
        for (const row of rows) {
          if (row.status.state === 'connected' && this.store.isOfficial(row.name)) await this.refresh(row.name)
        }
        this.changed()
      }
    } catch (error) {
      if (!signal.aborted) this.warn(`capability-catalog: MCP manager watch stopped: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
