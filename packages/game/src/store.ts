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
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.fs service merge.
import type {} from '@deepseek-ai/dsh-fs'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import type { Session } from '@deepseek-ai/dsh-session'
import { ChromeChecker, type BrowserChecker } from './checks.ts'
import {
  chapterStatus, elementsChapter, gate, isBuildFile, isTextFile, mimeOf, parseManifest, pillarsChapter,
  serializeManifest, slugOf, validateElements, type CreateRequest,
} from './project.ts'
import {
  CHAPTERS, MANIFEST_FILE, STATE_DIR,
  type BundleFile, type ChapterView, type CheckFailure, type CheckRecord, type GameManifest, type GameResult,
  type PlayBundle, type ProjectRow, type ProjectView, type SessionGameState, type VersionRecord,
} from './types.ts'

/** Plugin config; every key optional. */
export interface GameConfig {
  /** Registry root override (default `$DSH_HOME/state/game`). */
  stateRoot?: string
  /** Chrome executable for the checks (default: `CHROME_PATH`, then common install paths). */
  chromePath?: string
}

/** Versions kept under `.game/versions/`; older ones are pruned. */
const KEEP_VERSIONS = 5
/** Walk limits for one project read: enough for a small game, bounded for a stray huge folder. */
const MAX_FILES = 600
const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_TOTAL_BYTES = 48 * 1024 * 1024

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

/** Whether `child` is `parent` or inside it. */
function inside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Write a file atomically (tmp + rename), creating its directory. */
async function writeAtomic(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, path)
}

/** Read a text file, undefined when absent or unreadable. */
async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return undefined
  }
}

/** Read JSON, undefined when absent or broken. */
async function readJson<T>(path: string): Promise<T | undefined> {
  const text = await readText(path)
  if (text === undefined) return undefined
  try {
    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}

/** One walked file: project-relative POSIX path plus its bytes. */
interface WalkedFile {
  readonly path: string
  readonly data: Buffer
}

/**
 * Walk a directory (dot-entries skipped), bounded by the walk limits.
 * @param root - directory to walk.
 * @param keep - project-relative path filter.
 * @returns the files, sorted by path.
 */
async function walk(root: string, keep: (path: string) => boolean): Promise<WalkedFile[]> {
  const out: WalkedFile[] = []
  let total = 0
  const visit = async (dir: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= MAX_FILES || entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const full = join(dir, entry.name)
      const rel = relative(root, full).split(sep).join('/')
      if (entry.isDirectory()) {
        await visit(full)
        continue
      }
      if (!entry.isFile() || !keep(rel)) continue
      const info = await stat(full).catch(() => undefined)
      if (info === undefined || info.size > MAX_FILE_BYTES || total + info.size > MAX_TOTAL_BYTES) continue
      total += info.size
      out.push({ path: rel, data: await readFile(full) })
    }
  }
  await visit(root)
  return out
}

/** The sandbox bundle form of walked files. */
function bundleOf(files: readonly WalkedFile[]): Record<string, BundleFile> {
  const out: Record<string, BundleFile> = {}
  for (const f of files) {
    out[f.path] = isTextFile(f.path)
      ? { type: mimeOf(f.path), text: f.data.toString('utf8') }
      : { type: mimeOf(f.path), b64: f.data.toString('base64') }
  }
  return out
}

/** A content fingerprint over (path, bytes) pairs. */
function fingerprintOf(files: readonly WalkedFile[]): string {
  const hash = createHash('sha1')
  for (const f of files) {
    hash.update(f.path)
    hash.update('\0')
    hash.update(createHash('sha1').update(f.data).digest())
  }
  return hash.digest('hex').slice(0, 16)
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
      await this.writeFenced(join(root, 'design', 'pillars.md'), pillarsChapter(manifest), session)
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
    )
    const playtest = await this.playtestText(row.root)
    const chapters: ChapterView[] = []
    for (const spec of CHAPTERS) {
      const text = spec.id === 'elements'
        ? elementsChapter(elements, manifest?.elementTypes ?? [])
        : spec.id === 'playtest' ? playtest : (await readText(join(row.root, spec.file))) ?? ''
      chapters.push({
        id: spec.id, title: spec.title, file: spec.file, text, generated: spec.generated === true,
        status: spec.generated === true ? (text === '' ? 'todo' : 'draft') : chapterStatus(text),
      })
    }
    const state = join(row.root, STATE_DIR)
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
    return { ok: true, bundle: { projectId, version: record.version, files: bundleOf(files) } }
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
    const elementFiles = build.filter(f => f.path.startsWith('elements/') && f.path.endsWith('.json'))
    failures.push(...validateElements(
      Object.fromEntries(elementFiles.map(f => [f.path, f.data.toString('utf8')])),
      parsed?.ok === true ? parsed.manifest.elementTypes : [],
    ).failures)
    const browser = await this.checker.run(bundleOf(build), Object.fromEntries(tests.map(t => [`tests/${t.path}`, t.data.toString('utf8')])))
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
    const versionRecord: VersionRecord = { version, at: record.at, fingerprint }
    const autoConfirm = parsed?.ok === true ? parsed.manifest.autoConfirm : true
    if (autoConfirm) {
      await writeAtomic(join(root, STATE_DIR, 'current.json'), `${JSON.stringify(versionRecord, null, 2)}\n`)
      await rm(join(root, STATE_DIR, 'candidate.json'), { force: true })
      await this.log(root, true, `v${version} 通过检查${browser.passed > 0 ? `（${browser.passed} 个用例）` : ''}，已进试玩区`)
    } else {
      await writeAtomic(join(root, STATE_DIR, 'candidate.json'), `${JSON.stringify(versionRecord, null, 2)}\n`)
      await this.log(root, true, `v${version} 通过检查，等用户确认`)
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

  /** The generated 试玩记录 chapter, newest first. */
  private async playtestText(root: string): Promise<string> {
    const text = await readText(join(root, STATE_DIR, 'playtest-log.jsonl'))
    if (text === undefined) return ''
    const rows = text.split('\n').filter(Boolean).map(line => {
      try {
        return JSON.parse(line) as { at: string; text: string }
      } catch {
        return undefined
      }
    }).filter((r): r is { at: string; text: string } => r !== undefined).slice(-40).reverse()
    if (rows.length === 0) return ''
    const local = (iso: string): string => {
      const d = new Date(iso)
      const pad = (n: number) => String(n).padStart(2, '0')
      return Number.isNaN(d.getTime()) ? iso : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    }
    return ['# 试玩记录', '', ...rows.map(r => `- ${local(r.at)} ${r.text}`), ''].join('\n')
  }
}
