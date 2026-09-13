/**
 * Preset-scoped skill delivery: a plugin-owned skills root whose entries are
 * delivered **into one preset's scope layer** instead of into the global layer.
 *
 * The skill registry is layered by the scope a registration is made from, and a
 * read merges the global layer with the viewing agent's scope chain. A provider
 * registered through a context scoped to a preset's standing key is therefore
 * consulted only for sessions on that preset — no read-time identity guessing,
 * and no dependence on the borrowed lookup options.
 *
 * The per-skill policy lives in the skill's own frontmatter
 * (`metadata.presetScope: [<preset-id>, …]`); an absent or empty list means the
 * entry is not delivered by this module at all. A managed name that ALSO exists
 * in a default skill root is refused delivery and reported: a leftover copy is
 * served by the host provider in every preset, so silently delivering a second
 * candidate would make the scope a lie.
 *
 * Scope of enforcement: this is a discovery/delivery policy for one Harness
 * instance, not an authorization boundary. `ScopeKey` values are ordinary
 * objects and the roster hands real ones to any caller, so a same-process plugin
 * can claim membership. In-process agents and children joining the parent's
 * composition are covered; native codex/claude-code and ACP backends start their
 * own runtime and never consult this registry at all.
 * @module @khorsheed/dsh-capability-catalog/scoped-delivery
 */

import { existsSync } from 'node:fs'
import { watch, type FSWatcher } from 'node:fs'
import { mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { createScope, type Scope, type ScopeKey } from '@deepseek-ai/dsh-scope'
import { livePresetMounts } from '@deepseek-ai/dsh-agent-presets'
// Type-only: the ctx.skills service merge and the provider contract this module
// implements. The skill registry is an optional peer; a runtime import would
// make the catalog fail to boot without it.
import type { SkillCandidate, SkillDefinition, SkillProvider, SkillProviderControl } from '@deepseek-ai/dsh-skill'
// Type-only: the ctx.agentPresets service merge and the `agent-preset/selected`
// event declaration (the roster itself is a real dependency).
import type {} from '@deepseek-ai/dsh-agent-presets'
import type { PresetRosterSlice } from './preset-scope.ts'

/** Provider label for managed entries; also the candidate's `provider` field. */
export const SCOPED_PROVIDER_NAME = 'capability-catalog'

/** Candidate rank, beside the filesystem provider's `custom` roots. */
export const MANAGED_SKILL_RANK = 300

/** Directory under the harness home that holds preset-scoped skills. */
export const SCOPED_SKILLS_DIR = join('capability-catalog', 'skills')

/** Debounce for filesystem-triggered rescans. */
const RESCAN_DEBOUNCE_MS = 150

/** Frontmatter block, then the body it precedes. */
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

/** Kebab-case skill / preset id grammar (the registry's own). */
const KEBAB_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** One managed skill read from the plugin-owned root. */
export interface ManagedSkill {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
  /** Preset ids this skill is delivered to; absent/empty means "not scoped". */
  readonly presetScope: readonly string[] | undefined
  /** The skill's own directory (its `resourceBase`). */
  readonly dir: string
  /** Absolute `SKILL.md` path. */
  readonly path: string
  readonly content: string
}

/** The managed root for one harness home. */
export function scopedSkillsRoot(dshHome: string): string {
  return join(dshHome, SCOPED_SKILLS_DIR)
}

/** One skill's delivery state, as the settings surface reads it. */
export interface ScopedSkillStatus {
  readonly name: string
  readonly presets: readonly string[]
  /** Whether a delivery provider currently serves this skill. */
  readonly delivered: boolean
  /** Present when delivery is refused (the same name exists in a default root). */
  readonly conflict?: string
}

/** One preset's delivery state. */
export interface ScopedPresetStatus {
  readonly presetId: string
  readonly skills: readonly string[]
  /** Present when the preset's standing scope could not be resolved. */
  readonly error?: string
}

/** Whole-delivery status for the settings surface and the model-facing tool. */
export interface ScopedDeliveryStatus {
  readonly enabled: boolean
  /** Why delivery is off (or reduced) — absent when it is fully operational. */
  readonly reason?: string
  readonly root: string
  readonly watching: boolean
  readonly skills: readonly ScopedSkillStatus[]
  readonly presets: readonly ScopedPresetStatus[]
  /** Default roots a duplicate could hide in but that cannot be enumerated. */
  readonly customRootsUnverifiable: boolean
}

/** The services this module borrows. Every one is optional. */
export interface ScopedDeliveryDeps {
  /** The harness home the managed root lives under. */
  readonly dshHome: () => string
  /** The agent-preset roster (absent in a rosterless composition). */
  readonly roster: () => PresetRosterSlice | undefined
  /** The skill registry's registration face (absent without `dsh-skill`). */
  readonly registry: () => ScopedDeliveryRegistry | undefined
  /** The session's workspace, for project-root duplicate detection. */
  readonly workdir?: () => string | undefined
  /** Logger for degradation and watcher diagnostics. */
  readonly log: (message: string) => void
}

/** The registry slice this module registers through. */
export interface ScopedDeliveryRegistry {
  readonly registerProvider?: (create: (control: SkillProviderControl) => SkillProvider) => () => void
}

/**
 * Read the `presetScope` list out of a frontmatter block.
 *
 * Accepted forms, at any indentation (the canonical one is
 * `metadata.presetScope`):
 *
 * ```yaml
 * metadata:
 *   presetScope: [dsh-writing, dev]
 *   presetScope:
 *     - dsh-writing
 * ```
 * @param front - the frontmatter text without its `---` fences.
 * @returns the declared ids, or undefined when the key is absent.
 */
export function parsePresetScopeFrontmatter(front: string): readonly string[] | undefined {
  const lines = front.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)presetScope\s*:\s*(.*)$/.exec(lines[index] ?? '')
    if (match === null) continue
    const indent = (match[1] ?? '').length
    const rest = (match[2] ?? '').trim()
    if (rest.startsWith('[')) {
      const inner = rest.slice(1, rest.lastIndexOf(']') === -1 ? undefined : rest.lastIndexOf(']'))
      return presetIdsOf(inner.split(','))
    }
    if (rest !== '') return presetIdsOf([rest])
    const block: string[] = []
    for (let item = index + 1; item < lines.length; item += 1) {
      const entry = /^(\s*)-\s*(.*?)\s*$/.exec(lines[item] ?? '')
      if (entry === null) break
      if ((entry[1] ?? '').length <= indent) break
      block.push(entry[2] ?? '')
    }
    return presetIdsOf(block)
  }
  return undefined
}

