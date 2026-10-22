/**
 * The game service core (`ctx.gameStore`): the project registry, session
 * binding, reading a project for the tools and the panel, the end-of-turn
 * check flow, versions and the playtest log.
 *
 * Storage (proposal §3): a project is a plain directory in the session's
 * workspace — `game.json`, `index.html`, `src/`, `assets/`, `elements/`,
 * `design/`, `tests/` — and the plugin's own state lives inside it under
 * `.game/` (versions, the last check, the playtest log), so the project moves
 * as one folder. Only the registry (which projects exist, which session is
 * bound to which) is deployment-level, at `$DSH_HOME/state/game/`.
 *
 * The agent writes project files with the ordinary fs tools; the plugin
 * writes only the manifest and the first chapter at creation (through the
 * mounted `ctx.fs` with the calling session's policy, so the fence applies)
 * and its own `.game/` state. Version snapshots copy binary assets, which
 * `ctx.fs` cannot write, so they go through node behind the same checks the
 * canvas uses: the session's mode is not read-only and the target sits inside
 * the project.
 * @module @khorsheed/dsh-game
 */
import { createHash, randomBytes } from 'node:crypto'
import { appendFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.fs service merge.
import type {} from '@deepseek-ai/dsh-fs'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import type { Session } from '@deepseek-ai/dsh-session'
import { ChromeChecker, type BrowserChecker } from './checks.ts'
import { kitOf, withKitRuntime, type RuntimeKit } from './kits/index.ts'
import { bundleOf, fingerprintOf, inside, readJson, readText, walk, writeAtomic, type WalkedFile } from './fsutil.ts'
import {
  artStyleLabel, chapterStatus, elementsChapter, gate, isBuildFile, parseManifest,
  patchElementText, listOf, pillarNotes, resolveArtStyle, serializeManifest, slugOf, validateElements, type CreateRequest,
} from './project.ts'
import {
  CHAPTERS, MANIFEST_FILE, PANEL_CHANGES_MARK, STATE_DIR,
  type AnyLook, type ChapterView, type CheckFailure, type CheckRecord, type GameManifest, type GameResult,
  type LogEntry, type LookProposal, type PendingChange, type PlayBundle, type ProjectCard, type ProjectRow, type ProjectView, type TurnReport,
  type SessionGameState, type VersionDiff, type VersionRecord, type VersionRow,
} from './types.ts'

/** Plugin config; every key optional. */
export interface GameConfig {
  /** Registry root override (default `$DSH_HOME/state/game`). */
  stateRoot?: string
  /** Chrome executable for the checks (default: `CHROME_PATH`, then common install paths). */
  chromePath?: string
}

/** Versions kept under `.game/versions/`; older ones are pruned. */
const KEEP_VERSIONS = 10

/**
 * Resolve the registry root: explicit value, then `$DSH_HOME/state/game`,
 * then `<cwd>/.dsh-game` (the canvas precedent).
 */
export function resolveGameStateRoot(configured: string | undefined): string {
  if (configured !== undefined && configured !== '') return configured
  const home = process.env.DSH_HOME
  if (home !== undefined && home !== '') return join(home, 'state', 'game')
  return join(process.cwd(), '.dsh-game')
}

/** The deployment-level registry file's shape. */
interface Registry {
  projects: ProjectRow[]
  bindings: Record<string, string>
}

/** The user layer (`.game/user.json`): slider overrides, changes waiting for the next send, a pending restyle. */
interface UserLayer {
  params: Record<string, number>
  pending: PendingChange[]
  restyleTo?: string
}

/** One `.game/versions.json` row. */
interface VersionEntry extends VersionRecord {
  passed?: number
  rejected?: boolean
}

/** Format a number the way the dock shows it (no float noise). */
function num(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}

/** A project's state when a turn started, for the turn report. */
export interface TurnBaseline {
  readonly at: number
  readonly projectId: string
  readonly files: ReadonlyMap<string, string>
  readonly elements: ReadonlyMap<string, { name: string; json: string; look: string; fields: Record<string, string> }>
  readonly params: Readonly<Record<string, number>>
  readonly current: number | undefined
  readonly candidate: number | undefined
}

/** The writer the store creates the first files with (specs swap in plain node). */
export type FenceWriter = (path: string, content: string, session: Session) => Promise<void>

/** One end-of-turn evaluation's outcome, as the hook acts on it. */
export type TurnCheckOutcome =
  | { readonly kind: 'skip' }
  | { readonly kind: 'pass'; readonly record: CheckRecord; readonly deployed: VersionRecord | null; readonly candidate: VersionRecord | null }
  | { readonly kind: 'fail'; readonly record: CheckRecord }

/** The game service core. */
export class GameService {
  static inject = ['fs']

  readonly stateRoot: string
  private readonly sandboxPolicy: SandboxPolicyService | undefined
  private readonly checker: BrowserChecker
  /** Serializes registry read-modify-write cycles. */
  private registryLock: Promise<unknown> = Promise.resolve()
  private readonly listeners = new Set<(projectId: string) => void>()

  /**
   * @param ctx - host context (the mounted `ctx.fs`; `sandboxPolicy` probed).
   * @param config - plugin config.
   * @param deps - seams the specs replace.
   */
  constructor(
    private readonly ctx: Context,
    config: GameConfig = {},
    deps: { checker?: BrowserChecker; writer?: FenceWriter } = {},
  ) {
    this.stateRoot = resolveGameStateRoot(config.stateRoot)
    this.sandboxPolicy = ctx.fs?.sandboxMode === undefined ? undefined : ctx.get('sandboxPolicy') as SandboxPolicyService | undefined
    this.checker = deps.checker ?? new ChromeChecker(config.chromePath)
    if (deps.writer !== undefined) this.writeFenced = deps.writer
  }

  /** Release the checker's browser. */
  async dispose(): Promise<void> {
    await this.checker.dispose()
  }

  /** Subscribe to project changes (the Remote face forwards nothing yet; specs and hooks use it). */
  subscribe(listener: (projectId: string) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private notify(projectId: string): void {
    for (const listener of this.listeners) listener(projectId)
  }

  /** Default fenced write: the mounted fs, stamped with the caller's policy. */
  private writeFenced: FenceWriter = async (path, content, session) => {
    const policy = this.sandboxPolicy?.resolve({ session })
    const target = await this.ctx.fs.resolve(path)
    await this.ctx.fs.writeText(target, content, { kind: 'createIfAbsent' }, undefined, policy)
  }

  /** Whether the session may have the plugin write into its workspace. */
  private writable(session: Session | undefined): boolean {
    if (session === undefined) return true
    return this.sandboxPolicy?.resolve({ session })?.mode !== 'read-only'
  }

  // ---------------------------------------------------------------- registry

  private registryPath(): string {
    return join(this.stateRoot, 'registry.json')
  }

  private async readRegistry(): Promise<Registry> {
    const raw = await readJson<Partial<Registry>>(this.registryPath())
    return {
      projects: Array.isArray(raw?.projects) ? raw.projects.filter(p => typeof p?.id === 'string' && typeof p.root === 'string') : [],
      bindings: raw?.bindings !== null && typeof raw?.bindings === 'object' ? { ...raw.bindings } : {},
    }
  }

  /** Read-modify-write the registry under the lock. */
  private async updateRegistry<T>(change: (registry: Registry) => T): Promise<T> {
    const run = this.registryLock.then(async () => {
      const registry = await this.readRegistry()
      const result = change(registry)
      await writeAtomic(this.registryPath(), `${JSON.stringify(registry, null, 2)}\n`)
      return result
    })
    this.registryLock = run.catch(() => {})
    return run
  }

  /** Every registered project, most recently updated first. */
  async listProjects(): Promise<ProjectRow[]> {
    const { projects } = await this.readRegistry()
    return [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  /** Element files parsed per id, for turn diffs. */
  private async elementIndex(root: string): Promise<Map<string, { name: string; json: string; look: string; fields: Record<string, string> }>> {
    const out = new Map<string, { name: string; json: string; look: string; fields: Record<string, string> }>()
    for (const f of await walk(join(root, 'elements'), p => p.endsWith('.json'))) {
      let raw: unknown
      try { raw = JSON.parse(f.data.toString('utf8')) } catch { continue }
      for (const item of Array.isArray(raw) ? raw : [raw]) {
        if (item === null || typeof item !== 'object') continue
        const r = item as Record<string, unknown>
        if (typeof r.id !== 'string') continue
        const fields: Record<string, string> = {}
        for (const [k, v] of Object.entries(r)) if (k !== 'look' && k !== 'id') fields[k] = JSON.stringify(v)
        out.set(r.id, { name: typeof r.name === 'string' ? r.name : r.id, json: JSON.stringify(r), look: JSON.stringify(r.look ?? null), fields })
      }
    }
    return out
  }

  /** Snapshot the bound project when a turn starts (undefined when unbound). */
  async turnBaseline(sessionId: string): Promise<TurnBaseline | undefined> {
    const row = await this.boundProject(sessionId)
    if (row === undefined) return undefined
    const files = new Map((await walk(row.root, () => true)).map(f => [f.path, createHash('sha1').update(f.data).digest('hex')]))
    const manifest = await this.manifestOf(row.root)
    return {
      at: Date.now(), projectId: row.id, files, elements: await this.elementIndex(row.root),
      params: Object.fromEntries((manifest?.params ?? []).map(p => [p.key, p.value])),
      current: (await readJson<VersionRecord>(join(row.root, STATE_DIR, 'current.json')))?.version,
      candidate: (await readJson<VersionRecord>(join(row.root, STATE_DIR, 'candidate.json')))?.version,
    }
  }

  private turnsPath(sessionId: string): string {
    return join(this.stateRoot, 'turns', `${sessionId.replace(/[^\w.-]/g, '_')}.json`)
  }

  /**
   * Compare the project with its turn-start snapshot and store what the turn
   * changed. Nothing is stored for a turn that changed nothing.
   */
  async recordTurn(sessionId: string, turn: number, base: TurnBaseline): Promise<TurnReport | undefined> {
    const row = await this.row(base.projectId)
    if (row === undefined) return undefined
    const now = new Map((await walk(row.root, () => true)).map(f => [f.path, createHash('sha1').update(f.data).digest('hex')]))
    const changed = [...now.keys()].filter(p => base.files.get(p) !== now.get(p))
    const removed = [...base.files.keys()].filter(p => !now.has(p))
    const elementsNow = await this.elementIndex(row.root)
    const elements: TurnReport['elements'][number][] = []
    for (const [id, e] of elementsNow) {
      const before = base.elements.get(id)
      if (before === undefined) { elements.push({ id, name: e.name, what: 'new' }); continue }
      if (before.json === e.json) continue
      const fields = [...new Set([...Object.keys(e.fields), ...Object.keys(before.fields)])].filter(k => e.fields[k] !== before.fields[k])
      if (before.look !== e.look) elements.push({ id, name: e.name, what: 'look', ...(fields.length > 0 ? { fields } : {}) })
      else elements.push({ id, name: e.name, what: 'fields', fields })
    }
    for (const [id, e] of base.elements) if (!elementsNow.has(id)) elements.push({ id, name: e.name, what: 'removed' })
    const manifest = await this.manifestOf(row.root)
    const params = (manifest?.params ?? []).filter(p => base.params[p.key] !== p.value)
      .map(p => ({ key: p.key, label: p.label, to: p.value, ...(base.params[p.key] === undefined ? {} : { from: base.params[p.key]! }) }))
    const chapters = CHAPTERS.filter(c => c.generated !== true && [...changed, ...removed].includes(c.file)).map(c => ({ id: c.id, title: c.title }))
    const code = [...changed, ...removed].filter(p => isBuildFile(p) && !p.startsWith('elements/') && p !== MANIFEST_FILE)
    const tests = changed.filter(p => p.startsWith('tests/'))
    const current = (await readJson<VersionRecord>(join(row.root, STATE_DIR, 'current.json')))?.version
    const candidate = (await readJson<VersionRecord>(join(row.root, STATE_DIR, 'candidate.json')))?.version
    const version = candidate !== undefined && candidate !== base.candidate ? { kind: 'candidate' as const, version: candidate }
      : current !== undefined && current !== base.current ? { kind: 'deployed' as const, version: current } : null
    const last = await readJson<CheckRecord>(join(row.root, STATE_DIR, 'checks.json'))
    const check = last !== undefined && new Date(last.at).getTime() >= base.at
      ? { ok: last.ok, fixes: last.attempt, gaveUp: last.gaveUp === true, passed: last.passed, failures: last.failures.length }
      : null
    if (elements.length + params.length + chapters.length + code.length + tests.length === 0 && version === null && check === null) return undefined
    const report: TurnReport = {
      turn, projectId: row.id, title: manifest?.title ?? row.title, at: new Date().toISOString(),
      version, check, elements, chapters, params, code: code.slice(0, 20), tests,
    }
    const path = this.turnsPath(sessionId)
    const all = (await readJson<Record<string, TurnReport>>(path)) ?? {}
    all[String(turn)] = report
    const keys = Object.keys(all).map(Number).sort((a, b) => b - a)
    for (const k of keys.slice(200)) delete all[String(k)]
    await writeAtomic(path, `${JSON.stringify(all)}\n`)
    this.notify(row.id)
    return report
  }

  /** A stored turn report. */
  async turnReport(sessionId: string, turn: number): Promise<TurnReport | null> {
    const all = await readJson<Record<string, TurnReport>>(this.turnsPath(sessionId))
    return all?.[String(turn)] ?? null
  }

  /** Every project as a switcher card (manifest summary, live version, last screenshot), most recent first. */
  async projectCards(): Promise<ProjectCard[]> {
    const cards: ProjectCard[] = []
    for (const row of await this.listProjects()) {
      const manifest = await this.manifestOf(row.root)
      const current = await readJson<VersionRecord>(join(row.root, STATE_DIR, 'current.json'))
      const elementFiles = await walk(join(row.root, 'elements'), p => p.endsWith('.json'))
      const { elements } = validateElements(Object.fromEntries(elementFiles.map(f => [`elements/${f.path}`, f.data.toString('utf8')])), [], kitOf(manifest?.runtime))
      const thumb = await readFile(join(row.root, STATE_DIR, 'last-check.webp')).catch(() => undefined)
      cards.push({
        id: row.id, title: manifest?.title ?? row.title, root: row.root, updatedAt: row.updatedAt,
        pitch: manifest?.pitch ?? '', artStyle: manifest?.artStyle ?? '', version: current?.version ?? null, elements: elements.length,
        ...(thumb === undefined || thumb.length > 400_000 ? {} : { thumb: thumb.toString('base64') }),
      })
    }
    return cards
  }

  /** The project a session is bound to, if any. */
  async boundProject(sessionId: string): Promise<ProjectRow | undefined> {
    const registry = await this.readRegistry()
    const id = registry.bindings[sessionId]
    return id === undefined ? undefined : registry.projects.find(p => p.id === id)
  }

  /** Bind a session to a project (or unbind with null). */
  async bind(sessionId: string, projectId: string | null): Promise<GameResult> {
    return this.updateRegistry(registry => {
      if (projectId === null) {
        delete registry.bindings[sessionId]
        return { ok: true } as const
      }
      if (!registry.projects.some(p => p.id === projectId)) return { ok: false, error: 'not-found' } as const
      registry.bindings[sessionId] = projectId
      return { ok: true } as const
    })
  }

  private async touch(projectId: string): Promise<void> {
    await this.updateRegistry(registry => {
      const row = registry.projects.find(p => p.id === projectId)
      if (row !== undefined) Object.assign(row, { updatedAt: new Date().toISOString() })
    }).catch(() => {})
    this.notify(projectId)
  }

  /**
   * Register an existing folder that holds a `game.json` (a project copied
   * in, or one whose registry row was lost).
   */
  async adopt(root: string): Promise<GameResult<{ readonly ok: true; readonly project: ProjectRow }>> {
    const manifestText = await readText(join(root, MANIFEST_FILE))
    if (manifestText === undefined) return { ok: false, error: 'not-found' }
    const parsed = parseManifest(manifestText)
    if (!parsed.ok) return { ok: false, error: 'invalid' }
    return this.updateRegistry(registry => {
      const existing = registry.projects.find(p => p.root === root || p.id === parsed.manifest.id)
      if (existing !== undefined) return { ok: true, project: existing } as const
      const now = new Date().toISOString()
      const row: ProjectRow = { id: parsed.manifest.id, title: parsed.manifest.title, root, createdAt: parsed.manifest.createdAt || now, updatedAt: now }
      registry.projects.push(row)
      return { ok: true, project: row } as const
    })
  }

  // ---------------------------------------------------------------- create

  /**
   * Create a project in the session's workspace behind the light gate, and
   * bind the session to it.
   * @param request - the gate's inputs.
   * @param session - the calling session (its workspace and fence).
   * @returns the new row, the gate's missing items, or a failure.
   */
  async create(
    request: CreateRequest,
    session: Session,
  ): Promise<{ ok: true; project: ProjectRow } | { ok: false; missing: readonly string[] } | { ok: false; error: string }> {
    const verdict = gate(request)
    if (!verdict.ok) return { ok: false, missing: verdict.missing }
    const cwd = session.header?.cwd
    if (cwd === undefined || cwd === '') return { ok: false, error: '这个会话没有工作区，项目没处放。请用户先给会话选一个工作区。' }
    if (!this.writable(session)) return { ok: false, error: '这个会话是只读模式，不能新建项目。' }
    const registry = await this.readRegistry()
    const base = slugOf(verdict.manifest.title)
    let folder = base
    for (let n = 2; registry.projects.some(p => p.root === join(cwd, folder)) || await stat(join(cwd, folder)).then(() => true, () => false); n++) {
      folder = `${base}-${n}`
    }
    const root = join(cwd, folder)
    const id = `g_${randomBytes(4).toString('hex')}`
    const now = new Date().toISOString()
    const manifest: GameManifest = { ...verdict.manifest, id, createdAt: now }
    try {
      await this.writeFenced(join(root, MANIFEST_FILE), serializeManifest(manifest), session)
    } catch (error) {
      return { ok: false, error: `写不进工作区：${(error as Error).message.split('\n')[0]}` }
    }
    const row: ProjectRow = { id, title: manifest.title, root, createdAt: now, updatedAt: now }
    await this.updateRegistry(r => {
      r.projects.push(row)
      r.bindings[session.id] = id
    })
    this.notify(id)
    return { ok: true, project: row }
  }

  // ---------------------------------------------------------------- read

  private async row(projectId: string): Promise<ProjectRow | undefined> {
    return (await this.readRegistry()).projects.find(p => p.id === projectId)
  }

  /**
   * Everything the panel and `game_read` show about one project.
   * @param projectId - registry id.
   * @returns the view, or undefined for an unknown id.
   */
  async view(projectId: string): Promise<ProjectView | undefined> {
    const row = await this.row(projectId)
    if (row === undefined) return undefined
    const manifestText = await readText(join(row.root, MANIFEST_FILE))
    const parsed = manifestText === undefined ? undefined : parseManifest(manifestText)
    const manifest = parsed?.ok === true ? parsed.manifest : null
    const elementFiles = await walk(join(row.root, 'elements'), p => p.endsWith('.json'))
    const { elements, failures } = validateElements(
      Object.fromEntries(elementFiles.map(f => [`elements/${f.path}`, f.data.toString('utf8')])),
      manifest?.elementTypes ?? [],
      kitOf(manifest?.runtime),
    )
    const playtest = await this.playtestText(row.root)
    const chapters: ChapterView[] = []
    for (const spec of CHAPTERS) {
      const text = spec.id === 'elements'
        ? elementsChapter(elements, manifest?.elementTypes ?? [])
        : spec.id === 'playtest' ? playtest
        : spec.id === 'pillars' ? pillarNotes((await readText(join(row.root, spec.file))) ?? '', manifest)
        : (await readText(join(row.root, spec.file))) ?? ''
      const source = spec.id === 'playtest' ? join(row.root, STATE_DIR, 'playtest-log.jsonl') : spec.id === 'elements' ? join(row.root, 'elements') : join(row.root, spec.file)
      const mtime = await stat(source).then(info => info.mtimeMs, () => 0)
      chapters.push({
        id: spec.id, title: spec.title, file: spec.file, text, generated: spec.generated === true, mtime,
        status: spec.generated === true ? (text === '' ? 'todo' : 'draft') : chapterStatus(text),
      })
    }
    const state = join(row.root, STATE_DIR)
    const user = await this.userLayer(row.root)
    const params = manifest?.params ?? []
    const paramOverrides = Object.fromEntries(Object.entries(user.params).filter(([key, value]) => {
      const param = params.find(p => p.key === key)
      return param !== undefined && param.value !== value
    }))
    return {
      id: row.id,
      title: manifest?.title ?? row.title,
      root: row.root,
      manifest,
      ...(manifestText === undefined ? { manifestError: `${MANIFEST_FILE} 不见了` } : parsed?.ok === false ? { manifestError: parsed.error } : {}),
      chapters,
      elements,
      elementErrors: failures,
      current: (await readJson<VersionRecord>(join(state, 'current.json'))) ?? null,
      candidate: (await readJson<VersionRecord>(join(state, 'candidate.json'))) ?? null,
      lastCheck: (await readJson<CheckRecord>(join(state, 'checks.json'))) ?? null,
      hasEntry: await stat(join(row.root, 'index.html')).then(() => true, () => false),
      paramOverrides,
      pending: user.pending,
      proposals: await this.proposals(row.root),
      versions: await this.versionRows(row.root),
      log: await this.logEntries(row.root),
      ...(user.restyleTo === undefined ? {} : { restyleTo: user.restyleTo }),
    }
  }

  /** The tab's state for one session. */
  async sessionState(sessionId: string): Promise<SessionGameState> {
    const bound = await this.boundProject(sessionId)
    return {
      bound: bound === undefined ? null : (await this.view(bound.id)) ?? null,
      projects: await this.listProjects(),
    }
  }

  /** The files of a deployed (or candidate) version, for the play area. */
  async bundle(projectId: string, which: 'current' | 'candidate' = 'current'): Promise<GameResult<{ readonly ok: true; readonly bundle: PlayBundle }>> {
    const row = await this.row(projectId)
    if (row === undefined) return { ok: false, error: 'not-found' }
    const record = await readJson<VersionRecord>(join(row.root, STATE_DIR, `${which}.json`))
    if (record === undefined) return { ok: false, error: 'no-version' }
    const files = await walk(join(row.root, STATE_DIR, 'versions', String(record.version)), () => true)
    if (files.length === 0) return { ok: false, error: 'no-version' }
    return { ok: true, bundle: { projectId, version: record.version, files: withKitRuntime(bundleOf(files), this.snapshotKit(files)) } }
  }

  /** One specific version's files. */
  async versionBundle(projectId: string, version: number): Promise<GameResult<{ readonly ok: true; readonly bundle: PlayBundle }>> {
    const row = await this.row(projectId)
    if (row === undefined) return { ok: false, error: 'not-found' }
    const files = await walk(join(row.root, STATE_DIR, 'versions', String(Math.floor(version))), () => true)
    if (files.length === 0) return { ok: false, error: 'no-version' }
    return { ok: true, bundle: { projectId, version, files: withKitRuntime(bundleOf(files), this.snapshotKit(files)) } }
  }

  /** The kit a snapshot was built for: its own `game.json`'s runtime. */
  private snapshotKit(files: readonly WalkedFile[]): RuntimeKit {
    const manifest = files.find(f => f.path === MANIFEST_FILE)
    const parsed = manifest === undefined ? undefined : parseManifest(manifest.data.toString('utf8'))
    return kitOf(parsed?.ok === true ? parsed.manifest.runtime : undefined)
  }

  /** The kit a project runs on now (its working `game.json`). */
  private async kitFor(root: string): Promise<RuntimeKit> {
    return kitOf((await this.manifestOf(root))?.runtime)
  }

  // ---------------------------------------------------------------- checks

  /** The build and test files as they are on disk now, plus their fingerprint. */
  private async snapshot(root: string): Promise<{ build: WalkedFile[]; tests: WalkedFile[]; fingerprint: string }> {
    const build = await walk(root, isBuildFile)
    const tests = await walk(join(root, 'tests'), p => p.endsWith('.test.js'))
    return { build, tests, fingerprint: fingerprintOf([...build, ...tests.map(t => ({ path: `tests/${t.path}`, data: t.data }))]) }
  }

  /**
   * The end-of-turn evaluation for a bound session: skip when nothing
   * playable changed since the last check, else run the checks, persist the
   * record, and on a pass deploy (auto-confirm) or leave a candidate.
   * @param session - the session whose turn is closing.
   * @param attempt - which automatic fix round this is (0 = the turn's own work).
   * @param cap - the fix-round cap (a failure at the cap is recorded as given up).
   * @returns what the hook should do.
   */
  async checkTurn(session: Session, attempt: number, cap: number): Promise<TurnCheckOutcome> {
    const row = await this.boundProject(session.id)
    if (row === undefined) return { kind: 'skip' }
    const root = row.root
    if (!await stat(join(root, 'index.html')).then(() => true, () => false)) return { kind: 'skip' }
    const { build, tests, fingerprint } = await this.snapshot(root)
    const last = await readJson<CheckRecord>(join(root, STATE_DIR, 'checks.json'))
    if (last?.fingerprint === fingerprint && (last.ok || last.gaveUp === true)) return { kind: 'skip' }

    const failures: CheckFailure[] = []
    const manifestText = await readText(join(root, MANIFEST_FILE))
    const parsed = manifestText === undefined ? undefined : parseManifest(manifestText)
    if (parsed === undefined) failures.push({ where: 'data', message: `${MANIFEST_FILE} 不见了` })
    else if (!parsed.ok) failures.push({ where: 'data', message: parsed.error })
    const kit = kitOf(parsed?.ok === true ? parsed.manifest.runtime : undefined)
    const elementFiles = build.filter(f => f.path.startsWith('elements/') && f.path.endsWith('.json'))
    failures.push(...validateElements(
      Object.fromEntries(elementFiles.map(f => [f.path, f.data.toString('utf8')])),
      parsed?.ok === true ? parsed.manifest.elementTypes : [],
      kit,
    ).failures)
    const browser = await this.checker.run(
      withKitRuntime(bundleOf(build), kit),
      Object.fromEntries(tests.map(t => [`tests/${t.path}`, t.data.toString('utf8')])),
      { blankProbe: kit.blankProbe },
    )
    failures.push(...browser.failures)
    const ok = failures.length === 0
    const record: CheckRecord = {
      fingerprint, at: new Date().toISOString(), ok, failures, passed: browser.passed, attempt,
      ...(browser.skipped === undefined ? {} : { skipped: browser.skipped }),
      ...(!ok && attempt >= cap ? { gaveUp: true } : {}),
    }
    const writable = this.writable(session)
    if (writable) {
      await writeAtomic(join(root, STATE_DIR, 'checks.json'), `${JSON.stringify(record, null, 2)}\n`)
      if (browser.screenshot !== undefined) await writeAtomic(join(root, STATE_DIR, 'last-check.webp'), Buffer.from(browser.screenshot, 'base64'))
    }
    if (!ok) {
      if (record.gaveUp === true) await this.log(root, writable, `检查仍未通过，已停止自动修复（${failures.length} 项）：${failures.slice(0, 2).map(f => f.where).join('、')}`)
      await this.touch(row.id)
      return { kind: 'fail', record }
    }
    if (!writable) return { kind: 'pass', record, deployed: null, candidate: null }
    const version = await this.nextVersion(root)
    await this.copyVersion(root, build, version)
    const user = await this.userLayer(root)
    const restyle = user.restyleTo
    const versionRecord: VersionRecord = {
      version, at: record.at, fingerprint,
      note: restyle !== undefined ? `换成「${artStyleLabel(restyle)}」风格` : browser.passed > 0 ? `通过检查（${browser.passed} 个用例）` : '通过检查',
    }
    await this.appendVersion(root, { ...versionRecord, passed: browser.passed })
    // A restyle always lands as a candidate, whatever auto-confirm says.
    const autoConfirm = (parsed?.ok === true ? parsed.manifest.autoConfirm : true) && restyle === undefined
    if (restyle !== undefined) {
      delete user.restyleTo
      await this.saveUserLayer(root, user)
    }
    if (autoConfirm) {
      await writeAtomic(join(root, STATE_DIR, 'current.json'), `${JSON.stringify(versionRecord, null, 2)}\n`)
      await rm(join(root, STATE_DIR, 'candidate.json'), { force: true })
      await this.log(root, true, `v${version} 通过检查${browser.passed > 0 ? `（${browser.passed} 个用例）` : ''}，已进试玩区`)
    } else {
      await writeAtomic(join(root, STATE_DIR, 'candidate.json'), `${JSON.stringify(versionRecord, null, 2)}\n`)
      await this.log(root, true, `v${version} 通过检查，等用户确认${restyle === undefined ? '' : `（换风格：${artStyleLabel(restyle)}）`}`)
    }
    await this.prune(root)
    await this.touch(row.id)
    return { kind: 'pass', record, deployed: autoConfirm ? versionRecord : null, candidate: autoConfirm ? null : versionRecord }
  }

  private async nextVersion(root: string): Promise<number> {
    const names = await readdir(join(root, STATE_DIR, 'versions')).catch(() => [] as string[])
    const numbers = names.map(Number).filter(n => Number.isInteger(n) && n > 0)
    return (numbers.length === 0 ? 0 : Math.max(...numbers)) + 1
  }

  private async copyVersion(root: string, build: readonly WalkedFile[], version: number): Promise<void> {
    const dir = join(root, STATE_DIR, 'versions', String(version))
    for (const f of build) {
      const target = resolve(dir, f.path)
      if (!inside(dir, target)) continue
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, f.data)
    }
  }

  /** Keep the newest versions plus whatever current/candidate point at. */
  private async prune(root: string): Promise<void> {
    const versionsDir = join(root, STATE_DIR, 'versions')
    const names = (await readdir(versionsDir).catch(() => [] as string[])).map(Number).filter(n => Number.isInteger(n) && n > 0).sort((a, b) => b - a)
    const pinned = new Set<number>()
    for (const which of ['current', 'candidate']) {
      const r = await readJson<VersionRecord>(join(root, STATE_DIR, `${which}.json`))
      if (r !== undefined) pinned.add(r.version)
    }
    for (const n of names.slice(KEEP_VERSIONS)) {
      if (!pinned.has(n)) await rm(join(versionsDir, String(n)), { recursive: true, force: true })
    }
  }

  /** Promote the candidate to current (the user's 确认 when auto-confirm is off). */
  async confirm(projectId: string, session: Session | undefined): Promise<GameResult<{ readonly ok: true; readonly version: number }>> {
    const row = await this.row(projectId)
    if (row === undefined) return { ok: false, error: 'not-found' }
    if (!this.writable(session)) return { ok: false, error: 'denied' }
    const candidate = await readJson<VersionRecord>(join(row.root, STATE_DIR, 'candidate.json'))
    if (candidate === undefined) return { ok: false, error: 'no-version' }
    await writeAtomic(join(row.root, STATE_DIR, 'current.json'), `${JSON.stringify(candidate, null, 2)}\n`)
    await rm(join(row.root, STATE_DIR, 'candidate.json'), { force: true })
    await this.log(row.root, true, `用户确认 v${candidate.version}，已进试玩区`)
    await this.touch(projectId)
    return { ok: true, version: candidate.version }
  }

  /**
   * Turn auto-confirm on or off in `game.json` (the panel's switch). The
   * manifest is the project's own file, so this goes through node behind the
   * same writable check.
   */
  async setAutoConfirm(projectId: string, on: boolean, session: Session | undefined): Promise<GameResult> {
    const row = await this.row(projectId)
    if (row === undefined) return { ok: false, error: 'not-found' }
    if (!this.writable(session)) return { ok: false, error: 'denied' }
    const text = await readText(join(row.root, MANIFEST_FILE))
    const parsed = text === undefined ? undefined : parseManifest(text)
    if (parsed === undefined || !parsed.ok) return { ok: false, error: 'invalid' }
    await writeAtomic(join(row.root, MANIFEST_FILE), serializeManifest({ ...parsed.manifest, autoConfirm: on }))
    await this.touch(projectId)
    return { ok: true }
  }

  /** Throw the candidate away (the user's 退回); the model hears about it on the next send. */
  async reject(projectId: string, reason: string, session: Session | undefined): Promise<GameResult> {
    const row = await this.row(projectId)
    if (row === undefined) return { ok: false, error: 'not-found' }
    if (!this.writable(session)) return { ok: false, error: 'denied' }
    const candidate = await readJson<VersionRecord>(join(row.root, STATE_DIR, 'candidate.json'))
    if (candidate === undefined) return { ok: false, error: 'no-version' }
    await rm(join(row.root, STATE_DIR, 'candidate.json'), { force: true })
    await this.updateVersions(row.root, list => list.map(v => (v.version === candidate.version ? { ...v, rejected: true } : v)))
    const why = reason.trim().slice(0, 200)
    await this.log(row.root, true, `用户退回 v${candidate.version}${why === '' ? '' : `：${why}`}`)
    await this.addPending(row.root, { key: `reject:${candidate.version}`, text: `退回了候选 v${candidate.version}${why === '' ? '' : `（${why}）`}，试玩区仍是上一版` })
    await this.touch(projectId)
    return { ok: true }
  }

  /** Put an older version back into the play area. */
  async rollback(projectId: string, version: number, session: Session | undefined): Promise<GameResult> {
    const row = await this.row(projectId)
    if (row === undefined) return { ok: false, error: 'not-found' }
    if (!this.writable(session)) return { ok: false, error: 'denied' }
    const entry = (await this.readVersions(row.root)).find(v => v.version === version)
    const exists = await stat(join(row.root, STATE_DIR, 'versions', String(version))).then(() => true, () => false)
    if (entry === undefined || !exists) return { ok: false, error: 'no-version' }
    const { passed: _passed, rejected: _rejected, ...record } = entry
    await writeAtomic(join(row.root, STATE_DIR, 'current.json'), `${JSON.stringify(record, null, 2)}\n`)
    await this.log(row.root, true, `试玩区切回 v${version}`)
    await this.addPending(row.root, { key: 'rollback', text: `把试玩区切回了 v${version}（工作目录里的代码没动）` })
    await this.touch(projectId)
    return { ok: true }
  }

  /** Files that differ between two versions' snapshots. */
  async diff(projectId: string, from: number, to: number): Promise<GameResult<{ readonly ok: true; readonly diff: VersionDiff }>> {
    const row = await this.row(projectId)
    if (row === undefined) return { ok: false, error: 'not-found' }
    const hashes = async (version: number): Promise<Map<string, string> | undefined> => {
      const dir = join(row.root, STATE_DIR, 'versions', String(version))
      if (!await stat(dir).then(() => true, () => false)) return undefined
      return new Map((await walk(dir, () => true)).map(f => [f.path, createHash('sha1').update(f.data).digest('hex')]))
    }
    const a = await hashes(from), b = await hashes(to)
    if (a === undefined || b === undefined) return { ok: false, error: 'no-version' }
    return {
      ok: true,
      diff: {
        added: [...b.keys()].filter(k => !a.has(k)),
        removed: [...a.keys()].filter(k => !b.has(k)),
        changed: [...b.keys()].filter(k => a.has(k) && a.get(k) !== b.get(k)),
      },
    }
  }

  // ---------------------------------------------------------------- user layer

  private async userLayer(root: string): Promise<UserLayer> {
    const raw = await readJson<Partial<UserLayer>>(join(root, STATE_DIR, 'user.json'))
    return {
      params: raw?.params !== null && typeof raw?.params === 'object' ? { ...raw.params } : {},
      // `param:` entries came from the retired slider auto-pending (a slider is a trial now).
      pending: Array.isArray(raw?.pending) ? raw.pending.filter(p => typeof p?.key === 'string' && typeof p.text === 'string' && !p.key.startsWith('param:')) : [],
      ...(typeof raw?.restyleTo === 'string' ? { restyleTo: raw.restyleTo } : {}),
    }
  }

  private async saveUserLayer(root: string, user: UserLayer): Promise<void> {
    await writeAtomic(join(root, STATE_DIR, 'user.json'), `${JSON.stringify(user, null, 2)}\n`)
  }

  /** Add (or replace by key) one pending change; `text: ''` removes it. */
  private async addPending(root: string, change: PendingChange): Promise<void> {
    const user = await this.userLayer(root)
    user.pending = user.pending.filter(p => p.key !== change.key)
    if (change.text !== '') user.pending.push(change)
    await this.saveUserLayer(root, user)
  }

  /** Drop one pending change by key (the dock's ×). */
  async dropPending(projectId: string, key: string, session: Session | undefined): Promise<GameResult> {
    const row = await this.row(projectId)
    if (row === undefined) return { ok: false, error: 'not-found' }
    if (!this.writable(session)) return { ok: false, error: 'denied' }
    await this.addPending(row.root, { key, text: '' })
    this.notify(projectId)
    return { ok: true }
  }

  /**
   * The user sent a message carrying the panel's change list (it starts
   * with {@link PANEL_CHANGES_MARK}): drop exactly the changes it lists.
   * Changes made after the list was written stay pending.
   * @param sessionId - the sending session.
   * @param text - the user message's text.
   * @returns how many changes were cleared.
   */
  async clearSent(sessionId: string, text: string): Promise<number> {
    if (!text.includes(PANEL_CHANGES_MARK)) return 0
    const row = await this.boundProject(sessionId)
    if (row === undefined) return 0
    const user = await this.userLayer(row.root)
    const kept = user.pending.filter(p => !text.includes(p.text))
    const cleared = user.pending.length - kept.length
    if (cleared === 0) return 0
    user.pending = kept
    await this.saveUserLayer(row.root, user)
    this.notify(row.id)
    return cleared
  }

  /** The manifest of a project, or undefined. */
  private async manifestOf(root: string): Promise<GameManifest | undefined> {
    const text = await readText(join(root, MANIFEST_FILE))
    const parsed = text === undefined ? undefined : parseManifest(text)
    return parsed?.ok === true ? parsed.manifest : undefined
  }

  /** Set one slider value (user layer; the play frame gets it live from the panel). */
  async setParam(projectId: string, key: string, value: number, session: Session | undefined): Promise<GameResult> {
    const row = await this.row(projectId)
    if (row === undefined) return { ok: false, error: 'not-found' }
    if (!this.writable(session)) return { ok: false, error: 'denied' }
    const manifest = await this.manifestOf(row.root)
    const param = manifest?.params.find(p => p.key === key)
    if (param === undefined || !Number.isFinite(value)) return { ok: false, error: 'invalid' }
    const clamped = Math.min(param.max, Math.max(param.min, value))
    const user = await this.userLayer(row.root)
    if (clamped === param.value) delete user.params[key]
    else user.params[key] = clamped
    // A slider is a trial (2026-10-10): it changes the running game only. The
    // agent hears about it when the user says so (告诉 agent) or finalizes.
    await this.saveUserLayer(row.root, user)
    this.notify(projectId)
    return { ok: true }
  }

  /** 定稿: write the slider values into game.json as the new defaults. */
  async finalizeParams(projectId: string, session: Session | undefined): Promise<GameResult> {
    const row = await this.row(projectId)
    if (row === undefined) return { ok: false, error: 'not-found' }
    if (!this.writable(session)) return { ok: false, error: 'denied' }
    const manifest = await this.manifestOf(row.root)
    if (manifest === undefined) return { ok: false, error: 'invalid' }
    const user = await this.userLayer(row.root)
    const changed = manifest.params.filter(p => user.params[p.key] !== undefined && user.params[p.key] !== p.value)
    if (changed.length === 0) return { ok: true }
    const params = manifest.params.map(p => (user.params[p.key] === undefined ? p : { ...p, value: user.params[p.key]! }))
    await writeAtomic(join(row.root, MANIFEST_FILE), serializeManifest({ ...manifest, params }))
    const summary = changed.map(p => `${p.label} ${num(p.value)}→${num(user.params[p.key]!)}`).join('、')
    user.params = {}
    user.pending = user.pending.filter(p => !p.key.startsWith('param:'))
    user.pending.push({ key: 'params-final', text: `定稿参数：${summary}（已写进 game.json）` })
    await this.saveUserLayer(row.root, user)
    await this.log(row.root, true, `定稿参数：${summary}`)
    await this.touch(projectId)
    return { ok: true }
  }

  /** 还原: drop every slider override. */
  async resetParams(projectId: string, session: Session | undefined): Promise<GameResult> {
    const row = await this.row(projectId)
    if (row === undefined) return { ok: false, error: 'not-found' }
    if (!this.writable(session)) return { ok: false, error: 'denied' }
    const user = await this.userLayer(row.root)
    user.params = {}
    user.pending = user.pending.filter(p => !p.key.startsWith('param:'))
    await this.saveUserLayer(row.root, user)
    this.notify(projectId)
    return { ok: true }
  }

  /**
   * Edit one element in place — its look, or scalar fields. The edit lands
   * in the working file AND in the version on the play area, so it shows at
   * once; it rides the next send as a pending change.
   */
  async editElement(
    projectId: string,
    elementId: string,
    patch: { look?: unknown; fields?: Record<string, string | number | boolean | null> },
    session: Session | undefined,
    note?: string,
  ): Promise<GameResult<{ readonly ok: true; readonly element: Record<string, unknown> }>> {
    const row = await this.row(projectId)
    if (row === undefined) return { ok: false, error: 'not-found' }
    if (!this.writable(session)) return { ok: false, error: 'denied' }
    const files = await walk(join(row.root, 'elements'), p => p.endsWith('.json'))
    const changes: Record<string, unknown> = {}
    if (patch.look !== undefined) {
      const look = (await this.kitFor(row.root)).normalizeLook(patch.look)
      if (look === null) return { ok: false, error: 'invalid' }
      changes.look = look
    }
    for (const [key, value] of Object.entries(patch.fields ?? {})) {
      if (key === 'id' || key === 'look' || key.length > 40) continue
      changes[key] = value === null ? undefined : value
    }
    for (const f of files) {
      const next = patchElementText(f.data.toString('utf8'), elementId, changes)
      if (next === undefined) continue
      const rel = `elements/${f.path}`
      await writeAtomic(join(row.root, rel), next)
      const current = await readJson<VersionRecord>(join(row.root, STATE_DIR, 'current.json'))
      if (current !== undefined) {
        const copy = join(row.root, STATE_DIR, 'versions', String(current.version), rel)
        const copied = await readText(copy)
        const patched = copied === undefined ? undefined : patchElementText(copied, elementId, changes)
        if (patched !== undefined) await writeAtomic(copy, patched)
      }
      const parsed = JSON.parse(next) as unknown
      const element = (Array.isArray(parsed) ? parsed : [parsed]).find(e => (e as { id?: unknown }).id === elementId) as Record<string, unknown>
      const name = typeof element.name === 'string' ? element.name : elementId
      if (changes.look !== undefined) {
        await this.addPending(row.root, { key: `look:${elementId}`, text: note ?? `改了「${name}」的外观（elements 文件里的 look 已更新）` })
      }
      const fieldKeys = Object.keys(changes).filter(k => k !== 'look')
      if (fieldKeys.length > 0) {
        await this.addPending(row.root, {
          key: `fields:${elementId}`,
          text: `改了「${name}」的字段：${fieldKeys.map(k => `${k}=${changes[k] === undefined ? '（删除）' : String(changes[k])}`).join('、')}`,
        })
      }
      await this.log(row.root, true, note ?? `用户编辑了元素「${name}」`)
      await this.touch(projectId)
      return { ok: true, element }
    }
    return { ok: false, error: 'not-found' }
  }

  /** Write one design chapter (the user's direct edit). */
  async writeChapter(projectId: string, chapterId: string, text: string, session: Session | undefined): Promise<GameResult> {
    const row = await this.row(projectId)
    if (row === undefined) return { ok: false, error: 'not-found' }
    if (!this.writable(session)) return { ok: false, error: 'denied' }
    const spec = CHAPTERS.find(c => c.id === chapterId)
    if (spec === undefined || spec.generated === true) return { ok: false, error: 'invalid' }
    await writeAtomic(join(row.root, spec.file), text.endsWith('\n') ? text : `${text}\n`)
    await this.addPending(row.root, { key: `design:${chapterId}`, text: `直接改了策划《${spec.title}》（${spec.file}），以文件为准` })
    await this.touch(projectId)
    return { ok: true }
  }

  /** Edit the one-pager in game.json (pitch, element types, pillars) — the user's direct edit. */
  async setOnePager(projectId: string, patch: { pitch?: string; elementTypes?: string; pillars?: string }, session: Session | undefined): Promise<GameResult> {
    const row = await this.row(projectId)
    if (row === undefined) return { ok: false, error: 'not-found' }
    if (!this.writable(session)) return { ok: false, error: 'denied' }
    const manifest = await this.manifestOf(row.root)
    if (manifest === undefined) return { ok: false, error: 'invalid' }
    const pitch = patch.pitch === undefined ? manifest.pitch : patch.pitch.trim().slice(0, 400)
    const elementTypes = patch.elementTypes === undefined ? manifest.elementTypes : listOf(patch.elementTypes).slice(0, 12)
    const pillars = patch.pillars === undefined ? manifest.pillars : listOf(patch.pillars.split(/\n/)).slice(0, 5)
    if (pitch === '' || elementTypes.length === 0) return { ok: false, error: 'invalid' }
    const parts: string[] = []
    if (pitch !== manifest.pitch) parts.push(`玩法「${pitch}」`)
    if (elementTypes.join('、') !== manifest.elementTypes.join('、')) parts.push(`元素类型 ${elementTypes.join('、')}`)
    if (pillars.join('；') !== manifest.pillars.join('；')) parts.push(`支柱 ${pillars.map((p, i) => `${i + 1}.${p}`).join(' ')}`)
    if (parts.length === 0) return { ok: true }
    await writeAtomic(join(row.root, MANIFEST_FILE), serializeManifest({ ...manifest, pitch, elementTypes, pillars }))
    await this.addPending(row.root, { key: 'onepager', text: `改了一页纸（game.json）：${parts.join('；')}` })
    await this.log(row.root, true, `用户改了一页纸：${parts.join('；')}`)
    await this.touch(projectId)
    return { ok: true }
  }

  /** Ask for a restyle: the next passing version becomes a candidate. The panel puts the request into the composer. */
  async requestRestyle(projectId: string, styleId: string, session: Session | undefined): Promise<GameResult> {
    const row = await this.row(projectId)
    if (row === undefined) return { ok: false, error: 'not-found' }
    if (!this.writable(session)) return { ok: false, error: 'denied' }
    const style = resolveArtStyle(styleId)
    if (style === undefined) return { ok: false, error: 'invalid' }
    const user = await this.userLayer(row.root)
    user.restyleTo = style
    await this.saveUserLayer(row.root, user)
    this.notify(projectId)
    return { ok: true }
  }

  // ---------------------------------------------------------------- appearance proposals

  private async proposals(root: string): Promise<LookProposal[]> {
    const list = await readJson<LookProposal[]>(join(root, STATE_DIR, 'proposals.json'))
    return Array.isArray(list) ? list.slice(-12).reverse() : []
  }

  /**
   * Store up to 3 appearance variants for an element (the `game_propose`
   * tool); the user picks one in the panel.
   */
  async proposeLooks(
    sessionId: string,
    elementId: string,
    request: string,
    variants: readonly { label?: string; note?: string; look: unknown }[],
  ): Promise<{ ok: true; count: number; name: string } | { ok: false; error: string }> {
    const row = await this.boundProject(sessionId)
    if (row === undefined) return { ok: false, error: '本会话还没有游戏项目' }
    const view = await this.view(row.id)
    const element = view?.elements.find(e => e.id === elementId)
    if (element === undefined) return { ok: false, error: `没有 id 为「${elementId}」的元素` }
    const clean: { label: string; note: string; look: AnyLook }[] = []
    const bad: number[] = []
    const kit = await this.kitFor(row.root)
    variants.slice(0, 3).forEach((v, i) => {
      const look = kit.normalizeLook(v.look)
      if (look === null) bad.push(i + 1)
      else clean.push({ label: (v.label ?? '').trim().slice(0, 20) || 'ABC'[i]!, note: (v.note ?? '').trim().slice(0, 120), look })
    })
    if (clean.length === 0) return { ok: false, error: `方案都不可用（第 ${bad.join('、')} 个）：${kit.lookHint}` }
    const all = await readJson<LookProposal[]>(join(row.root, STATE_DIR, 'proposals.json'))
    const list = (Array.isArray(all) ? all : []).filter(p => !(p.elementId === elementId && p.picked === undefined))
    list.push({ elementId, at: new Date().toISOString(), request: request.trim().slice(0, 200), variants: clean })
    await writeAtomic(join(row.root, STATE_DIR, 'proposals.json'), `${JSON.stringify(list.slice(-20), null, 2)}\n`)
    await this.touch(row.id)
    return { ok: true, count: clean.length, name: element.name }
  }

  /** The user picks a variant: it replaces the element's look at once; the others stay in the history. */
  async pickProposal(projectId: string, elementId: string, at: string, index: number, session: Session | undefined): Promise<GameResult> {
    const row = await this.row(projectId)
    if (row === undefined) return { ok: false, error: 'not-found' }
    const all = await readJson<LookProposal[]>(join(row.root, STATE_DIR, 'proposals.json'))
    const list = Array.isArray(all) ? all : []
    const proposal = list.find(p => p.elementId === elementId && p.at === at)
    const variant = proposal?.variants[index]
    if (proposal === undefined || variant === undefined) return { ok: false, error: 'not-found' }
    const edited = await this.editElement(projectId, elementId, { look: variant.look }, session,
      `外观方案：用户选了「${variant.label}」${variant.note === '' ? '' : `（${variant.note}）`}，已替换进游戏`)
    if (!edited.ok) return edited
    await writeAtomic(join(row.root, STATE_DIR, 'proposals.json'),
      `${JSON.stringify(list.map(p => (p === proposal ? { ...p, picked: index } : p)), null, 2)}\n`)
    this.notify(projectId)
    return { ok: true }
  }

  // ---------------------------------------------------------------- versions

  private async readVersions(root: string): Promise<VersionEntry[]> {
    const list = await readJson<VersionEntry[]>(join(root, STATE_DIR, 'versions.json'))
    return Array.isArray(list) ? list.filter(v => typeof v?.version === 'number') : []
  }

  private async updateVersions(root: string, change: (list: VersionEntry[]) => VersionEntry[]): Promise<void> {
    await writeAtomic(join(root, STATE_DIR, 'versions.json'), `${JSON.stringify(change(await this.readVersions(root)), null, 2)}\n`)
  }

  private async appendVersion(root: string, entry: VersionEntry): Promise<void> {
    await this.updateVersions(root, list => [...list.filter(v => v.version !== entry.version), entry].slice(-50))
  }

  /** The 版本 view's rows, newest first: only versions whose snapshot still exists. */
  private async versionRows(root: string): Promise<VersionRow[]> {
    const current = await readJson<VersionRecord>(join(root, STATE_DIR, 'current.json'))
    const candidate = await readJson<VersionRecord>(join(root, STATE_DIR, 'candidate.json'))
    const kept = new Set((await readdir(join(root, STATE_DIR, 'versions')).catch(() => [] as string[])).map(Number))
    return (await this.readVersions(root)).filter(v => kept.has(v.version)).reverse().map(v => ({
      version: v.version, at: v.at, fingerprint: v.fingerprint,
      ...(v.note === undefined ? {} : { note: v.note }),
      ...(v.passed === undefined ? {} : { passed: v.passed }),
      status: v.version === current?.version ? 'current' : v.version === candidate?.version ? 'candidate' : v.rejected === true ? 'rejected' : 'past',
    }))
  }

  /** The last check's screenshot (webp, base64), if any. */
  async checkShot(projectId: string): Promise<GameResult<{ readonly ok: true; readonly webp: string }>> {
    const row = await this.row(projectId)
    if (row === undefined) return { ok: false, error: 'not-found' }
    const data = await readFile(join(row.root, STATE_DIR, 'last-check.webp')).catch(() => undefined)
    return data === undefined ? { ok: false, error: 'no-version' } : { ok: true, webp: data.toString('base64') }
  }

  // ---------------------------------------------------------------- playtest log

  /** Append one line to the project's playtest log (`.game/playtest-log.jsonl`). */
  private async log(root: string, writable: boolean, text: string): Promise<void> {
    if (!writable) return
    const path = join(root, STATE_DIR, 'playtest-log.jsonl')
    await mkdir(dirname(path), { recursive: true })
    await appendFile(path, `${JSON.stringify({ at: new Date().toISOString(), text })}\n`).catch(() => {})
  }

  /** Record what the panel saw during one play session (errors, length). */
  async logPlay(projectId: string, entry: { version: number; seconds: number; errors: readonly string[] }, session: Session | undefined): Promise<GameResult> {
    const row = await this.row(projectId)
    if (row === undefined) return { ok: false, error: 'not-found' }
    const seconds = Math.max(0, Math.round(entry.seconds))
    const errors = entry.errors.slice(0, 3).map(e => String(e).slice(0, 160))
    const text = errors.length === 0
      ? `试玩 v${entry.version} ${seconds} 秒，无报错`
      : `试玩 v${entry.version} ${seconds} 秒，报错 ${entry.errors.length} 次：${errors.join('；')}`
    await this.log(row.root, this.writable(session), text)
    this.notify(projectId)
    return { ok: true }
  }

  /** The playtest log, newest first (last 60). */
  private async logEntries(root: string): Promise<LogEntry[]> {
    const text = await readText(join(root, STATE_DIR, 'playtest-log.jsonl'))
    if (text === undefined) return []
    return text.split('\n').filter(Boolean).map(line => {
      try {
        return JSON.parse(line) as LogEntry
      } catch {
        return undefined
      }
    }).filter((r): r is LogEntry => r !== undefined && typeof r.text === 'string').slice(-60).reverse()
  }

  /** The generated 试玩记录 chapter, newest first. */
  private async playtestText(root: string): Promise<string> {
    const rows = (await this.logEntries(root)).slice(0, 40)
    if (rows.length === 0) return ''
    const local = (iso: string): string => {
      const d = new Date(iso)
      const pad = (n: number) => String(n).padStart(2, '0')
      return Number.isNaN(d.getTime()) ? iso : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    }
    return ['# 试玩记录', '', ...rows.map(r => `- ${local(r.at)} ${r.text}`), ''].join('\n')
  }
}
