/**
 * Capability catalog host service: a Typert Remote over the running skill and
 * tool registries. It projects `ctx.skills.snapshot()` into catalog rows,
 * attributes `ctx.tools.schemas()` to a channel (mcp prefix / official
 * whitelist / baseline-diff), loads per-skill detail on demand, writes
 * declared credentials, and adds skills into the managed root. The browser
 * half binds through the generated `capabilityCatalog` Remote namespace.
 *
 * Zero host edits: everything rides existing official services (`ctx.skills`,
 * `ctx.tools`, `ctx.credentials`) through `ctx.get`, degrading silently when a
 * capability is absent.
 * @module @khorsheed/dsh-capability-catalog
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {
  CapabilityCatalogSnapshot,
  CatalogAddSkillRequest,
  CatalogAddSkillResult,
  CatalogCredentialSetRequest,
  CatalogDeleteSkillResult,
  CatalogJsonValue,
  CatalogMcpServerConfig,
  CatalogMcpSnapshot,
  CatalogMcpTool,
  CatalogSkillDetail,
  CatalogSkillFileRead,
  CatalogDirSkillInfo,
} from './types.ts'
import { catalogAddSkill, catalogDetail, catalogListDirSkills, catalogReadSkillFile, catalogSetCredential, catalogSnapshot, catalogDeleteSkill, catalogPickDirectory } from './remote.ts'
import { resolveServices, type RegistrySlice } from './skills.ts'
import { installSkillEnvInjection } from './shellEnv.ts'
import { McpStore } from './mcpStore.ts'
import type { PersistedMcpState } from './mcpStore.ts'
import { reconcileRegisteredMcpTools, desiredMcpTools, type McpToolRegistry } from './mcpTools.ts'
import { maskConfig } from './mcps.ts'
import { installSkillEnvHint } from './envHint.ts'
import { MCP_TOOL_PREFIX } from './channels.ts'
import { CAPABILITY_CATALOG_NS } from './namespace.ts'
import { CapabilityCatalogSettingsSchema } from './settings.ts'

export type {
  CapabilityCatalogSnapshot,
  CatalogJsonValue,
  CatalogSkillRow,
  CatalogToolRow,
  CatalogMcpServerRow,
  CatalogChannelSummary,
  CatalogSkillDetail,
  CatalogSkillFileRead,
  CatalogCredentialState,
  CatalogAddSkillRequest,
  CatalogAddSkillResult,
  CatalogDeleteSkillResult,
  CatalogCredentialSetRequest,
} from './types.ts'

export { resolveSkillNameFromContent } from './import.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    capabilityCatalog: CapabilityCatalogService
  }
}

/** The slice of the tools registry this service reads (optional). */
interface ToolsSlice {
  schemas: (scope?: unknown) => readonly ToolSchemaLike[]
}

interface ToolSchemaLike {
  readonly name: string
  readonly description?: string
  readonly parameters?: CatalogJsonValue
}

/** The optional settings service, used to locate the managed root's dshHome. */
interface DshHomeSlice {
  readonly home?: string
}

/** The remote namespace name (matches the generated remote-client type). */
export const REMOTE_NS = 'capabilityCatalog'

/** Custom inject: subscribe no extra service beyond the two we probe. */
function resolveServicesHelper(ctx: Context): { registry: RegistrySlice | undefined } {
  return resolveServices(ctx)
}

/**
 * Capability catalog Remote service.
 * @module @khorsheed/dsh-capability-catalog
 */
export class CapabilityCatalogService extends TypertRemoteService {
  static inject = []

  private readonly baseline: Set<string>
  private readonly appearedAfterApply: Set<string>
  private readonly mcp: McpStore
  /** The live `ctx.tools` (traceable proxy) captured from the tools inject. */
  private mcpToolsRegistry: McpToolRegistry | undefined
  /** Registered MCP tool disposers, keyed by model-facing public name. */
  private readonly mcpToolDisposers = new Map<string, () => void>()