/** Normalize YAML scalars onto the preset-id grammar. */
function presetIdsOf(values: readonly string[]): readonly string[] {
  const ids: string[] = []
  for (const value of values) {
    const id = value.trim().replace(/^['"]|['"]$/g, '')
    if (id === '' || !KEBAB_ID.test(id)) continue
    if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

/** Whether a string is a usable skill / preset id. */
export function isKebabId(value: string): boolean {
  return KEBAB_ID.test(value)
}

/** Split a SKILL.md into its frontmatter block and body. */
export function splitFrontmatter(content: string): { front: string; body: string } | undefined {
  const match = FRONTMATTER.exec(content)
  if (match === null) return undefined
  return { front: match[1] ?? '', body: match[2] ?? '' }
}

/** Read a boolean frontmatter flag (`key: true|false`). */
function frontmatterFlag(front: string, key: string): boolean | undefined {
  const match = new RegExp(`^\\s*${key}\\s*:\\s*(true|false)\\s*$`, 'm').exec(front)
  if (match === null) return undefined
  return match[1] === 'true'
}

/** Read a scalar frontmatter value, unquoting a simple quoted or plain form. */
function frontmatterScalar(front: string, key: string): string | undefined {
  const match = new RegExp(`^\\s*${key}\\s*:\\s*(.+)$`, 'm').exec(front)
  if (match === null) return undefined
  const value = (match[1] ?? '').trim().replace(/^['"]|['"]$/g, '')
  return value === '' ? undefined : value
}

/**
 * Parse one managed `SKILL.md` into its delivery record.
 * @param content - the file text.
 * @param dir - the skill's directory (its resource base).
 * @param path - the absolute `SKILL.md` path.
 * @returns the record, or undefined when the frontmatter is unusable.
 */
export function managedSkillFrom(content: string, dir: string, path: string): ManagedSkill | undefined {
  const split = splitFrontmatter(content)
  if (split === undefined) return undefined
  const name = frontmatterScalar(split.front, 'name')
  const description = frontmatterScalar(split.front, 'description')
  if (name === undefined || description === undefined || !KEBAB_ID.test(name)) return undefined
  const whenToUse = frontmatterScalar(split.front, 'when-to-use') ?? frontmatterScalar(split.front, 'whenToUse')
  const presetScope = parsePresetScopeFrontmatter(split.front)
  return {
    name,
    description,
    ...whenToUse === undefined ? {} : { whenToUse },
    modelInvocable: frontmatterFlag(split.front, 'disable-model-invocation') !== true,
    userInvocable: frontmatterFlag(split.front, 'user-invocable') !== false,
    presetScope,
    dir,
    path,
    content,
  }
}

/** Whether this skill asks to be delivered to a specific preset set. */
export function isScoped(skill: ManagedSkill): boolean {
  return skill.presetScope !== undefined && skill.presetScope.length > 0
}

/** Project one managed skill onto a provider candidate for one preset. */
export function candidateFor(skill: ManagedSkill): SkillCandidate {
  return {
    name: skill.name,
    description: skill.description,
    ...skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse },
    invocation: { modelInvocable: skill.modelInvocable, userInvocable: skill.userInvocable },
    source: 'custom',
    provider: SCOPED_PROVIDER_NAME,
    rank: MANAGED_SKILL_RANK,
    locator: skill.path,
    path: skill.path,
    metadata: { presetScope: [...(skill.presetScope ?? [])] },
    resourceBase: { kind: 'directory', path: skill.dir },
  }
}

/** Project one managed skill onto the complete definition the loader returns. */
export function definitionFor(skill: ManagedSkill): SkillDefinition {
  return { ...candidateFor(skill), content: skill.content }
}

/** The default roots a duplicate copy could live in. */
export function defaultSkillRoots(dshHome: string, workdir?: string | undefined): readonly string[] {
  const roots = [
    join(dshHome, 'skills'),
    join(dshHome, '.agents', 'skills'),
    join(process.env.DSH_AGENTS_HOME ?? join(homedir(), '.agents'), 'skills'),
  ]
  if (workdir !== undefined && workdir !== '') {
    roots.push(join(workdir, '.dsh', 'skills'), join(workdir, '.agents', 'skills'))
  }
  return roots
}

/**
 * Find managed names that a default root also supplies.
 *
 * A duplicate is what makes a scope claim false: the host provider delivers the
 * default root's copy into every preset regardless of this module's decision.
 * @param skills - the managed entries under consideration.
 * @param dshHome - the harness home.
 * @param workdir - the session workspace, when known.
 * @returns skill name → the default root that already supplies it.
 */
export function detectConflicts(
  skills: readonly ManagedSkill[],
  dshHome: string,
  workdir?: string | undefined,
): Map<string, string> {
  const conflicts = new Map<string, string>()
  for (const root of defaultSkillRoots(dshHome, workdir)) {
    for (const skill of skills) {
      if (conflicts.has(skill.name)) continue
      if (existsSync(join(root, skill.name, 'SKILL.md')) || existsSync(join(root, `${skill.name}.md`))) {
        conflicts.set(skill.name, root)
      }
    }
  }
  return conflicts
}

/**
 * Scan the managed root for skill directories.
 * @param root - the managed skills root.
 * @returns every readable, usable entry, sorted by name.
 */
export async function scanManagedSkills(root: string): Promise<readonly ManagedSkill[]> {
  let children
  try {
    children = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const found: ManagedSkill[] = []
  for (const child of children) {
    if (!child.isDirectory() || !KEBAB_ID.test(child.name)) continue
    const dir = join(root, child.name)
    const path = join(dir, 'SKILL.md')
    try {
      const [content, info] = await Promise.all([readFile(path, 'utf8'), stat(path)])
      if (!info.isFile()) continue
      const skill = managedSkillFrom(content, dir, path)
      if (skill !== undefined) found.push(skill)
    } catch {
      // An unreadable entry is reported by omission; the settings surface lists
      // only what could actually be delivered.
    }
  }
  return found.sort((left, right) => left.name.localeCompare(right.name))
}

/** One live delivery registration. */
interface DeliveryEntry {
  readonly presetId: string
  readonly key: ScopeKey
  readonly scope: Scope
  /** The registry's invalidation hook for this registration. */
  readonly invalidate: () => void
}

/**
 * Delivers managed skills into the scope layers of the presets their
 * frontmatter names.
 *
 * Lifecycle: {@link start} once (watcher + first reconcile), {@link reconcile}
 * whenever policy or files may have changed, {@link dispose} when the owning
 * plugin unloads. Reconciliation never fails loudly: every problem becomes a
 * status field, because a catalog must not fail the boot of the instance it is
 * describing.
 */
export class ScopedSkillDelivery {
  private readonly entries: DeliveryEntry[] = []
  private managed: readonly ManagedSkill[] = []
  private conflicts = new Map<string, string>()
  private presetErrors = new Map<string, string>()
  private watcher: FSWatcher | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private watching = false
  private failure: string | undefined
  private started = false
  private disposed = false

  /**
   * @param ctx - the host context the delivery scopes are minted under.
   * @param deps - borrowed services and paths, all optional at runtime.
   */
  constructor(private readonly ctx: Context, private readonly deps: ScopedDeliveryDeps) {}

  /** Start watching the managed root and deliver what it currently holds. */
  async start(): Promise<void> {
    if (this.started || this.disposed) return
    this.started = true
    await this.ensureRoot()
    this.watchRoot()
    this.ctx.on('agent-preset/selected', () => { void this.reconcile() })
    await this.reconcile()
  }

  /** Re-read policy and files, then converge the delivery registrations. */
  async reconcile(): Promise<void> {
    if (this.disposed) return
    const registry = this.deps.registry()
    const roster = this.deps.roster()
    if (registry?.registerProvider === undefined) {
      this.failure = 'the skill registry exposes no provider registration'
      this.disposeEntries()
      this.managed = []
      return
    }
    if (roster?.standingKeyFor === undefined) {
      this.failure = 'no agent-preset roster is composed'
      this.disposeEntries()
      this.managed = []
      return
    }

    const root = this.root()
    this.managed = await scanManagedSkills(root)
    this.conflicts = detectConflicts(this.managed, this.deps.dshHome(), this.deps.workdir?.())

    // presetId → the skills it must serve. A conflicted skill is excluded: the
    // default root already supplies that name everywhere, so delivering a
    // second candidate could not change what any preset sees.
    const byPreset = new Map<string, ManagedSkill[]>()
    for (const skill of this.managed) {
      if (!isScoped(skill) || this.conflicts.has(skill.name)) continue
      for (const presetId of skill.presetScope ?? []) {
        const list = byPreset.get(presetId) ?? []
        list.push(skill)
        byPreset.set(presetId, list)
      }
    }

    this.presetErrors = new Map()
    const live = this.liveKeys()
    // Resolve each named preset once: the roster's `standingKeyFor` ensures the
    // standing mount, so repeated calls are wasted work and repeated mounts.
    const resolved = new Map<string, ScopeKey | undefined>()
    for (const presetId of byPreset.keys()) {
      resolved.set(presetId, await this.resolveKey(roster, presetId))
    }

    // Drop registrations that no longer have work, or whose generation is gone.
    for (const entry of [...this.entries]) {
      if (!byPreset.has(entry.presetId)) {
        await this.dropEntry(entry)
        continue
      }
      const wantedKey = resolved.get(entry.presetId)
      if (wantedKey === entry.key) continue
      // A newer generation of the same preset: keep serving sessions that are
      // still joined to the old key, and let the new key get its own entry.
      if (wantedKey !== undefined && live.has(entry.key)) continue
      await this.dropEntry(entry)
    }

    for (const presetId of byPreset.keys()) {
      const key = resolved.get(presetId)
      if (key === undefined) continue
      if (this.entries.some(entry => entry.presetId === presetId && entry.key === key)) continue
      await this.register(presetId, key)
    }

    this.failure = undefined
    this.invalidateAll()
  }

  /** The current status, for the settings surface and the model-facing tool. */
  status(): ScopedDeliveryStatus {
    const delivered = new Set<string>()
    for (const entry of this.entries) {
      for (const skill of this.managed) {
        if (!this.conflicts.has(skill.name) && (skill.presetScope ?? []).includes(entry.presetId)) {
          delivered.add(skill.name)
        }
      }
    }
    const skills: ScopedSkillStatus[] = this.managed.map(skill => {
      const conflict = this.conflicts.get(skill.name)
      return {
        name: skill.name,
        presets: [...(skill.presetScope ?? [])],
        delivered: delivered.has(skill.name),
        ...conflict === undefined ? {} : { conflict: join(conflict, skill.name) },
      }
    })
    const presets: ScopedPresetStatus[] = [...new Set(this.entries.map(entry => entry.presetId))]
      .sort((left, right) => left.localeCompare(right))
      .map(presetId => {
        const skills = this.managed
          .filter(skill => !this.conflicts.has(skill.name) && (skill.presetScope ?? []).includes(presetId))
          .map(skill => skill.name)
        const error = this.presetErrors.get(presetId)
        return { presetId, skills, ...error === undefined ? {} : { error } }
      })
    for (const [presetId, error] of this.presetErrors) {
      if (!presets.some(row => row.presetId === presetId)) presets.push({ presetId, skills: [], error })
    }
    return {
      enabled: this.failure === undefined && this.entries.length > 0,
      ...this.failure === undefined ? {} : { reason: this.failure },
      root: this.root(),
      watching: this.watching,
      skills,
      presets,
      // Custom roots are configured inside host compositions this plugin cannot
      // read; a duplicate there would not be detected.
      customRootsUnverifiable: true,
    }
  }

  /** Stop watching and dispose every delivery registration. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.watcher?.close()
    this.watcher = undefined
    this.watching = false
    await this.disposeEntries()
    this.managed = []
  }

  /** The managed root under the current harness home. */
  private root(): string {
    return scopedSkillsRoot(this.deps.dshHome())
  }

  /** Create the managed root if it is still absent. */
  private async ensureRoot(): Promise<void> {
    try {
      await mkdir(this.root(), { recursive: true })
    } catch (error) {
      this.failure = `the managed root could not be created: ${describeError(error)}`
    }
  }

  /** Watch the managed root, degrading to on-demand rescans when it cannot. */
  private watchRoot(): void {
    try {
      this.watcher = watch(this.root(), { recursive: true }, () => this.scheduleRescan())
      this.watching = true
    } catch (error) {
      this.watching = false
      this.deps.log(`capability-catalog: managed root is not watched (${describeError(error)}); scope changes apply on the next reconcile`)
    }
  }

  /** Coalesce a burst of filesystem events into one reconcile. */
  private scheduleRescan(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.reconcile().catch((error: unknown) => {
        this.deps.log(`capability-catalog: scoped skill reconcile failed: ${describeError(error)}`)
      })
    }, RESCAN_DEBOUNCE_MS)
  }

  /** The standing keys that still have a live mount in this process. */
  private liveKeys(): Set<ScopeKey> {
    const keys = new Set<ScopeKey>()
    try {
      for (const mount of livePresetMounts()) {
        if (mount.key !== undefined) keys.add(mount.key)
      }
    } catch {
      // Without the mount list nothing is known to be live; registrations for
      // needed presets are still kept, only stale generations are dropped.
    }
    return keys
  }

  /** Resolve one preset's standing key, remembering why it failed. */
  private async resolveKey(roster: PresetRosterSlice, presetId: string): Promise<ScopeKey | undefined> {
    try {
      const key = await roster.standingKeyFor?.(presetId)
      if (key === undefined) {
        this.presetErrors.set(presetId, 'the roster resolved no standing scope')
        return undefined
      }
      return key as ScopeKey
    } catch (error) {
      this.presetErrors.set(presetId, describeError(error))
      return undefined
    }
  }

  /** Register one delivery provider into a preset's layer. */
  private async register(presetId: string, key: ScopeKey): Promise<void> {
    const scope = createScope(this.ctx, key)
    try {
      // A scope-minted context owns no dependency access of its own, and the
      // registry only records the layer a registration was made *through* — so
      // the provider is registered through an injected child of that scope. The
      // scope tag survives the extra level.
      const injected = await injectableScope(scope.ctx)
      if (injected === undefined) {
        await scope.dispose()
        this.presetErrors.set(presetId, `the ${SKILLS_SERVICE} service was not injectable in the delivery scope`)
        return
      }
      let invalidate: (() => void) | undefined
      injected.skills.registerProvider((control: SkillProviderControl) => {
        invalidate = control.invalidate
        return this.providerFor(presetId, control)
      })
      this.entries.push({ presetId, key, scope, invalidate: () => invalidate?.() })
    } catch (error) {
      await scope.dispose().catch(() => {})
      this.presetErrors.set(presetId, `delivery scope could not be created: ${describeError(error)}`)
    }
  }

  /**
   * The provider serving one preset. It reads only its own preset's assignment
   * and re-reads the files, so a policy or content edit needs no re-registration
   * beyond the invalidation reconcile already performs.
   */
  private providerFor(presetId: string, _control: SkillProviderControl): SkillProvider {
    return {
      name: SCOPED_PROVIDER_NAME,
      list: async (): Promise<readonly SkillCandidate[]> =>
        this.skillsFor(presetId).map(skill => candidateFor(skill)),
      get: async (candidate: SkillCandidate): Promise<SkillDefinition | undefined> => {
        const skill = this.skillsFor(presetId).find(entry => entry.name === candidate.name)
        return skill === undefined ? undefined : definitionFor(skill)
      },
    }
  }

  /** The managed skills one preset currently serves. */
  private skillsFor(presetId: string): readonly ManagedSkill[] {
    return this.managed.filter(skill =>
      !this.conflicts.has(skill.name) && (skill.presetScope ?? []).includes(presetId))
  }

  /** Invalidate every registration's completed catalogs. */
  private invalidateAll(): void {
    for (const entry of this.entries) entry.invalidate()
  }

  /** Dispose every registration. */
  private async disposeEntries(): Promise<void> {
    const entries = this.entries.splice(0, this.entries.length)
    for (const entry of entries) {
      try {
        await entry.scope.dispose()
      } catch (error) {
        this.deps.log(`capability-catalog: delivery scope disposal failed: ${describeError(error)}`)
      }
    }
  }

  /** Dispose one registration and forget it. */
  private async dropEntry(entry: DeliveryEntry): Promise<void> {
    const index = this.entries.indexOf(entry)
    if (index >= 0) this.entries.splice(index, 1)
    try {
      await entry.scope.dispose()
    } catch (error) {
      this.deps.log(`capability-catalog: delivery scope disposal failed: ${describeError(error)}`)
    }
  }
}

/** Render an unknown failure for a status field or a log line. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The registry every delivery registration is made through. */
const SKILLS_SERVICE = 'skills'

/** How long an injection may take before the registration is abandoned. */
const INJECT_TIMEOUT_MS = 500

/**
 * A context within `scope` that may access the skill registry.
 *
 * A scope-minted context carries no dependency access by itself, and Cordis
 * resolves an `inject` callback after the current task — hence the bounded
 * await, which gives `reconcile()` a settled answer instead of a registration
 * that appears at some later tick.
 * @param scopeCtx - the context minted for one preset's standing key.
 * @returns the injected context, or undefined when it never became available.
 */
function injectableScope(scopeCtx: Context): Promise<Context | undefined> {
  return new Promise(resolve => {
    let settled = false
    const finish = (value: Context | undefined): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => finish(undefined), INJECT_TIMEOUT_MS)
    scopeCtx.inject([SKILLS_SERVICE], (injected: Context) => finish(injected))
  })
}
