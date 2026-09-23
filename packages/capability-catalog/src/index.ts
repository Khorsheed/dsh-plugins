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
// Type-only: pulls the ctx.settings service merge.
import type {} from '@deepseek-ai/dsh-settings'
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
  CatalogModeFace,
  CatalogSkillDetail,
  CatalogSkillFileRead,
  CatalogDirSkillInfo,
  CatalogPresetScopeStatus,
  CatalogPresetOption,
  CatalogPresetScopeSetRequest,
  CatalogPresetScopeAdoptRequest,
  CatalogPresetScopeEditResult,
} from './types.ts'
import { catalogAddSkill, catalogDetail, catalogListDirSkills, catalogReadSkillFile, catalogSetCredential, catalogSnapshot, catalogDeleteSkill, catalogPickDirectory } from './remote.ts'
import { resolveServices, type RegistrySlice, type SkillDefinitionLike } from './skills.ts'
import {
  definitionFor, scanManagedSkills, ScopedSkillDelivery, scopedSkillsRoot, type ScopedDeliveryRegistry,
} from './scoped-delivery.ts'
import {
  adoptManagedSkill, releaseManagedSkill, setManagedPresetScope,
} from './scoped-edits.ts'
import { installSkillEnvInjection } from './shellEnv.ts'
import { McpStore } from './mcpStore.ts'
import type { PersistedMcpState } from './mcpStore.ts'
import { reconcileRegisteredMcpTools, desiredMcpTools, type McpToolRegistry } from './mcpTools.ts'
import { maskConfig } from './mcps.ts'
import { installSkillEnvHint } from './envHint.ts'
import { MCP_TOOL_PREFIX } from './channels.ts'
import { toolOrigin, isValidOrigin, type ToolOrigin } from './tool-origin.ts'
import { CAPABILITY_CATALOG_NS } from './namespace.ts'
import { CapabilityCatalogSettingsSchema } from './settings.ts'
import { capsTag, hashOf } from './capabilities.ts'
import { resolvePresetScope, type PresetRosterRow, type PresetRosterSlice } from './preset-scope.ts'
import { modeOptions, readModeFaces } from './modes.ts'

// Community tool-origin convention: re-export the tag helpers so any plugin can
// `import { setToolOrigin } from '@khorsheed/dsh-capability-catalog'`.
export { TOOL_ORIGIN, setToolOrigin, toolOrigin } from './tool-origin.ts'
export type { ToolOrigin } from './tool-origin.ts'

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
  CatalogPresetScopeStatus,
  CatalogScopedSkillRow,
  CatalogScopedPresetRow,
  CatalogPresetOption,
  CatalogModeFace,
  CatalogPresetScopeSetRequest,
  CatalogPresetScopeAdoptRequest,
  CatalogPresetScopeEditResult,
} from './types.ts'

export { resolveSkillNameFromContent } from './import.ts'
export { resolvePresetScope } from './preset-scope.ts'
export type { PresetRosterSlice, PresetRosterRow, ResolvedPresetScope } from './preset-scope.ts'
// The mode view: the roster a picker offers and one face per mode.
export { modeOptions, readModeFaces } from './modes.ts'
export {
  ScopedSkillDelivery, scopedSkillsRoot, scanManagedSkills, managedSkillFrom,
  parsePresetScopeFrontmatter, defaultSkillRoots, detectConflicts,
  SCOPED_PROVIDER_NAME, MANAGED_SKILL_RANK,
} from './scoped-delivery.ts'
export {
  adoptManagedSkill, releaseManagedSkill, setManagedPresetScope, withPresetScope,
  findSkillSource, managedLocation, isDirectory,
} from './scoped-edits.ts'
export type { ScopedEditResult, SkillSource, ManagedSkillLocation } from './scoped-edits.ts'
export type {
  ManagedSkill, ScopedDeliveryDeps, ScopedDeliveryRegistry,
  ScopedDeliveryStatus, ScopedPresetStatus, ScopedSkillStatus,
} from './scoped-delivery.ts'

// The capability fingerprint: the canonical form, its digest, and the tag.
// Exported from the package root so a host reader can hash a snapshot it
// already holds without a second Remote round-trip.
export {
  canonicalCapabilities, canonicalJson, capsTag, hashOf, hashSkillBody, CAPS_TAG_PREFIX,
} from './capabilities.ts'
export type {
  CanonicalCapabilities, CanonicalMcpServer, CanonicalSkill, CanonicalTool,
} from './capabilities.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    capabilityCatalog: CapabilityCatalogService
  }
}