  constructor(ctx: Context) {
    super(ctx, 'capabilityCatalog')
    this.mcp = new McpStore()
    // Register the settings namespace so the ConfigurablePluginsTab serves
    // our settings.plugin.item card (it dispatches cards only for Host-served
    // namespaces). The card reads its data through the Remote; the namespace
    // ALSO carries the plugin's persisted MCP state (`mcp`) so servers survive a
    // restart: seed the in-process store at boot, persist every mutation, and
    // reload when the config document changes externally. Degrades silently when
    // settings is absent (in-process store only, resets on restart).
    ctx.inject(['settings'], (settingsCtx) => {
      const ns = settingsNamespace(CAPABILITY_CATALOG_NS)
      const scope = settingsCtx.settings.register(ns, CapabilityCatalogSettingsSchema)
      const persisted = (scope.get() as { mcp?: PersistedMcpState } | undefined)?.mcp
      if (persisted !== undefined) this.mcp.loadFrom(persisted)
      this.mcp.onPersist = (): void => {
        void scope.update({ mcp: this.mcp.toPersisted() }).catch((error: unknown) => this.ctx.logger.error(error))
      }
      scope.watch((next) => {
        this.mcp.loadFrom((next as { mcp?: PersistedMcpState } | undefined)?.mcp)
        this.afterMcpMutation()
      })
      // Re-sync after loading persisted state (the tools inject may have fired
      // before the store was seeded).
      this.syncRegisteredMcpTools()
    })
    // Baseline snapshot of the tools visible at apply time; tools that appear
    // later (a tools/change diff) are marked plugin/inferred.
    const tools = ctx.get?.('tools') as ToolsSlice | undefined
    this.baseline = new Set(tools?.schemas().map(t => t.name) ?? [])
    this.appearedAfterApply = new Set()
    ctx.on('tools/change', () => this.markNewTools(tools))
    this.registerListTool()
    // Register discovered MCP tools for the model once tools is composed. The
    // inject keeps the catalog degrading when tools is absent; `toolCtx.tools`
    // is the traceable proxy, so `register` must stay a MEMBER call on it.
    ctx.inject(['tools'], (toolCtx) => {
      this.mcpToolsRegistry = toolCtx.tools as unknown as McpToolRegistry
      this.syncRegisteredMcpTools()
    })
    // Expose each configured skill credential as a trusted per-execution
    // `DSH_<KEY>` env var so the agent's shell can use it (shell expansion),
    // without the raw value entering the model's context (default-hide). The
    // catalog is service-agnostic — it knows nothing about the specific service;
    // the skill tells the agent how to query. Defer to composition time via
    // inject so the env-injection runs once shellEnv/credentials/skills are
    // registered (at the catalog's apply they may not be composed yet).
    ctx.inject(['shellEnv', 'credentials', 'skills'], () => {
      installSkillEnvInjection(ctx, () => this.catalogScope())
    })
    // Runtime companion hint (generic): when the skill tool loads a skill,
    // tell the model the configured credential env mappings so it uses the
    // DSH_<KEY> alias without the skill being modified.
    installSkillEnvHint(ctx, () => this.catalogScope())
  }

  /** Record tools that appeared after the apply-time baseline. */
  private markNewTools(tools: ToolsSlice | undefined): void {
    const current = new Set(tools?.schemas().map(t => t.name) ?? [])
    for (const name of current) {
      if (!this.baseline.has(name)) this.appearedAfterApply.add(name)
    }
  }

  /** The managed skills root under `$DSH_HOME`. */
  private dshHome(): string {
    const settings = this.ctx.get?.('settings') as DshHomeSlice | undefined
    const home = settings?.home
    return home ?? process.env.DSH_HOME ?? join(homedir(), '.dsh-official')
  }

  /**
   * The single standing skill view scope. In the web bundle the host-global
   * skill-filesystem provider is mounted under each agent preset's standing
   * scope, so a host-global snapshot sees only runtime skills. A host reader
   * with no agent (the catalog's settings case) resolves a preset's standing
   * registrations via `agentPresets.standingKeyFor(defaultId)`, which surfaces
   * the official/plugin/user skills the model actually sees. When the presets
   * service is absent the catalog degrades to the global layer alone.
   */
  private async catalogScope(): Promise<unknown | undefined> {
    const agentPresets = this.ctx.get?.('agentPresets') as
      | { defaultId?: string; standingKeyFor?: (id?: string) => Promise<unknown> }
      | undefined
    if (agentPresets?.standingKeyFor === undefined) return undefined
    try {
      return await agentPresets.standingKeyFor(agentPresets.defaultId)
    } catch {
      return undefined
    }
  }

