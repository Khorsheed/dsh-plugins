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
  CatalogSkillDetail,
  CatalogSkillFileRead,
  CatalogDirSkillInfo,
} from './types.ts'
import { catalogAddSkill, catalogDetail, catalogListDirSkills, catalogReadSkillFile, catalogSetCredential, catalogSnapshot } from './remote.ts'
import { resolveServices, type RegistrySlice } from './skills.ts'
import { MCP_TOOL_PREFIX } from './channels.ts'
import { CAPABILITY_CATALOG_NS } from './namespace.ts'
import { CapabilityCatalogSettingsSchema } from './settings.ts'

export type {
  CapabilityCatalogSnapshot,
  CatalogSkillRow,
  CatalogToolRow,
  CatalogMcpServerRow,
  CatalogChannelSummary,
  CatalogSkillDetail,
  CatalogSkillFileRead,
  CatalogCredentialState,
  CatalogAddSkillRequest,
  CatalogAddSkillResult,
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

  constructor(ctx: Context) {
    super(ctx, 'capabilityCatalog')
    // Register the settings namespace so the ConfigurablePluginsTab serves
    // our settings.plugin.item card (it dispatches cards only for Host-served
    // namespaces). The card reads its data through the Remote, so the schema
    // is a minimal placeholder. Degrades silently when settings is absent.
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.settings.register(settingsNamespace(CAPABILITY_CATALOG_NS), CapabilityCatalogSettingsSchema)
    })
    // Baseline snapshot of the tools visible at apply time; tools that appear
    // later (a tools/change diff) are marked plugin/inferred.
    const tools = ctx.get?.('tools') as ToolsSlice | undefined
    this.baseline = new Set(tools?.schemas().map(t => t.name) ?? [])
    this.appearedAfterApply = new Set()
    ctx.on('tools/change', () => this.markNewTools(tools))
    this.registerListTool()
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
        const toolsSlice = this.ctx.get?.('tools') as ToolsSlice | undefined
        const snapshot = await catalogSnapshot(
          undefined,
          registry,
          toolsSlice?.schemas() ?? [],
          this.mcpServerNames(),
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
    const tools = this.ctx.get?.('tools') as ToolsSlice | undefined
    return catalogSnapshot(
      workdir,
      registry,
      tools?.schemas() ?? [],
      this.mcpServerNames(),
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

  /** MCP server names from live `mcp__`-prefixed tools (prefix-derived baseline). */
  private mcpServerNames(): string[] {
    const tools = this.ctx.get?.('tools') as ToolsSlice | undefined
    const names: string[] = []
    for (const schema of tools?.schemas() ?? []) {
      if (!schema.name.startsWith(MCP_TOOL_PREFIX)) continue
      const rest = schema.name.slice(MCP_TOOL_PREFIX.length)
      const sep = rest.indexOf('__')
      const server = sep > 0 ? rest.slice(0, sep) : rest
      if (server.length > 0 && !names.includes(server)) names.push(server)
    }
    return names
  }
}

export default CapabilityCatalogService