/** The slice of the tools registry this service reads (optional). */
interface ToolsSlice {
  schemas: (scope?: unknown) => readonly ToolSchemaLike[]
  get?: (name: string, scope?: unknown) => object | undefined
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
  static Config = CapabilityCatalogSettingsSchema

  private baseline: Set<string>
  private readonly appearedAfterApply: Set<string>
  private readonly mcp: McpStore
  /** The live `ctx.tools` (traceable proxy) captured from the tools inject. */
  private mcpToolsRegistry: McpToolRegistry | undefined
  /** Registered MCP tool disposers, keyed by model-facing public name. */
  private readonly mcpToolDisposers = new Map<string, () => void>()
  /** Preset-scoped delivery of the plugin's own managed skill root. */
  private scoped: ScopedSkillDelivery | undefined
  /** The workspace the catalog was last asked about, for project-root conflict checks. */
  private observedWorkdir: string | undefined

  constructor(ctx: Context, public config: { mcp?: unknown }) {
    super(ctx, 'capabilityCatalog')
    this.mcp = new McpStore()
    this.baseline = new Set()
    this.appearedAfterApply = new Set()
    // Persist the MCP state so servers survive a restart: seed the in-process
    // store at boot, persist every mutation, and reload when the config
    // document changes externally. Two host lines, one outcome: 0.1.5 serves a
    // free-form `settings.register` namespace (whose scope.watch round-trips
    // both our own and external writes); 0.1.7 persists the plugin Config's
    // volatile `mcp` field through SettingsForms (writes ride the profile
    // patch, the running fiber's Volatile reference tracks them, and
    // `settings/document-updated` is the round-trip channel). The card reads
    // its data through the Remote on both lines. Degrades silently when
    // settings is absent (in-process store only, resets on restart).
    ctx.inject(['settings'], (settingsCtx) => {
      const svc = settingsCtx.settings as unknown as {
        register?: (ns: string, schema: unknown) => {
          get(): unknown
          update(patch: Record<string, unknown>): Promise<void>
          watch(listener: (next: unknown) => void): void
        }
        update?: (ns: string, patch: Record<string, unknown>) => Promise<void>
        configure?: (presentation: { auto?: boolean }, owner?: unknown) => () => void
      }
      if (typeof svc.register === 'function') {
        const scope = svc.register(CAPABILITY_CATALOG_NS, CapabilityCatalogSettingsSchema)
        const persisted = (scope.get() as { mcp?: PersistedMcpState } | undefined)?.mcp
        if (persisted !== undefined) this.mcp.loadFrom(persisted)
        this.mcp.onPersist = (): void => {
          void scope.update({ mcp: this.mcp.toPersisted() }).catch((error: unknown) => this.ctx.logger.error(error))
        }
        scope.watch((next) => {
          this.mcp.loadFrom((next as { mcp?: PersistedMcpState } | undefined)?.mcp)
          this.afterMcpMutation()
        })
      } else if (typeof svc.update === 'function') {
        // The catalog ships its own card; keep the machine-state block out of
        // any auto-generated form.
        svc.configure?.({ auto: false }, ctx.fiber)
        const readVolatile = (): PersistedMcpState | undefined => {
          const field = this.config.mcp as { get?: () => PersistedMcpState | undefined } | PersistedMcpState | undefined
          if (field !== null && typeof field === 'object' && typeof (field as { get?: unknown }).get === 'function') {
            return (field as { get: () => PersistedMcpState | undefined }).get()
          }
          return field as PersistedMcpState | undefined
        }
        const persisted = readVolatile()
        if (persisted !== undefined) this.mcp.loadFrom(persisted)
        this.mcp.onPersist = (): void => {
          void svc.update!(CAPABILITY_CATALOG_NS, { mcp: this.mcp.toPersisted() }).catch((error: unknown) => this.ctx.logger.error(error))
        }
        settingsCtx.on('settings/document-updated', (ns) => {
          if (ns !== CAPABILITY_CATALOG_NS) return
          this.mcp.loadFrom(readVolatile())
          this.afterMcpMutation()
        })
      }
      // Re-sync after loading persisted state (the tools inject may have fired
      // before the store was seeded).
      this.syncRegisteredMcpTools()
      // The persisted block stores only tool names + toggles (descriptions and
      // parameter schemas would bloat settings.yaml and go stale), so refill
      // them by re-connecting the enabled servers at boot, async so boot is not
      // blocked. Re-syncs registration once the descriptions are back.
      void this.reconnectEnabledMcp()
    })
    // Baseline snapshot of the tools visible once the registry is ready; tools
    // that appear later (a tools/change diff) are marked plugin/inferred. Set it
    // inside the DEFERRED tools inject — an apply-time ctx.get probe races the
    // registry's own mount order and can lose on the real composition tree (tools
    // may compose after the catalog), yielding an empty baseline and mislabeling
    // every visible tool as post-apply/plugin.
    ctx.inject(['tools'], (toolCtx) => {
      this.mcpToolsRegistry = toolCtx.tools as unknown as McpToolRegistry
      this.syncRegisteredMcpTools()
      this.registerListTool(toolCtx.tools as { register?: (def: ReturnType<typeof defineTool>) => void })
      // Baseline for the channel heuristics (set where the registry is known).
      this.baseline = new Set(toolCtx.tools.schemas().map(t => t.name) ?? [])
      this.appearedAfterApply.clear()
      ctx.on('tools/change', () => this.markNewTools())
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
    // Preset-scoped delivery: the plugin's own managed root holds skills whose
    // frontmatter names the presets they belong to, and each of those presets
    // gets a provider registered into ITS scope layer. Deferred via inject so
    // the registry is present, and owned by an effect so the delivery scopes
    // (and the filesystem watcher) unwind with the plugin.
    ctx.inject(['skills'], (skillsCtx) => {
      const delivery = new ScopedSkillDelivery(skillsCtx, {
        dshHome: () => this.dshHome(),
        roster: () => this.agentPresets(),
        registry: () => this.ctx.get?.('skills') as ScopedDeliveryRegistry | undefined,
        workdir: () => this.observedWorkdir,
        log: (message) => this.ctx.logger.warn(message),
      })
      this.scoped = delivery
      skillsCtx.effect(() => {
        void delivery.start().catch((error: unknown) => {
          this.ctx.logger.warn(`capability-catalog: preset-scoped delivery failed to start: ${error instanceof Error ? error.message : String(error)}`)
        })
        return () => { void delivery.dispose() }
      }, 'capability-catalog: preset-scoped skills')
    })
  }

  /** The preset-scoped delivery's current state, for the settings surface. */
  @Remote('presetScopeStatus')
  async presetScopeStatus(): Promise<CatalogPresetScopeStatus> {
    const status = this.scoped?.status()
    return status === undefined
      ? {
          enabled: false,
          reason: 'preset-scoped delivery is not composed',
          root: scopedSkillsRoot(this.dshHome()),
          watching: false,
          skills: [],
          presets: [],
          customRootsUnverifiable: true,
        }
      : status
  }

  /** Every preset the roster supplies, for the scope picker. */
  @Remote('presetScopeRoster')
  async presetScopeRoster(): Promise<readonly CatalogPresetOption[]> {
    return modeOptions(await this.rosterRows(), this.agentPresets()?.defaultId)
  }

  /**
   * Every mode's capability face in ONE call, for the cross-mode comparison
   * view ("which modes load this tool/skill?").
   *
   * This is the expensive verb of the pair: a mode whose standing scope has not
   * been composed yet is MOUNTED by its read (see modes.ts — there is no cheap
   * honest source, because a composition file names plugins, not the tools and
   * skills those plugins register). The browser therefore calls it only when a
   * human chooses to compare modes, never on opening the section.
   *
   * A mode that cannot be read keeps its row with `unavailable` set rather than
   * an empty face, so the comparison never claims that a broken mode loads
   * nothing. `preset` on a face is always the id that was asked for: a read
   * that silently degraded to the global layer is reported as unavailable, not
   * as that mode's face.
   * @param workdir - optional cwd for project-scoped skill roots.
   */
  @Remote('modeFaces')
  async modeFaces(workdir?: string): Promise<readonly CatalogModeFace[]> {
    const options = modeOptions(await this.rosterRows(), this.agentPresets()?.defaultId)
    return readModeFaces(options, async (id) => {
      try {
        const face = await this.collect(id, workdir, false)
        if (face.preset !== id) {
          this.ctx.logger.warn(`capability-catalog: preset "${id}" resolved no standing scope — its mode face reads as unavailable`)
          return undefined
        }
        return face
      } catch (error) {
        this.ctx.logger.warn(`capability-catalog: mode face read for preset "${id}" failed: ${error instanceof Error ? error.message : String(error)}`)
        return undefined
      }
    })
  }

  /** The roster rows, or [] when this composition mounts no agent-preset service. */
  private async rosterRows(): Promise<readonly PresetRosterRow[]> {
    const roster = this.agentPresets()
    if (roster?.list === undefined) return []
    try {
      return await roster.list()
    } catch (error) {
      this.ctx.logger.warn(`capability-catalog: the preset roster could not be listed: ${error instanceof Error ? error.message : String(error)}`)
      return []
    }
  }

  /** Declare which presets one managed skill is delivered to. */
  @Remote('presetScopeSet')
  async presetScopeSet(request: CatalogPresetScopeSetRequest): Promise<CatalogPresetScopeEditResult> {
    const result = await setManagedPresetScope(this.dshHome(), request.name, request.presets)
    await this.reconcileScoped()
    return result
  }

  /** Move an installed skill into the managed root with a preset scope. */
  @Remote('presetScopeAdopt')
  async presetScopeAdopt(request: CatalogPresetScopeAdoptRequest): Promise<CatalogPresetScopeEditResult> {
    const result = await adoptManagedSkill(
      this.dshHome(), request.name, request.presets, request.workdir ?? this.observedWorkdir,
    )
    await this.reconcileScoped()
    return result
  }

  /** Move a managed skill back to the user skill root (the recovery direction). */
  @Remote('presetScopeRelease')
  async presetScopeRelease(name: string): Promise<CatalogPresetScopeEditResult> {
    const result = await releaseManagedSkill(this.dshHome(), name)
    await this.reconcileScoped()
    return result
  }

  /** Re-deliver after a write; a delivery that is absent is not an error. */
  private async reconcileScoped(): Promise<void> {
    try {
      await this.scoped?.reconcile()
    } catch (error) {
      this.ctx.logger.warn(`capability-catalog: scoped skill reconcile failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** Record tools that appeared after the apply-time baseline (reads the live
   * registry each time, so a change event never sees a stale/undefined ref). */
  private markNewTools(): void {
    const tools = this.ctx.get?.('tools') as ToolsSlice | undefined
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
   * The standing skill view scope of ONE preset. In the web bundle the
   * host-global skill-filesystem provider is mounted under each agent
   * preset's standing scope, so a host-global snapshot sees only runtime
   * skills; reading at the preset's scope surfaces the official/plugin/user
   * skills the model actually sees. When the presets service is absent the
   * catalog degrades to the global layer alone.
   *
   * `presetId` names WHICH preset — the deployment default when omitted, the
   * way every reader before `snapshotFor` behaved. The roster's own
   * `standingKeyFor` has always taken an id; the catalog simply never passed
   * one, so "the capability face of preset X" was unaskable and a condition
   * declaring `preset: X` could only be believed.
   *
   * `strict` is the listing/fingerprint split — see
   * {@link resolvePresetScope}, which owns the policy.
   * @param presetId - the preset to read, or undefined for the default.
   * @param strict - throw instead of degrading when the roster cannot answer.
   */
  private async catalogScope(presetId?: string, strict = false): Promise<unknown | undefined> {
    return (await resolvePresetScope(this.agentPresets(), presetId, strict)).scope
  }

  /** The optional agent-preset roster (absent in a rosterless composition). */
  private agentPresets(): PresetRosterSlice | undefined {
    return this.ctx.get?.('agentPresets') as PresetRosterSlice | undefined
  }

  /** Register the model-facing `list_capabilities` tool (optional; called from the
   * tools inject so the registry is guaranteed present). */
  private registerListTool(tools: { register?: (def: ReturnType<typeof defineTool>) => void }): void {
    if (tools.register === undefined) return
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
        // The FULL face is fingerprinted even when the answer is filtered:
        // `sha` names the instance's capabilities, so it must not change with
        // what the caller asked to see.
        const scope = exec?.agent ?? await this.catalogScope()
        const snapshot = await catalogSnapshot(
          undefined,
          registry,
          this.toolSchemasIn(scope),
          this.mcpServerNamesIn(scope),
          this.appearedAfterApply,
          [scope],
          this.toolOriginsMap(scope),
          { fingerprint: true },
        )
        const filter = args?.kind
        const skills = filter === undefined || filter === 'skill' ? snapshot.skills : []
        const toolsRows = filter === undefined || filter === 'tool' ? snapshot.tools : []
        return JSON.stringify({ capabilities: capsTag(snapshot.sha as string), skills, tools: toolsRows }, null, 2)
      },
    }))
  }

  @Remote('snapshot')
  async snapshot(workdir?: string): Promise<CapabilityCatalogSnapshot> {
    return this.collect(undefined, workdir, false)
  }

  /**
   * The capability face of ONE mode as a LISTING — {@link snapshot} scoped to a
   * named preset, for the settings surface's mode picker.
   *
   * The LISTING/FINGERPRINT split matters here the way it does everywhere else:
   * a viewer wants rows as fast as the registries can produce them, not every
   * skill body loaded and digested. Asking for a preset's IDENTITY is
   * {@link snapshotFor}. Like every scope resolution, this MOUNTS a preset
   * nothing has composed yet.
   *
   * Degrades like {@link snapshot}: a preset whose standing scope refuses
   * answers with the global layer and NO `preset` stamp, which is how a caller
   * tells "this mode" from "the fallback" and says so.
   * @param presetId - the mode to read, or undefined for the deployment default.
   * @param workdir - optional cwd for project-scoped skill roots.
   */
  @Remote('snapshotAt')
  async snapshotAt(presetId?: string, workdir?: string): Promise<CapabilityCatalogSnapshot> {
    return this.collect(presetId, workdir, false)
  }

  /**
   * The capability face of ONE preset, with its {@link hashOf} digest.
   *
   * This is the fingerprint verb: every skill body is loaded (so the rows
   * carry `bodySha`) and `sha` is stamped, which is what makes the answer an
   * identity rather than a listing. `presetId` omitted reads the deployment
   * default — the same face `snapshot` reads, now hashable.
   *
   * Degrades like every other verb: without a skills registry the answer is
   * an empty face with the hash of an empty face, not a throw. Note that a
   * preset nobody has composed yet is MOUNTED by the read (the roster's
   * single-flight standing mount), so asking is not free.
   * @param presetId - the preset to fingerprint, or undefined for the default.
   * @param workdir - optional cwd for project-scoped skill roots.
   */
  @Remote('snapshotFor')
  async snapshotFor(presetId?: string, workdir?: string): Promise<CapabilityCatalogSnapshot> {
    return this.collect(presetId, workdir, true)
  }

  /**
   * Shared body of {@link snapshot} and {@link snapshotFor}. The scope is
   * resolved ONCE — three resolutions of a mounting preset would race the
   * roster's single-flight for no reason — and `fingerprint` makes the
   * resolution strict.
   */
  private async collect(presetId: string | undefined, workdir: string | undefined, fingerprint: boolean): Promise<CapabilityCatalogSnapshot> {
    const { registry } = resolveServicesHelper(this.ctx)
    if (workdir !== undefined && workdir !== '') this.observedWorkdir = workdir
    const { scope, preset } = await resolvePresetScope(this.agentPresets(), presetId, fingerprint)
    if (registry === undefined) {
      const empty: CapabilityCatalogSnapshot = {
        skills: [], tools: [], mcpServers: [], channels: [],
        ...preset !== undefined ? { preset } : {},
      }
      return fingerprint ? { ...empty, sha: hashOf(empty) } : empty
    }
    return catalogSnapshot(
      workdir,
      registry,
      this.toolSchemasIn(scope),
      this.mcpServerNamesIn(scope),
      this.appearedAfterApply,
      [scope],
      this.toolOriginsMap(scope),
      { fingerprint, ...preset !== undefined ? { preset } : {} },
    )
  }

  @Remote('detail')
  async detail(name: string, workdir?: string, presetId?: string): Promise<CatalogSkillDetail | undefined> {
    const { registry } = resolveServicesHelper(this.ctx)
    if (registry === undefined) return undefined
    // A managed skill scoped to another preset is absent from the default
    // preset's scope; the plugin's own copy keeps it visible and editable here.
    // `presetId` carries the mode the viewer is LOOKING AT, so a card opened in
    // mode X reads mode X's body rather than the default mode's.
    return catalogDetail(this.ctx, registry, name, workdir, await this.catalogScope(presetId), await this.managedDefinition(name))
  }

  @Remote('readSkillFile')
  async readSkillFile(name: string, filePath: string, workdir?: string, presetId?: string): Promise<CatalogSkillFileRead | undefined> {
    const { registry } = resolveServicesHelper(this.ctx)
    if (registry === undefined) return undefined
    return catalogReadSkillFile(registry, name, filePath, workdir, await this.catalogScope(presetId), await this.managedDefinition(name))
  }

  /** One managed skill's definition, for management reads outside its scope. */
  private async managedDefinition(name: string): Promise<SkillDefinitionLike | undefined> {
    const skill = (await scanManagedSkills(scopedSkillsRoot(this.dshHome()))).find(entry => entry.name === name)
    return skill === undefined ? undefined : definitionFor(skill)
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
  async deleteSkill(name: string, workdir?: string, presetId?: string): Promise<CatalogDeleteSkillResult> {
    const { registry } = resolveServicesHelper(this.ctx)
    if (registry === undefined) return { ok: false, error: 'skills service absent in this composition' }
    return catalogDeleteSkill(registry, name, workdir, await this.catalogScope(presetId))
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
   * enumerate through the same scope; tools must use it too so the
   * settings reader sees the official/plugin/MCP tools the model actually has. */
  private toolSchemasIn(scope: unknown): readonly ToolSchemaLike[] {
    const tools = this.ctx.get?.('tools') as ToolsSlice | undefined
    if (tools?.schemas === undefined) return []
    return scope === undefined ? tools.schemas() : tools.schemas(scope)
  }

  /** tool name → author-declared origin, read via `ctx.tools.get(name)` so the
   * `Symbol.for('dsh.tool.origin')` tag on the retained definition survives (the
   * system-prompt assembly strips it, but `get()` returns the full definition). */
  private toolOriginsMap(scope: unknown): ReadonlyMap<string, ToolOrigin> {
    const tools = this.ctx.get?.('tools') as ToolsSlice | undefined
    if (tools?.get === undefined) return new Map()
    const schemas = scope === undefined ? tools.schemas() : tools.schemas(scope)
    const out = new Map<string, ToolOrigin>()
    for (const schema of schemas) {
      const def = scope === undefined ? tools.get(schema.name) : tools.get(schema.name, scope)
      if (def === undefined) {
        // `schemas()` and `get()` disagree for this scope — the author's origin
        // tag (if any) cannot be read, so the tool falls back to heuristics.
        this.ctx.logger.warn(`capability-catalog: tool "${schema.name}" is visible but ctx.tools.get() is undefined in this scope — its origin tag cannot be read; it will be classified by heuristics`)
        continue
      }
      const origin = toolOrigin(def)
      if (origin !== undefined) {
        if (!isValidOrigin(origin)) {
          this.ctx.logger.warn(`capability-catalog: tool "${schema.name}" origin channel "${String(origin.channel)}" is not a known channel (plugin/builtin/mcp) — ignoring the tag, falling back to heuristics`)
          continue
        }
        out.set(schema.name, origin)
      }
    }
    return out
  }

  /** MCP server names from live `mcp__`-prefixed tools (prefix-derived baseline). */
  private mcpServerNamesIn(scope: unknown): string[] {
    const names: string[] = []
    for (const schema of this.toolSchemasIn(scope)) {
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

  /** Refill the persisted MCP tools' descriptions/parameters by re-connecting the
   * enabled servers at boot (the persisted `mcp` block stores only name+enabled to
   * keep settings.yaml small). Async: boot is not blocked; each server's errors are
   * contained, and registration is re-synced once the descriptions are back. */
  private async reconnectEnabledMcp(): Promise<void> {
    const enabled = this.mcp.list().filter(s => s.enabled)
    if (enabled.length === 0) return
    for (const server of enabled) {
      try {
        await this.mcp.discover(server.serverName)
      } catch (error) {
        this.ctx.logger.error(`capability-catalog: reconnect ${server.serverName} failed: ${String(error)}`)
      }
    }
    this.syncRegisteredMcpTools()
  }
}

export default CapabilityCatalogService