  /** The scope list the snapshot enumerates (the standing key, or global alone). */
  private async catalogScopes(): Promise<readonly unknown[]> {
    const scope = await this.catalogScope()
    return scope === undefined ? [undefined] : [scope]
  }

  /** Register the model-facing `list_capabilities` tool (optional). */
  private registerListTool(): void {
    const tools = this.ctx.get?.('tools') as { register?: (def: ReturnType<typeof defineTool>) => void } | undefined
    if (tools?.register === undefined) return
    tools.register(defineTool({
      name: 'list_capabilities',
      description: 'List the capabilities (skills and tools) registered in this instance and their source channels. Call to discover what is available.',
      parameters: {
        kind: {
          type: 'string',
          enum: ['skill', 'tool'],
          description: 'Optional: filter to skills or tools.',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      // Arrow captures `this` so the tool can read the live registries. It runs
      // in the caller agent's scope (exec.agent), so it sees the model's actual
      // view: official, plugin and user/project skills alike.
      execute: async (args: { kind?: string }, exec?: { agent?: unknown }): Promise<string> => {
        const { registry } = resolveServicesHelper(this.ctx)
        if (registry === undefined) return 'skills service absent in this composition'
        const snapshot = await catalogSnapshot(
          undefined,
          registry,
          await this.toolSchemas(),
          await this.mcpServerNames(),
          this.appearedAfterApply,
          exec?.agent === undefined ? [undefined] : [exec.agent],
        )
        const filter = args?.kind
        const skills = filter === undefined || filter === 'skill' ? snapshot.skills : []
        const toolsRows = filter === undefined || filter === 'tool' ? snapshot.tools : []
        return JSON.stringify({ skills, tools: toolsRows }, null, 2)
      },
    }))
  }

  @Remote('snapshot')
  async snapshot(workdir?: string): Promise<CapabilityCatalogSnapshot> {
    const { registry } = resolveServicesHelper(this.ctx)
    if (registry === undefined) return { skills: [], tools: [], mcpServers: [], channels: [] }
    return catalogSnapshot(
      workdir,
      registry,
      await this.toolSchemas(),
      await this.mcpServerNames(),
      this.appearedAfterApply,
      await this.catalogScopes(),
    )
  }

  @Remote('detail')
  async detail(name: string, workdir?: string): Promise<CatalogSkillDetail | undefined> {
    const { registry } = resolveServicesHelper(this.ctx)
    if (registry === undefined) return undefined
    return catalogDetail(this.ctx, registry, name, workdir, await this.catalogScope())
  }

  @Remote('readSkillFile')
  async readSkillFile(name: string, filePath: string, workdir?: string): Promise<CatalogSkillFileRead | undefined> {
    const { registry } = resolveServicesHelper(this.ctx)
    if (registry === undefined) return undefined
    return catalogReadSkillFile(registry, name, filePath, workdir, await this.catalogScope())
  }

  @Remote('listDirSkills')
  async listDirSkills(dirPath: string): Promise<readonly CatalogDirSkillInfo[]> {
    return catalogListDirSkills(dirPath)
  }

  @Remote('setCredential')
  async setCredential(request: CatalogCredentialSetRequest): Promise<boolean> {
    return catalogSetCredential(this.ctx, request)
  }

  @Remote('addSkill')
  async addSkill(request: CatalogAddSkillRequest): Promise<CatalogAddSkillResult> {
    return catalogAddSkill(this.ctx, request, this.dshHome())
  }

  @Remote('deleteSkill')
  async deleteSkill(name: string, workdir?: string): Promise<CatalogDeleteSkillResult> {
    const { registry } = resolveServicesHelper(this.ctx)
    if (registry === undefined) return { ok: false, error: 'skills service absent in this composition' }
    return catalogDeleteSkill(registry, name, workdir, await this.catalogScope())
  }

  @Remote('pickDirectory')
  async pickDirectory(): Promise<string | null> {
    return catalogPickDirectory(this.ctx)
  }

  @Remote('mcpList')
  async mcpList(): Promise<readonly CatalogMcpServerConfig[]> {
    // Masked DTO: never surface secretRef markers (or the secret key names) to the browser.
    return this.mcp.list().map(maskConfig)
  }

  @Remote('mcpAdd')
  async mcpAdd(config: CatalogMcpServerConfig): Promise<boolean> {
    if (config.serverName.trim() === '') return false
    this.mcp.add(config)
    this.afterMcpMutation()
    return true
  }

  @Remote('mcpRemove')
  async mcpRemove(serverName: string): Promise<boolean> {
    this.mcp.remove(serverName)
    this.afterMcpMutation()
    return true
  }

  @Remote('mcpSetEnabled')
  async mcpSetEnabled(serverName: string, enabled: boolean): Promise<void> {
    this.mcp.setEnabled(serverName, enabled)
    this.afterMcpMutation()
  }

  @Remote('mcpSetCredential')
  async mcpSetCredential(ref: string, value: string): Promise<boolean> {
    this.mcp.setCredential(ref, value)
    return true
  }

  @Remote('mcpSetToolEnabled')
  async mcpSetToolEnabled(serverName: string, tool: string, enabled: boolean): Promise<void> {
    this.mcp.setToolEnabled(serverName, tool, enabled)
    this.afterMcpMutation()
  }

  @Remote('mcpDiscover')
  async mcpDiscover(serverName: string): Promise<readonly CatalogMcpTool[]> {
    const tools = await this.mcp.discover(serverName)
    this.afterMcpMutation()
    return tools
  }

  @Remote('mcpSnapshot')
  async mcpSnapshot(): Promise<CatalogMcpSnapshot> {
    return {
      servers: this.mcp.list().map(maskConfig),
      tools: this.mcp.toolsByServer(),
      credentials: this.mcp.credentials(),
    }
  }

  /** The visible tool schemas in the standing scope (the set the model sees),
   * or the global layer when no preset standing key resolves. Skills already
   * enumerate through `catalogScopes()`; tools must use the same scope so the
   * settings reader sees the official/plugin/MCP tools the model actually has. */
  private async toolSchemas(): Promise<readonly ToolSchemaLike[]> {
    const tools = this.ctx.get?.('tools') as ToolsSlice | undefined
    if (tools?.schemas === undefined) return []
    const scope = await this.catalogScope()
    return scope === undefined ? tools.schemas() : tools.schemas(scope)
  }

  /** MCP server names from live `mcp__`-prefixed tools (prefix-derived baseline). */
  private async mcpServerNames(): Promise<string[]> {
    const names: string[] = []
    for (const schema of await this.toolSchemas()) {
      if (!schema.name.startsWith(MCP_TOOL_PREFIX)) continue
      const rest = schema.name.slice(MCP_TOOL_PREFIX.length)
      const sep = rest.indexOf('__')
      const server = sep > 0 ? rest.slice(0, sep) : rest
      if (server.length > 0 && !names.includes(server)) names.push(server)
    }
    return names
  }

  /**
   * Reconcile which discovered MCP tools are registered on `ctx.tools` so the
   * model can call them. `mcpToolsRegistry` is the traceable `ctx.tools` proxy,
   * so `register` is always invoked as a MEMBER call (`reconcile` calls
   * `registry.register(...)`) — extracting it to a standalone variable loses the
   * `this.ctx` binding and breaks the disposal effect.
   */
  private syncRegisteredMcpTools(): void {
    const registry = this.mcpToolsRegistry
    if (registry === undefined) return
    const desired = desiredMcpTools(this.mcp.list(), this.mcp.toolsByServer())
    reconcileRegisteredMcpTools(desired, {
      register: (definition) => registry.register(definition),
      onRegisterError: (error) => this.ctx.logger.error(`capability-catalog: MCP tool registration failed: ${String(error)}`),
    }, this.mcpToolDisposers, (serverName, rawName, args) => this.mcp.callTool(serverName, rawName, args))
  }

  /** Re-sync registered MCP tools after any MCP store mutation. */
  private afterMcpMutation(): void {
    this.syncRegisteredMcpTools()
  }
}

export default CapabilityCatalogService
