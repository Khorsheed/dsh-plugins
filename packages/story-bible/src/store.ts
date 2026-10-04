/**
 * The story-bible's service core (`ctx.storyBible`): the work registry plus
 * every per-work document under `$DSH_HOME/state/story/`. The state root is
 * deployment-level state, NOT a session workspace, and the fence reflects
 * that — the canvas store's exact pattern: the CALLING session resolves the
 * MODE (a read-only deployment stays read-only) and lends its id to the
 * write, while the writable boundary re-roots at the plugin's own state dir.
 * Every document write goes through the mounted `ctx.fs` under a version
 * guard (read → apply → replaceIfVersion, one stale retry); the two JSONL
 * journals append by guarded read-concat-write, so a lost race retries
 * instead of clobbering (ctx.fs has no append verb; bare node:fs is never
 * used for state).
 *
 * The per-session focus map ({sessionId → workId, title}) is in-memory only:
 * a restart means "nothing focused yet", which the tools and the pointer
 * section answer honestly. The title rides the map entry (captured at focus
 * time) so the synchronous pointer section never touches the filesystem.
 *
 * @module @khorsheed/dsh-story-bible
 */
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { FsError, FsVersion, type FsTarget } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import type { Session } from '@deepseek-ai/dsh-session'
import { renderExtractBrief, type BriefData } from './brief.ts'
import {
  chapterFileName, effectiveChapterPhase, foreshadowIdOf, makeWorkId, memoryNumberOf, normalizeChapter,
  normalizeCharacter, normalizeMemory, normalizePendingItem, normalizePlan, normalizeWorkId, sanitizeWorkTitle,
  cleanText,
  type ChapterRecord, type ChapterTable, type CharacterRecord, type CharacterTable,
  type EffectiveChapterPhase, type ExperienceEntry, type ExtractPayload, type ForeshadowOp, type ImportDrop,
  type ImportReport, type LedgerResult, type MemoryRecord, type MemoryTable,
  type MentionEntry, type PatchMemoryRequest, type PendingItem, type PendingKind, type PendingPayload, type PendingTable,
  type ForeshadowExitAction, type ReviewAction, type StoryError,
  type WorkIndexEntry, type WorkInfo, type WorkMeta, type WriteChapterRequest, type WriteCharacterRequest,
  type WriteMemoryRequest,
} from './types.ts'

/** The state directory name under `$DSH_HOME/state`. */
export const STORY_STATE_DIR_NAME = 'story'

/** The registry file at the state root. */
export const WORK_INDEX_FILE = 'index.json'

/** Per-work file names (proposal §2). */
export const WORK_FILES = {
  meta: 'work.json',
  memories: 'memories.json',
  characters: 'characters.json',
  experiences: 'experiences.jsonl',
  mentions: 'mentions.jsonl',
  chapters: 'chapters.json',
  pending: 'pending.json',
} as const

/**
 * Resolve the story state root (the canvas/datasets precedent): an explicit
 * value wins, then `$DSH_HOME/state/story`, then `<cwd>/.dsh-story`.
 * @param configured - plugin-provided override, or ''/undefined.
 * @returns the state root directory.
 */
export function resolveStoryStateRoot(configured: string | undefined): string {
  if (configured !== undefined && configured !== '') return configured
  const home = process.env.DSH_HOME
  if (home !== undefined && home !== '') return join(home, 'state', STORY_STATE_DIR_NAME)
  return join(process.cwd(), '.dsh-story')
}

/** Map one thrown fs value onto the store's failure codes. */
export function storyErrorOf(error: unknown): StoryError {
  if (error instanceof FsError) {
    if (error.code === 'FS_STALE_VERSION' || error.code === 'FS_NOT_OBSERVED') return 'stale'
    if (error.code === 'FS_SANDBOX_DENIED') return 'denied'
    if (error.code === 'FS_NOT_FOUND') return 'missing'
  }
  return 'io'
}

/** Plugin config for the story service; every key is optional. */
export interface StoryBibleConfig {
  /** State root override (defaults to `$DSH_HOME/state/story`). */
  stateRoot?: string
}

/** One document read: the data plus the freshness token, or which way it failed. */
type DocumentRead<T> = { readonly data: T; readonly version: string } | 'missing' | 'corrupt'

/** One mutation's receipt. */
type Mutation<T> = { readonly ok: true; readonly data: T; readonly created: boolean } | { readonly ok: false; readonly error: StoryError }

/** Foreshadow mentions: plan op verb → journal kind. */
const OP_TO_MENTION: Readonly<Record<ForeshadowOp['op'], MentionEntry['kind']>> = {
  '推进': 'advanced',
  '暗示': 'hinted',
  '新埋': 'planted',
  '揭晓': 'resolved',
}

/** A mention's evidence grep: exact substring first, then a whitespace-tolerant pass (line wraps are not fabrication). */
export function evidenceInBody(body: string, evidence: string | undefined): boolean {
  if (evidence === undefined) return false
  const needle = evidence.trim()
  if (needle.length === 0) return false
  if (body.includes(needle)) return true
  const squash = (text: string): string => text.replace(/\s+/g, ' ')
  return squash(body).includes(squash(needle))
}

/**
 * The story-bible's service core. Stateless apart from the context it borrows
 * for `ctx.fs`, the policy home it resolves each caller's mode through, and
 * the process-lifetime focus map.
 */
export class StoryBibleService {
  static inject = ['fs']

  /** The resolved state root (also the writable boundary of every fence). */
  readonly stateRoot: string

  /** The per-session policy home, captured only when the mounted filesystem actually confines. */
  private readonly sandboxPolicy: SandboxPolicyService | undefined

  /** The per-session focus map: which work this session writes into (title cached for the sync pointer). */
  private readonly focused = new Map<string, { readonly workId: string; readonly title: string }>()

  /**
   * @param ctx - host context carrying the mounted filesystem.
   * @param config - optional state-root override.
   */
  constructor(
    private readonly ctx: Context,
    config: StoryBibleConfig = {},
  ) {
    this.stateRoot = resolveStoryStateRoot(config.stateRoot)
    this.sandboxPolicy = ctx.fs.sandboxMode === undefined ? undefined : ctx.get('sandboxPolicy')
  }

  private get fs(): Context['fs'] {
    return this.ctx.fs
  }

  /**
   * The policy one mutation carries: the caller's session resolves the MODE
   * and stamps its id, but the writable boundary is the plugin's state root —
   * a session's own workspace can never hold deployment-level state (the
   * canvas store's re-rooted fence). `undefined` means the mounted backend
   * does not confine.
   * @param session - the session that owns the gesture.
   * @returns the policy to stamp onto the call.
   */
  private policyOf(session: Session): SandboxExecutionPolicy | undefined {
    const resolved = this.sandboxPolicy?.resolve({ session })
    if (resolved === undefined) return undefined
    return { ...resolved, workspaceRoot: this.stateRoot }
  }

  /** One work's directory under the state root. */
  private workDir(workId: string): string {
    return join(this.stateRoot, workId)
  }

  /** One per-work file's target. */
  private async fileTarget(workId: string, file: string): Promise<FsTarget> {
    return this.fs.resolve(file, { cwd: this.workDir(workId) })
  }

  /** The registry's target. */
  private async indexTarget(): Promise<FsTarget> {
    return this.fs.resolve(WORK_INDEX_FILE, { cwd: this.stateRoot })
  }

  /** The manuscript file one chapter record points at (`<workspace>/<title>/第{n}章.md`, the single source of truth). */
  private bodyPath(work: WorkMeta, chapter: ChapterRecord): string {
    return join(work.workspace, work.title, chapter.file)
  }

  /**
   * Read one JSON document: the normalized data plus the freshness token, or
   * which way it failed. A corrupt or foreign file is NEVER rewritten from
   * this read — mutations refuse it rather than clobber something they cannot
   * understand (the canvas rule).
   */
  private async readJson<T>(target: FsTarget, normalize: (raw: unknown) => T | undefined): Promise<DocumentRead<T>> {
    try {
      const info = await this.fs.stat(target)
      if (info === undefined) return 'missing'
      let parsed: unknown
      try {
        parsed = JSON.parse(await this.fs.readText(target))
      } catch {
        return 'corrupt'
      }
      const data = normalize(parsed)
      return data === undefined ? 'corrupt' : { data, version: info.version }
    } catch (error) {
      if (error instanceof FsError && error.code === 'FS_NOT_FOUND') return 'missing'
      return 'corrupt'
    }
  }

  /**
   * The one place a JSON document is mutated: read, apply, write back under
   * the version from the read — one stale retry, never an unconditional
   * overwrite (the canvas mutate). A missing document is created only when
   * the caller passes a factory; a create-race retries exactly like a stale
   * write.
   * @param target - the resolved file target.
   * @param session - the session that owns the gesture; supplies the fence.
   * @param normalize - the document's tolerant reader.
   * @param createDefault - the factory for a missing document, or undefined to refuse missing.
   * @param change - the pure data-to-data edit, or an error code to refuse.
   */
  private async mutateJson<T extends object>(
    target: FsTarget,
    session: Session,
    normalize: (raw: unknown) => T | undefined,
    createDefault: (() => T) | undefined,
    change: (data: T, now: string) => T | StoryError,
  ): Promise<Mutation<T>> {
    const policy = this.policyOf(session)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = await this.readJson(target, normalize)
      if (current === 'corrupt') return { ok: false, error: 'io' }
      if (current === 'missing' && createDefault === undefined) return { ok: false, error: 'missing' }
      const creating = current === 'missing'
      const base: T = creating ? createDefault!() : (current as { data: T }).data
      const now = new Date().toISOString()
      const next = change(base, now)
      if (typeof next === 'string') return { ok: false, error: next }
      try {
        await this.fs.writeText(
          target, `${JSON.stringify(next, null, 2)}\n`,
          creating
            ? { kind: 'createIfAbsent' }
            : { kind: 'replaceIfVersion', version: FsVersion((current as { version: string }).version) },
          undefined, policy,
        )
        return { ok: true, data: next, created: creating }
      } catch (error) {
        const code = storyErrorOf(error)
        if (code === 'stale' && attempt === 0) continue
        return { ok: false, error: code }
      }
    }
    /* v8 ignore next -- the loop's second iteration always returns */
    return { ok: false, error: 'stale' }
  }

  /**
   * Append lines to one JSONL journal: read the raw text, concat the new
   * lines, write back under the version guard (one stale retry). `ctx.fs`
   * has no append verb, so append-only semantics ride the same guarded RMW
   * as the JSON documents — a lost race retries, never clobbers.
   * @param target - the resolved journal target.
   * @param session - the session that owns the gesture; supplies the fence.
   * @param lines - the records to append (one JSON per line).
   */
  private async appendJsonl(
    target: FsTarget,
    session: Session,
    lines: readonly Record<string, unknown>[],
  ): Promise<{ readonly ok: boolean; readonly error?: StoryError }> {
    if (lines.length === 0) return { ok: true }
    const policy = this.policyOf(session)
    const addition = lines.map(line => `${JSON.stringify(line)}\n`).join('')
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let existing = ''
      let version: string | undefined
      try {
        const info = await this.fs.stat(target)
        if (info !== undefined) {
          existing = await this.fs.readText(target)
          version = info.version
        }
      } catch (error) {
        if (!(error instanceof FsError && error.code === 'FS_NOT_FOUND')) return { ok: false, error: storyErrorOf(error) }
      }
      try {
        await this.fs.writeText(
          target, existing + addition,
          version === undefined
            ? { kind: 'createIfAbsent' }
            : { kind: 'replaceIfVersion', version: FsVersion(version) },
          undefined, policy,
        )
        return { ok: true }
      } catch (error) {
        const code = storyErrorOf(error)
        if (code === 'stale' && attempt === 0) continue
        return { ok: false, error: code }
      }
    }
    /* v8 ignore next -- the loop's second iteration always returns */
    return { ok: false, error: 'stale' }
  }

  /** Read one JSONL journal tolerantly (bad lines drop out, a missing journal reads empty). */
  private async readJsonl<T>(target: FsTarget, normalize: (raw: unknown) => T | undefined): Promise<T[]> {
    let text: string
    try {
      text = await this.fs.readText(target)
    } catch {
      return []
    }
    const out: T[] = []
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue
      try {
        const record = normalize(JSON.parse(line))
        if (record !== undefined) out.push(record)
      } catch {
        // A half-written or hand-corrupted line drops out of the view; the journal itself is never rewritten.
      }
    }
    return out
  }

  /* ------------------------------------------------------------ registry */

  /** Tolerant read of the registry (a top-level array of work rows). */
  private normalizeIndex(raw: unknown): WorkIndexEntry[] | undefined {
    if (!Array.isArray(raw)) return undefined
    const out: WorkIndexEntry[] = []
    for (const row of raw) {
      if (typeof row !== 'object' || row === null) continue
      const record = row as Record<string, unknown>
      const id = normalizeWorkId(record['id'])
      const title = cleanText(record['title'], 80)
      const workspace = cleanText(record['workspace'], 500)
      const createdAt = cleanText(record['createdAt'], 40)
      if (id === undefined || title === undefined || workspace === undefined || createdAt === undefined) continue
      out.push({ id, title, workspace, createdAt })
    }
    return out
  }

  /** List every registered work (a missing registry is an empty list, not an error). */
  async listWorks(): Promise<WorkIndexEntry[]> {
    const read = await this.readJson(await this.indexTarget(), raw => this.normalizeIndex(raw))
    return read === 'missing' || read === 'corrupt' ? [] : read.data
  }

  /**
   * Create one work: its directory, `work.json`, and the registry row. The
   * other per-work documents are lazily created by their first write.
   * @param request - title and the mounted workspace's absolute path.
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns the new work's metadata, or the failure code.
   */
  async createWork(
    request: { readonly title: string; readonly workspace: string },
    session: Session,
  ): Promise<{ readonly ok: boolean; readonly error?: StoryError; readonly work?: WorkMeta }> {
    const title = sanitizeWorkTitle(request.title)
    const workspace = cleanText(request.workspace, 500)
    if (title === undefined || workspace === undefined) return { ok: false, error: 'invalid-name' }
    const id = makeWorkId()
    const now = new Date().toISOString()
    const meta: WorkMeta = { id, title, workspace, createdAt: now, updatedAt: now }
    const written = await this.mutateJson(
      await this.fileTarget(id, WORK_FILES.meta), session,
      raw => this.normalizeWorkMeta(raw),
      () => meta,
      () => meta,
    )
    if (!written.ok) return { ok: false, error: written.error }
    const indexed = await this.mutateJson(
      await this.indexTarget(), session,
      raw => this.normalizeIndex(raw),
      () => [],
      (rows) => [...rows, { id, title, workspace, createdAt: now }],
    )
    if (!indexed.ok) return { ok: false, error: indexed.error }
    return { ok: true, work: meta }
  }

  /** Tolerant read of `work.json`. */
  private normalizeWorkMeta(raw: unknown): WorkMeta | undefined {
    if (typeof raw !== 'object' || raw === null) return undefined
    const record = raw as Record<string, unknown>
    const id = normalizeWorkId(record['id'])
    const title = cleanText(record['title'], 80)
    const workspace = cleanText(record['workspace'], 500)
    const createdAt = cleanText(record['createdAt'], 40)
    const updatedAt = cleanText(record['updatedAt'], 40)
    if (id === undefined || title === undefined || workspace === undefined || createdAt === undefined) return undefined
    return { id, title, workspace, createdAt, updatedAt: updatedAt ?? createdAt }
  }

  /** Read one work's metadata (the gate every per-work verb passes first). */
  async readWorkMeta(workId: string): Promise<WorkMeta | undefined> {
    const id = normalizeWorkId(workId)
    if (id === undefined) return undefined
    const read = await this.readJson(await this.fileTarget(id, WORK_FILES.meta), raw => this.normalizeWorkMeta(raw))
    return typeof read === 'object' ? read.data : undefined
  }

  /** The information page: metadata plus counts computed from the live tables (proposal §6 信息 view). */
  async readWork(request: { readonly workId: string }): Promise<{ readonly ok: boolean; readonly error?: StoryError; readonly info?: WorkInfo }> {
    const meta = await this.readWorkMeta(request.workId)
    if (meta === undefined) return { ok: false, error: 'missing' }
    const memories = await this.readMemories(meta.id)
    const characters = await this.readCharacters(meta.id)
    const chapters = await this.readChapters(meta.id)
    const pending = await this.readPendingItems(meta.id)
    return {
      ok: true,
      info: {
        meta,
        counts: {
          memories: memories.filter(memory => memory.status === 'active').length,
          intentDrafts: memories.filter(memory => memory.layer === 'intent' && memory.intentStatus === 'draft' && memory.status === 'active').length,
          characters: characters.filter(character => character.status === 'active').length,
          chapters: chapters.length,
          pending: pending.filter(item => item.status === 'pending').length,
        },
        stateDir: this.workDir(meta.id),
      },
    }
  }

  /* -------------------------------------------------------------- focus */

  /**
   * Mark the work one session focuses: every tool and the pointer section
   * resolve through this map. In-memory only — a restart simply means
   * "nothing focused yet" (the canvas focus precedent). The title is
   * captured at focus time so the synchronous pointer never reads a file.
   * @param request - the work id.
   * @param session - the session focusing.
   * @returns the receipt, or the failure code.
   */
  async focusWork(request: { readonly workId: string }, session: Session): Promise<{ readonly ok: boolean; readonly error?: StoryError }> {
    const id = normalizeWorkId(request.workId)
    if (id === undefined) return { ok: false, error: 'invalid-name' }
    const meta = await this.readWorkMeta(id)
    if (meta === undefined) return { ok: false, error: 'missing' }
    this.focused.set(String(session.id), { workId: id, title: meta.title })
    return { ok: true }
  }

  /** The work one session focuses, or undefined (the pointer section's sync read). */
  focusedWork(sessionId: string): { readonly workId: string; readonly title: string } | undefined {
    return this.focused.get(sessionId)
  }

  /** The work one session's agent focuses (the tools' target resolution). */
  focusedWorkOf(session: Session): { readonly workId: string; readonly title: string } | undefined {
    return this.focused.get(String(session.id))
  }

  /* ------------------------------------------------------------ memories */

  /** Read the whole memory table (missing/corrupt reads as empty — mutations re-check through mutateJson). */
  private async readMemories(workId: string): Promise<MemoryRecord[]> {
    const read = await this.readJson(await this.fileTarget(workId, WORK_FILES.memories), raw => normalizeMemoryTable(raw))
    return typeof read === 'object' ? read.data.memories : []
  }

  /**
   * Add one memory. The agent's entrance lands as an intent-layer draft
   * (reviewed=false — the ghost card); the user's entrance (Remote) lands
   * reviewed. The id allocates max+1 over the table in the same guarded
   * write, so two writers can never mint the same id.
   * @param request - the memory content and axes.
   * @param session - the session that owns the gesture; supplies the fence.
   * @param origin - who wrote it (reviewed/extractedBy follow).
   * @returns the new record, or the failure code.
   */
  async writeMemory(
    request: WriteMemoryRequest,
    session: Session,
    origin: 'user' | 'agent',
  ): Promise<{ readonly ok: boolean; readonly error?: StoryError; readonly memory?: MemoryRecord }> {
    const workId = normalizeWorkId(request.workId)
    const content = cleanText(request.content)
    if (workId === undefined || content === undefined) return { ok: false, error: 'invalid-name' }
    if (await this.readWorkMeta(workId) === undefined) return { ok: false, error: 'missing' }
    const layer = request.layer ?? 'intent'
    let memory: MemoryRecord | undefined
    const outcome = await this.mutateJson(
      await this.fileTarget(workId, WORK_FILES.memories), session,
      raw => normalizeMemoryTable(raw),
      () => ({ version: 1 as const, memories: [] }),
      (table, now) => {
        const next = table.memories.reduce((max, row) => Math.max(max, memoryNumberOf(row.id)), 0) + 1
        memory = {
          id: `m${next}`,
          owner: cleanText(request.owner, 40) ?? 'creator',
          type: request.type ?? 'semantic',
          layer,
          content,
          status: 'active',
          reviewed: origin === 'user',
          confidence: request.confidence ?? (origin === 'user' ? 'high' : 'medium'),
          extractedBy: origin === 'user' ? 'user' : 'llm',
          createdAt: now,
          updatedAt: now,
          ...(layer === 'intent' ? { intentStatus: 'draft' as const } : {}),
          ...(request.kind === undefined ? {} : { kind: request.kind }),
          ...(request.specifics === undefined ? {} : { specifics: request.specifics }),
          ...(cleanText(request.evidenceInText, 60) === undefined ? {} : { evidenceInText: cleanText(request.evidenceInText, 60)! }),
          ...(request.chapter === undefined ? {} : { firstChapter: request.chapter, lastActiveChapter: request.chapter }),
        }
        table.memories.push(memory)
        return table
      },
    )
    if (!outcome.ok || memory === undefined) return { ok: false, error: outcome.ok ? 'io' : outcome.error }
    return { ok: true, memory }
  }

  /** List memories, newest last; filters are ANDed, archived rows excluded unless asked for. */
  async listMemories(request: {
    readonly workId: string
    readonly layer?: MemoryRecord['layer']
    readonly type?: MemoryRecord['type']
    readonly kind?: MemoryRecord['kind']
    readonly intentStatus?: MemoryRecord['intentStatus']
    readonly includeArchived?: boolean
  }): Promise<MemoryRecord[]> {
    const id = normalizeWorkId(request.workId)
    if (id === undefined) return []
    const memories = await this.readMemories(id)
    return memories.filter(memory =>
      (request.includeArchived === true || memory.status === 'active')
      && (request.layer === undefined || memory.layer === request.layer)
      && (request.type === undefined || memory.type === request.type)
      && (request.kind === undefined || memory.kind === request.kind)
      && (request.intentStatus === undefined || memory.intentStatus === request.intentStatus))
  }

  /**
   * The review verb on one memory (采纳/丢弃/归档/撤销). accept promotes an
   * intent draft to active (and stamps reviewed — the user's ✓); discard and
   * archive both archive (discard is the draft's ✗, archive the settled
   * row's exit — intent rows also retire); retract undoes an automatic
   * import (archived, the 自动·可撤销 promise). Old rows are never deleted.
   * @param request - work id, memory id, the action.
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns the fresh record, or the failure code.
   */
  async decideMemory(
    request: { readonly workId: string; readonly id: string; readonly action: ReviewAction },
    session: Session,
  ): Promise<{ readonly ok: boolean; readonly error?: StoryError; readonly memory?: MemoryRecord }> {
    const workId = normalizeWorkId(request.workId)
    if (workId === undefined) return { ok: false, error: 'invalid-name' }
    let memory: MemoryRecord | undefined
    const outcome = await this.mutateJson(
      await this.fileTarget(workId, WORK_FILES.memories), session,
      raw => normalizeMemoryTable(raw),
      undefined,
      (table, now) => {
        const row = table.memories.find(candidate => candidate.id === request.id)
        if (row === undefined) return 'missing'
        const mutable = row as { -readonly [K in keyof MemoryRecord]: MemoryRecord[K] }
        if (request.action === 'accept') {
          if (row.layer === 'intent' && row.intentStatus !== 'draft') return 'invalid-name'
          mutable.reviewed = true
          if (row.layer === 'intent') mutable.intentStatus = 'active'
        } else if (request.action === 'discard' || request.action === 'archive' || request.action === 'retract') {
          if (request.action === 'retract' && row.autoImported !== true) return 'invalid-name'
          mutable.status = 'archived'
          if (row.layer === 'intent') mutable.intentStatus = 'retired'
        }
        mutable.updatedAt = now
        memory = { ...row }
        return table
      },
    )
    if (!outcome.ok || memory === undefined) return { ok: false, error: outcome.ok ? 'io' : outcome.error }
    return { ok: true, memory }
  }

  /* ----------------------------------------------------------- characters */

  /** Read the whole character table. */
  private async readCharacters(workId: string): Promise<CharacterRecord[]> {
    const read = await this.readJson(await this.fileTarget(workId, WORK_FILES.characters), raw => normalizeCharacterTable(raw))
    return typeof read === 'object' ? read.data.characters : []
  }

  /** List characters (archived excluded unless asked for). */
  async listCharacters(request: { readonly workId: string; readonly includeArchived?: boolean }): Promise<CharacterRecord[]> {
    const id = normalizeWorkId(request.workId)
    if (id === undefined) return []
    const characters = await this.readCharacters(id)
    return characters.filter(character => request.includeArchived === true || character.status === 'active')
  }

  /**
   * Create one character (no id — `c<max+1>`) or patch its blocks (id
   * present; provided blocks replace, absent blocks keep). The id allocates
   * inside the same guarded write as the row.
   * @param request - the character data.
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns the fresh record, or the failure code.
   */
  async writeCharacter(
    request: WriteCharacterRequest,
    session: Session,
  ): Promise<{ readonly ok: boolean; readonly error?: StoryError; readonly character?: CharacterRecord }> {
    const workId = normalizeWorkId(request.workId)
    const name = cleanText(request.name, 80)
    if (workId === undefined || name === undefined) return { ok: false, error: 'invalid-name' }
    if (await this.readWorkMeta(workId) === undefined) return { ok: false, error: 'missing' }
    let character: CharacterRecord | undefined
    const outcome = await this.mutateJson(
      await this.fileTarget(workId, WORK_FILES.characters), session,
      raw => normalizeCharacterTable(raw),
      () => ({ version: 1 as const, characters: [] }),
      (table, now) => {
        if (request.id !== undefined) {
          const row = table.characters.find(candidate => candidate.id === request.id)
          if (row === undefined) return 'missing'
          const mutable = row as { -readonly [K in keyof CharacterRecord]: CharacterRecord[K] }
          mutable.name = name
          if (request.identity !== undefined) mutable.identity = request.identity
          if (request.profile !== undefined) mutable.profile = request.profile
          if (request.core !== undefined) mutable.core = request.core
          if (request.knowledge !== undefined) mutable.knowledge = request.knowledge
          if (request.currentState !== undefined) mutable.currentState = request.currentState
          mutable.updatedAt = now
          character = { ...row }
          return table
        }
        const next = table.characters.reduce((max, row) => {
          const match = /^c(\d+)$/.exec(row.id)
          return match === null ? max : Math.max(max, Number(match[1]))
        }, 0) + 1
        const created: CharacterRecord = {
          id: `c${next}`,
          name,
          identity: cleanText(request.identity, 200) ?? '',
          profile: request.profile ?? {},
          core: request.core ?? {},
          knowledge: request.knowledge ?? { knows: [], unaware: [], secrets: [] },
          relationships: [],
          currentState: request.currentState ?? {},
          status: 'active',
          createdAt: now,
          updatedAt: now,
        }
        table.characters.push(created)
        character = created
        return table
      },
    )
    if (!outcome.ok || character === undefined) return { ok: false, error: outcome.ok ? 'io' : outcome.error }
    return { ok: true, character }
  }

  /** One character by id or exact name (the tools' and brief's resolution). */
  async readCharacter(request: { readonly workId: string; readonly idOrName: string }): Promise<CharacterRecord | undefined> {
    const characters = await this.listCharacters({ workId: request.workId, includeArchived: true })
    return characters.find(character => character.id === request.idOrName || character.name === request.idOrName)
  }

  /* ---------------------------------------------------------- experiences */

  /** List the experience journal (optionally one character's), oldest first. */
  async listExperiences(request: { readonly workId: string; readonly characterId?: string }): Promise<ExperienceEntry[]> {
    const id = normalizeWorkId(request.workId)
    if (id === undefined) return []
    const entries = await this.readJsonl(await this.fileTarget(id, WORK_FILES.experiences), raw => normalizeExperience(raw))
    return entries.filter(entry => request.characterId === undefined || entry.characterId === request.characterId)
  }

  /* ------------------------------------------------------------- chapters */

  /** Read the whole chapter table. */
  private async readChapters(workId: string): Promise<ChapterRecord[]> {
    const read = await this.readJson(await this.fileTarget(workId, WORK_FILES.chapters), raw => normalizeChapterTable(raw))
    return typeof read === 'object' ? read.data.chapters : []
  }

  /** Whether the manuscript file has content (the 写作中 derivation). */
  private async hasBody(work: WorkMeta, chapter: ChapterRecord): Promise<boolean> {
    try {
      const info = await this.fs.stat(await this.fs.resolve(this.bodyPath(work, chapter)))
      return info !== undefined && (info.size ?? 0) > 0
    } catch {
      return false
    }
  }

  /** The chapter index, seq-ordered, with the effective phase derived per row. */
  async listChapters(request: { readonly workId: string }): Promise<{ readonly chapter: ChapterRecord; readonly phase: EffectiveChapterPhase }[]> {
    const id = normalizeWorkId(request.workId)
    if (id === undefined) return []
    const meta = await this.readWorkMeta(id)
    if (meta === undefined) return []
    const chapters = [...await this.readChapters(id)].sort((a, b) => a.seq - b.seq || a.n - b.n)
    const out: { chapter: ChapterRecord; phase: EffectiveChapterPhase }[] = []
    for (const chapter of chapters) {
      out.push({ chapter, phase: effectiveChapterPhase(chapter, await this.hasBody(meta, chapter)) })
    }
    return out
  }

  /** Read one chapter's manuscript (a missing body reads as empty — the metadata stays openable). */
  async readChapterBody(work: WorkMeta, chapter: ChapterRecord): Promise<string> {
    try {
      return await this.fs.readText(await this.fs.resolve(this.bodyPath(work, chapter)))
    } catch {
      return ''
    }
  }

  /** One chapter by number, with its body and effective phase. */
  async readChapter(request: { readonly workId: string; readonly n: number }): Promise<{
    readonly ok: boolean
    readonly error?: StoryError
    readonly chapter?: ChapterRecord
    readonly phase?: EffectiveChapterPhase
    readonly body?: string
  }> {
    const id = normalizeWorkId(request.workId)
    if (id === undefined) return { ok: false, error: 'invalid-name' }
    const meta = await this.readWorkMeta(id)
    if (meta === undefined) return { ok: false, error: 'missing' }
    const chapter = (await this.readChapters(id)).find(candidate => candidate.n === request.n)
    if (chapter === undefined) return { ok: false, error: 'missing' }
    return {
      ok: true,
      chapter,
      phase: effectiveChapterPhase(chapter, await this.hasBody(meta, chapter)),
      body: await this.readChapterBody(meta, chapter),
    }
  }

  /**
   * Create one chapter (n allocates max+1, the file name derives from n —
   * free-form names are never stored) or update its title/plan. seq defaults
   * to n; an explicit seq inserts the chapter between its neighbors.
   *
   * `content` (the F1-2 rule): given, the manuscript body is written to
   * `<workspace>/<title>/第{n}章.md` FIRST — through the calling session's
   * resolved mode with the boundary re-rooted at the work's mounted workspace
   * (the canvas exportManuscript fence) — and only then does the chapter
   * register. A denied/failed write refuses the registration: a chapter never
   * registers onto an empty slot again. An existing file is rewritten under
   * the version from the stat just taken; a missing parent directory is
   * created by the fs layer. The plan-only path (no content) registers as
   * planning without touching the workspace.
   * @param request - the chapter data.
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns the fresh record, or the failure code.
   */
  async writeChapter(
    request: WriteChapterRequest,
    session: Session,
  ): Promise<{ readonly ok: boolean; readonly error?: StoryError; readonly chapter?: ChapterRecord }> {
    const workId = normalizeWorkId(request.workId)
    const title = cleanText(request.title, 200)
    if (workId === undefined || title === undefined) return { ok: false, error: 'invalid-name' }
    const meta = await this.readWorkMeta(workId)
    if (meta === undefined) return { ok: false, error: 'missing' }
    const plan = request.plan === undefined ? undefined : normalizePlan(request.plan)
    if (request.plan !== undefined && plan === undefined) return { ok: false, error: 'invalid-name' }
    const content = typeof request.content === 'string' && request.content.length > 0 ? request.content.slice(0, 2_000_000) : undefined

    // The body lands before the registration (F1-2): a write that the fence
    // refuses means NO chapter row — the 空槽登记 bug class is closed by
    // construction.
    if (content !== undefined) {
      const chapters = await this.readChapters(workId)
      const n = request.n ?? chapters.reduce((max, row) => Math.max(max, row.n), 0) + 1
      const target = await this.fs.resolve(join(meta.workspace, meta.title, chapterFileName(n)))
      const resolved = this.sandboxPolicy?.resolve({ session })
      if (resolved?.mode === 'read-only') return { ok: false, error: 'denied' }
      const policy = resolved === undefined ? undefined : { ...resolved, workspaceRoot: meta.workspace }
      let version: string | undefined
      try {
        version = (await this.fs.stat(target))?.version
      } catch {
        version = undefined
      }
      try {
        await this.fs.writeText(
          target, content,
          version === undefined
            ? { kind: 'createIfAbsent' }
            : { kind: 'replaceIfVersion', version: FsVersion(version) },
          undefined, policy,
        )
      } catch (error) {
        return { ok: false, error: storyErrorOf(error) }
      }
    }

    let chapter: ChapterRecord | undefined
    const outcome = await this.mutateJson(
      await this.fileTarget(workId, WORK_FILES.chapters), session,
      raw => normalizeChapterTable(raw),
      () => ({ version: 1 as const, chapters: [] }),
      (table, now) => {
        if (request.n !== undefined) {
          const row = table.chapters.find(candidate => candidate.n === request.n)
          if (row === undefined) return 'missing'
          const mutable = row as { -readonly [K in keyof ChapterRecord]: ChapterRecord[K] }
          mutable.title = title
          if (plan !== undefined) mutable.plan = plan
          mutable.updatedAt = now
          const sessionId = String(session.id)
          if (!row.sessionIds.includes(sessionId)) (mutable.sessionIds as string[]).push(sessionId)
          chapter = { ...row }
          return table
        }
        const n = table.chapters.reduce((max, row) => Math.max(max, row.n), 0) + 1
        const created: ChapterRecord = {
          n,
          seq: request.seq ?? n,
          title,
          file: chapterFileName(n),
          phase: 'planning',
          sessionIds: [String(session.id)],
          createdAt: now,
          updatedAt: now,
          ...(plan === undefined ? {} : { plan }),
        }
        table.chapters.push(created)
        chapter = created
        return table
      },
    )
    if (!outcome.ok || chapter === undefined) return { ok: false, error: outcome.ok ? 'io' : outcome.error }
    return { ok: true, chapter }
  }

  /**
   * Whether a workspace path exists and is a directory (the create form's
   * fallback-path validation; a read, so it is unfenced).
   * @param request - the absolute path.
   * @returns existence and directory-ness, or the failure code.
   */
  async statWorkspace(
    request: { readonly path: string },
  ): Promise<{ readonly ok: boolean; readonly error?: StoryError; readonly exists?: boolean; readonly directory?: boolean }> {
    const path = cleanText(request.path, 500)
    if (path === undefined) return { ok: false, error: 'invalid-name' }
    try {
      const info = await this.fs.stat(await this.fs.resolve(path))
      if (info === undefined) return { ok: true, exists: false, directory: false }
      return { ok: true, exists: true, directory: info.type !== 'file' }
    } catch (error) {
      if (error instanceof FsError && error.code === 'FS_NOT_FOUND') return { ok: true, exists: false, directory: false }
      return { ok: false, error: storyErrorOf(error) }
    }
  }

  /**
   * The user's ✓审过 gate — the chapter-CLOSING gesture (审过是人工闸门，永远
   * 最后): extracted → reviewed. A chapter whose 对账 never ran cannot close
   * (记忆里不能有没有对过账的章); a reviewed chapter re-answers ok.
   * @param request - work id and chapter number.
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns the fresh record, or the failure code.
   */
  async reviewChapter(
    request: { readonly workId: string; readonly n: number },
    session: Session,
  ): Promise<{ readonly ok: boolean; readonly error?: StoryError; readonly chapter?: ChapterRecord }> {
    const workId = normalizeWorkId(request.workId)
    if (workId === undefined) return { ok: false, error: 'invalid-name' }
    let chapter: ChapterRecord | undefined
    const outcome = await this.mutateJson(
      await this.fileTarget(workId, WORK_FILES.chapters), session,
      raw => normalizeChapterTable(raw),
      undefined,
      (table, now) => {
        const row = table.chapters.find(candidate => candidate.n === request.n)
        if (row === undefined) return 'missing'
        if (row.phase === 'planning') return 'not-extracted'
        if (row.phase === 'extracted') {
          const mutable = row as { -readonly [K in keyof ChapterRecord]: ChapterRecord[K] }
          mutable.phase = 'reviewed'
          mutable.updatedAt = now
        }
        chapter = { ...row }
        return table
      },
    )
    if (!outcome.ok || chapter === undefined) return { ok: false, error: outcome.ok ? 'io' : outcome.error }
    return { ok: true, chapter }
  }

  /* -------------------------------------------------------------- ledger */

  /**
   * Edit one memory's fields (设定集/世界规则区的字段级可编辑). The revision
   * protocol (proposal §3: 修订走 derives_from 链，旧条不删): the old row
   * archives, a new row carries the patched content with
   * `links.derivesFrom: [oldId]` — one guarded write, so the chain link and
   * the retirement can never disagree.
   * @param request - work id, memory id, the fields to change.
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns the NEW record (the chain's head), or the failure code.
   */
  async patchMemory(
    request: PatchMemoryRequest,
    session: Session,
  ): Promise<{ readonly ok: boolean; readonly error?: StoryError; readonly memory?: MemoryRecord }> {
    const workId = normalizeWorkId(request.workId)
    if (workId === undefined) return { ok: false, error: 'invalid-name' }
    const content = request.content === undefined ? undefined : cleanText(request.content)
    if (request.content !== undefined && content === undefined) return { ok: false, error: 'invalid-name' }
    let memory: MemoryRecord | undefined
    const outcome = await this.mutateJson(
      await this.fileTarget(workId, WORK_FILES.memories), session,
      raw => normalizeMemoryTable(raw),
      undefined,
      (table, now) => {
        const old = table.memories.find(candidate => candidate.id === request.id)
        if (old === undefined) return 'missing'
        if (old.status === 'archived') return 'invalid-name'
        const next = table.memories.reduce((max, row) => Math.max(max, memoryNumberOf(row.id)), 0) + 1
        const { autoImported: _dropped, ...rest } = old
        const revised: MemoryRecord = {
          ...rest,
          id: `m${next}`,
          content: content ?? old.content,
          reviewed: true,
          extractedBy: 'user',
          links: { derivesFrom: [old.id] },
          createdAt: now,
          updatedAt: now,
          ...(request.kind === undefined ? {} : { kind: request.kind }),
          ...(request.specifics === undefined ? {} : { specifics: request.specifics }),
        }
        const mutable = old as { -readonly [K in keyof MemoryRecord]: MemoryRecord[K] }
        mutable.status = 'archived'
        mutable.updatedAt = now
        table.memories.push(revised)
        memory = revised
        return table
      },
    )
    if (!outcome.ok || memory === undefined) return { ok: false, error: outcome.ok ? 'io' : outcome.error }
    return { ok: true, memory }
  }

  /* -------------------------------------------------------------- ledger */

  /** The foreshadow ledger rows (canon + prospective + reviewed + active — the 台账). */
  private async foreshadows(workId: string): Promise<MemoryRecord[]> {
    const memories = await this.readMemories(workId)
    return memories.filter(memory =>
      memory.type === 'prospective' && memory.layer === 'canon' && memory.reviewed && memory.status === 'active')
  }

  /**
   * The 伏笔沉睡榜 + 健康度: active foreshadows sorted longest-slept first
   * (the maintenance meeting's agenda), resolved ones with answers, and the
   * health counts (活跃/超期⚠/已揭/弃置). 超期 = 3+ chapters untouched.
   * @param request - the work id.
   * @returns the ledger rows and counts, or the failure code.
   */
  async ledger(request: { readonly workId: string }): Promise<LedgerResult> {
    const id = normalizeWorkId(request.workId)
    if (id === undefined) return { ok: false, error: 'invalid-name', active: [], resolved: [], counts: { active: 0, overdue: 0, resolved: 0, abandoned: 0 }, currentChapter: 0 }
    const [all, chapters] = await Promise.all([this.foreshadows(id), this.readChapters(id)])
    const currentChapter = chapters.reduce((max, chapter) => Math.max(max, chapter.n), 0)
    const active = all.filter(memory => memory.specifics?.status !== 'resolved' && memory.specifics?.status !== 'abandoned')
    const resolved = all.filter(memory => memory.specifics?.status === 'resolved')
    const abandoned = all.filter(memory => memory.specifics?.status === 'abandoned')
    const slept = (memory: MemoryRecord): number => currentChapter - (memory.lastActiveChapter ?? memory.specifics?.plantedAt ?? currentChapter)
    active.sort((a, b) => slept(b) - slept(a))
    return {
      ok: true,
      active,
      resolved,
      counts: { active: active.length, overdue: active.filter(memory => slept(memory) >= 3).length, resolved: resolved.length, abandoned: abandoned.length },
      currentChapter,
    }
  }

  /**
   * The user's ✓确认计划 gate (规划环的确认闸门): stamps `planConfirmedAt`
   * on a chapter that HAS a plan. Idempotent — a confirmed plan re-answers
   * ok; a chapter with no plan refuses (there is nothing to confirm).
   * @param request - work id and chapter number.
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns the fresh record, or the failure code.
   */
  async confirmChapterPlan(
    request: { readonly workId: string; readonly n: number },
    session: Session,
  ): Promise<{ readonly ok: boolean; readonly error?: StoryError; readonly chapter?: ChapterRecord }> {
    const workId = normalizeWorkId(request.workId)
    if (workId === undefined) return { ok: false, error: 'invalid-name' }
    let chapter: ChapterRecord | undefined
    const outcome = await this.mutateJson(
      await this.fileTarget(workId, WORK_FILES.chapters), session,
      raw => normalizeChapterTable(raw),
      undefined,
      (table, now) => {
        const row = table.chapters.find(candidate => candidate.n === request.n)
        if (row === undefined) return 'missing'
        if (row.plan === undefined) return 'invalid-name'
        if (row.planConfirmedAt === undefined) {
          const mutable = row as { -readonly [K in keyof ChapterRecord]: ChapterRecord[K] }
          mutable.planConfirmedAt = now
          mutable.updatedAt = now
        }
        chapter = { ...row }
        return table
      },
    )
    if (!outcome.ok || chapter === undefined) return { ok: false, error: outcome.ok ? 'io' : outcome.error }
    return { ok: true, chapter }
  }

  /**
   * The foreshadow card's three exits (世界记忆, proposal §6):
   *   - resolve 登记揭晓: status → resolved with the answer (required — the
   *     plan brief prints it so planning cannot contradict the reveal);
   *   - abandon 弃置: status → abandoned (the 台账 stops warning);
   *   - promote 转设定: the mystery graduates into a world rule — a canon
   *     semantic memory (kind 世界, reviewed, user-sourced) is created from
   *     the answer text (required), and the foreshadow resolves into it
   *     (`links.resolvedBy` points at the new rule). One guarded write.
   * @param request - work id, memory id, the action, and the answer/rule text.
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns the touched records, or the failure code.
   */
  async foreshadowExit(
    request: { readonly workId: string; readonly id: string; readonly action: ForeshadowExitAction; readonly answer?: string },
    session: Session,
  ): Promise<{ readonly ok: boolean; readonly error?: StoryError; readonly memory?: MemoryRecord; readonly promoted?: MemoryRecord }> {
    const workId = normalizeWorkId(request.workId)
    if (workId === undefined) return { ok: false, error: 'invalid-name' }
    const answer = cleanText(request.answer, 500)
    if ((request.action === 'resolve' || request.action === 'promote') && answer === undefined) return { ok: false, error: 'invalid-name' }
    let memory: MemoryRecord | undefined
    let promoted: MemoryRecord | undefined
    const outcome = await this.mutateJson(
      await this.fileTarget(workId, WORK_FILES.memories), session,
      raw => normalizeMemoryTable(raw),
      undefined,
      (table, now) => {
        const row = table.memories.find(candidate => candidate.id === request.id)
        if (row === undefined || row.type !== 'prospective') return 'missing'
        if (row.specifics?.status === 'resolved' || row.specifics?.status === 'abandoned') return 'invalid-name'
        const mutable = row as { -readonly [K in keyof MemoryRecord]: MemoryRecord[K] }
        if (request.action === 'abandon') {
          mutable.specifics = { ...row.specifics, status: 'abandoned' }
        } else if (request.action === 'resolve') {
          mutable.specifics = { ...row.specifics, status: 'resolved', ...(answer === undefined ? {} : { answer }) }
        } else {
          const next = table.memories.reduce((max, candidate) => Math.max(max, memoryNumberOf(candidate.id)), 0) + 1
          promoted = {
            id: `m${next}`,
            owner: 'creator',
            type: 'semantic',
            layer: 'canon',
            kind: '世界',
            content: answer!,
            status: 'active',
            reviewed: true,
            confidence: 'high',
            extractedBy: 'user',
            createdAt: now,
            updatedAt: now,
          }
          table.memories.push(promoted)
          mutable.specifics = { ...row.specifics, status: 'resolved', ...(answer === undefined ? {} : { answer }) }
          mutable.links = { resolvedBy: promoted.id }
        }
        mutable.reviewed = true
        mutable.updatedAt = now
        memory = { ...row }
        return table
      },
    )
    if (!outcome.ok || memory === undefined) return { ok: false, error: outcome.ok ? 'io' : outcome.error }
    return { ok: true, memory, ...(promoted === undefined ? {} : { promoted }) }
  }

  /** The mention journal (世界记忆卡的章节点轨), optionally one foreshadow's, oldest first. */
  async listMentions(request: { readonly workId: string; readonly foreshadowId?: string }): Promise<MentionEntry[]> {
    const id = normalizeWorkId(request.workId)
    if (id === undefined) return []
    const entries = await this.readJsonl(await this.fileTarget(id, WORK_FILES.mentions), raw => normalizeMention(raw))
    return entries.filter(entry => request.foreshadowId === undefined || entry.foreshadowId === request.foreshadowId)
  }

  /**
   * Take one automatic experience back (自动·可撤销, invariant 3): the line
   * leaves the journal. The journal is append-only for the SYSTEM; the user's
   * retract gesture is the one sanctioned exception, and it rides the same
   * guarded rewrite the appends use, keeping every other line byte-identical.
   * A line without an id (pre-M3) cannot be retracted by handle — the user
   * edits the journal by hand for those.
   * @param request - work id and the entry id (`e<n>`).
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns the receipt, or the failure code.
   */
  async retractExperience(
    request: { readonly workId: string; readonly id: string },
    session: Session,
  ): Promise<{ readonly ok: boolean; readonly error?: StoryError }> {
    const workId = normalizeWorkId(request.workId)
    if (workId === undefined || !/^e\d+$/.test(request.id)) return { ok: false, error: 'invalid-name' }
    const target = await this.fileTarget(workId, WORK_FILES.experiences)
    const policy = this.policyOf(session)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let text: string
      let version: string
      try {
        const info = await this.fs.stat(target)
        if (info === undefined) return { ok: false, error: 'missing' }
        text = await this.fs.readText(target)
        version = info.version
      } catch (error) {
        return { ok: false, error: storyErrorOf(error) }
      }
      const lines = text.split('\n')
      const kept: string[] = []
      let found = false
      for (const line of lines) {
        if (line.trim() === '') continue
        try {
          const row = JSON.parse(line) as Record<string, unknown>
          if (row['id'] === request.id) {
            found = true
            continue
          }
        } catch {
          // A corrupt line is not the retract target; it is kept verbatim.
        }
        kept.push(line)
      }
      if (!found) return { ok: false, error: 'missing' }
      try {
        await this.fs.writeText(
          target, kept.length === 0 ? '' : `${kept.join('\n')}\n`,
          { kind: 'replaceIfVersion', version: FsVersion(version) },
          undefined, policy,
        )
        return { ok: true }
      } catch (error) {
        const code = storyErrorOf(error)
        if (code === 'stale' && attempt === 0) continue
        return { ok: false, error: code }
      }
    }
    /* v8 ignore next -- the loop's second iteration always returns */
    return { ok: false, error: 'stale' }
  }

  /* --------------------------------------------------------------- brief */

  /**
   * Gather everything one brief renders (the async half; brief.ts renders
   * synchronously from this). The target chapter: the explicit n, else the
   * newest chapter still planning (the one being planned/written), else the
   * newest chapter overall — none at all is a guidance error, never a throw.
   * @param request - work id and optional chapter number.
   * @returns the render data, or the failure code.
   */
  async gatherBrief(request: { readonly workId: string; readonly chapter?: number }): Promise<{
    readonly ok: boolean
    readonly error?: StoryError
    readonly data?: BriefData
  }> {
    const id = normalizeWorkId(request.workId)
    if (id === undefined) return { ok: false, error: 'invalid-name' }
    const meta = await this.readWorkMeta(id)
    if (meta === undefined) return { ok: false, error: 'missing' }
    const chapters = [...await this.readChapters(id)].sort((a, b) => a.seq - b.seq || a.n - b.n)
    const target = request.chapter !== undefined
      ? chapters.find(candidate => candidate.n === request.chapter)
      : [...chapters].reverse().find(candidate => candidate.phase === 'planning') ?? chapters[chapters.length - 1]
    if (target === undefined) return { ok: false, error: 'missing' }
    const [memories, characters, experiences] = await Promise.all([
      this.readMemories(id), this.readCharacters(id), this.listExperiences({ workId: id }),
    ])
    const live = memories.filter(memory => memory.status === 'active')
    const canon = live.filter(memory => memory.layer === 'canon' && memory.reviewed)
    const foreshadows = canon.filter(memory => memory.type === 'prospective')
    const activeForeshadows = foreshadows.filter(memory => memory.specifics?.status !== 'resolved' && memory.specifics?.status !== 'abandoned')
    const currentN = chapters.reduce((max, chapter) => Math.max(max, chapter.n), 0)
    activeForeshadows.sort((a, b) => {
      const slept = (memory: MemoryRecord): number => currentN - (memory.lastActiveChapter ?? memory.specifics?.plantedAt ?? currentN)
      return slept(b) - slept(a)
    })
    const inSceneIds = new Set(target.plan?.characters ?? [])
    const inScene = characters.filter(character =>
      character.status === 'active' && (inSceneIds.has(character.id) || inSceneIds.has(character.name)))
    const previous = chapters.filter(candidate => candidate.seq < target.seq)
    const previousChapter = previous[previous.length - 1]
    const previousTail = previousChapter === undefined ? undefined : tailOf(await this.readChapterBody(meta, previousChapter))
    return {
      ok: true,
      data: {
        workTitle: meta.title,
        target,
        canonRules: canon.filter(memory => memory.type !== 'prospective' && memory.kind !== '原则'),
        principles: canon.filter(memory => memory.kind === '原则'),
        activeForeshadows,
        resolvedForeshadows: foreshadows.filter(memory => memory.specifics?.status === 'resolved'),
        outlineItems: live.filter(memory => memory.layer === 'intent' && memory.intentStatus === 'active' && memory.kind === '章节'),
        currentChapter: currentN,
        inScene: inScene.map(character => ({
          character,
          recent: experiences.filter(entry => entry.characterId === character.id).slice(-3),
        })),
        roster: characters.filter(character => character.status === 'active'),
        previousRecaps: previous.filter(candidate => candidate.recap !== undefined),
        ...(previousTail === undefined ? {} : { previousTail }),
      },
    }
  }

  /* -------------------------------------------------------------- extract */

  /**
   * The prepare half of 对账: the C-variant material pack (chapter body in
   * full, plan, the active-foreshadow whitelist, the roster, the output
   * schema). The gate is the WRITING state (stored planning + a non-empty
   * manuscript): nothing to reconcile without a body, already-extracted and
   * reviewed chapters are refused (对账只发生在写作后、审过收章前 — 审过是人工
   * 闸门，永远最后). Delegating the pack to the subagent is the main agent's
   * job; the store never delegates.
   * @param request - work id and chapter number.
   * @returns the pack text plus the whitelist, or the failure code.
   */
  async extractPrepare(request: { readonly workId: string; readonly n: number }): Promise<{
    readonly ok: boolean
    readonly error?: StoryError
    readonly text?: string
    readonly foreshadowIds?: readonly string[]
    readonly characterIds?: readonly string[]
  }> {
    const id = normalizeWorkId(request.workId)
    if (id === undefined) return { ok: false, error: 'invalid-name' }
    const meta = await this.readWorkMeta(id)
    if (meta === undefined) return { ok: false, error: 'missing' }
    const chapter = (await this.readChapters(id)).find(candidate => candidate.n === request.n)
    if (chapter === undefined) return { ok: false, error: 'missing' }
    const body = await this.readChapterBody(meta, chapter)
    if (chapter.phase !== 'planning' || body.trim() === '') return { ok: false, error: 'not-reviewed' }
    const gathered = await this.gatherBrief({ workId: id, chapter: chapter.n })
    if (!gathered.ok || gathered.data === undefined) return { ok: false, error: gathered.error ?? 'io' }
    return {
      ok: true,
      text: renderExtractBrief(gathered.data, body),
      foreshadowIds: gathered.data.activeForeshadows.map(memory => memory.id),
      characterIds: gathered.data.roster.map(character => character.id),
    }
  }

  /**
   * The import half of 对账 — plugin service code, trusting no model (the
   * five gates of proposal §5):
   *   1. evidence grep: every item's quote must appear in the chapter body,
   *      else dropped with a log entry (anti-fabrication);
   *   2. foreshadow ids must sit in the active-ledger whitelist, else dropped;
   *   3. new_* (new characters/foreshadows) ALWAYS waits for review;
   *   4. high confidence lands automatically (reviewed, 自动·可撤销);
   *      medium/low goes to the pending queue;
   *   5. plan operations verify against the recorded mentions; a planned op
   *      with no touch lands in pending as 计划落空 (「忘了还是改主意」是人答
   *      的题), and every journal mention carries planned/reconciled flags.
   * @param request - work id, chapter number, the subagent's strict JSON.
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns the reconciliation report, or the failure code.
   */
  async extractImport(
    request: { readonly workId: string; readonly n: number; readonly payload: ExtractPayload },
    session: Session,
  ): Promise<ImportReport> {
    const empty = { verified: 0, missed: 0, autoImported: 0, pending: 0, dropped: [] as ImportDrop[], pendingItems: [] as { id: string; kind: PendingKind; reason: string }[] }
    const id = normalizeWorkId(request.workId)
    if (id === undefined) return { ok: false, error: 'invalid-name', ...empty }
    const meta = await this.readWorkMeta(id)
    if (meta === undefined) return { ok: false, error: 'missing', ...empty }
    const chapter = (await this.readChapters(id)).find(candidate => candidate.n === request.n)
    if (chapter === undefined) return { ok: false, error: 'missing', ...empty }
    const body = await this.readChapterBody(meta, chapter)
    if (chapter.phase !== 'planning' || body.trim() === '') return { ok: false, error: 'not-reviewed', ...empty }
    const { payload } = request
    const dropped: ImportDrop[] = []
    const report = { verified: 0, missed: 0, autoImported: 0, pending: 0 }
    const toPending: { kind: PendingKind; confidence: 'medium' | 'low'; chapter?: number; reason: string; evidenceInText?: string; payload: PendingPayload }[] = []
    const pend = (item: (typeof toPending)[number]): void => { toPending.push(item); report.pending += 1 }
    const whitelist = new Set((await this.foreshadows(id))
      .filter(memory => memory.specifics?.status !== 'resolved' && memory.specifics?.status !== 'abandoned')
      .map(memory => memory.id))
    const roster = await this.listCharacters({ workId: id })
    const rosterIds = new Set(roster.map(character => character.id))
    const now = new Date().toISOString()

    // Gate 4 (high → auto): new memories, gated by evidence first (gate 1).
    const autoMemories: MemoryRecord[] = []
    const MEMORY_TYPE_INPUTS = ['episodic', 'semantic', 'source', 'prospective', 'emotional', 'procedural', 'implicit'] as const
    for (const raw of payload.memories ?? []) {
      const content = cleanText(raw['content'])
      const confidence = raw['confidence'] === 'high' ? 'high' : raw['confidence'] === 'low' ? 'low' : 'medium'
      const evidence = cleanText(raw['evidence_in_text'], 60)
      if (content === undefined) continue
      if (!evidenceInBody(body, evidence)) {
        dropped.push({ kind: 'memory', reason: 'evidence-not-found', ref: content.slice(0, 30) })
        continue
      }
      const typeInput = cleanText(raw['type'], 20)
      const type = MEMORY_TYPE_INPUTS.find(candidate => candidate === typeInput) ?? 'semantic'
      if (confidence === 'high') {
        report.autoImported += 1
        autoMemories.push({
          id: '', // allocated in the table write below
          owner: cleanText(raw['owner'], 40) ?? 'creator',
          type,
          layer: 'canon',
          content,
          status: 'active',
          reviewed: true,
          confidence: 'high',
          extractedBy: 'llm',
          autoImported: true,
          evidenceInText: evidence!,
          firstChapter: chapter.n,
          lastActiveChapter: chapter.n,
          createdAt: now,
          updatedAt: now,
        })
      } else {
        pend({
          kind: 'memory', confidence, chapter: chapter.n, reason: `置信度 ${confidence}`,
          payload: { content, owner: cleanText(raw['owner'], 40) ?? 'creator', type, confidence },
          ...(evidence === undefined ? {} : { evidenceInText: evidence }),
        })
      }
    }

    // Mentions: whitelist (gate 2) + evidence (gate 1); high records, medium/low pends.
    const recordedMentions: { id: string; kind: MentionEntry['kind'] }[] = []
    const journalLines: Record<string, unknown>[] = []
    const touch = new Map<string, { readonly kind: MentionEntry['kind']; readonly answer?: string }>()
    for (const raw of payload.foreshadow_mentions ?? []) {
      const foreshadowId = foreshadowIdOf(raw['foreshadow_id'])
      const kind = cleanText(raw['kind'], 20)
      const mentionKind = kind === 'planted' || kind === 'advanced' || kind === 'hinted' || kind === 'resolved' ? kind : undefined
      if (foreshadowId === undefined || mentionKind === undefined) continue
      if (!whitelist.has(foreshadowId)) {
        dropped.push({ kind: 'mention', reason: 'id-not-in-ledger', ref: String(raw['foreshadow_id'] ?? '') })
        continue
      }
      const evidence = cleanText(raw['evidence_in_text'], 60)
      if (!evidenceInBody(body, evidence)) {
        dropped.push({ kind: 'mention', reason: 'evidence-not-found', ref: foreshadowId })
        continue
      }
      const confidence = raw['confidence'] === 'high' ? 'high' : raw['confidence'] === 'low' ? 'low' : 'medium'
      const note = cleanText(raw['note'], 200)
      const answer = cleanText(raw['answer'], 500)
      if (confidence === 'high') {
        recordedMentions.push({ id: foreshadowId, kind: mentionKind })
        touch.set(foreshadowId, { kind: mentionKind, ...(answer === undefined ? {} : { answer }) })
        journalLines.push({
          foreshadowId, chapter: chapter.n, kind: mentionKind,
          planned: (chapter.plan?.foreshadowOps ?? []).some(op => foreshadowIdOf(op.id) === foreshadowId),
          reconciled: true,
          ...(note === undefined ? {} : { note }),
          createdAt: now,
        } satisfies Record<string, unknown>)
      } else {
        pend({
          kind: 'mention', confidence, chapter: chapter.n, reason: `疑似提及（置信度 ${confidence}）`,
          payload: { foreshadowId, kind: mentionKind, ...(note === undefined ? {} : { note }), ...(answer === undefined ? {} : { answer }) },
          ...(evidence === undefined ? {} : { evidenceInText: evidence }),
        })
      }
    }

    // Gate 3: new_* always pends (evidence still greps — gate 1).
    for (const raw of payload.new_foreshadows ?? []) {
      const question = cleanText(raw['question'], 200)
      if (question === undefined) continue
      const evidence = cleanText(raw['evidence_in_text'], 60)
      if (!evidenceInBody(body, evidence)) {
        dropped.push({ kind: 'new-foreshadow', reason: 'evidence-not-found', ref: question.slice(0, 30) })
        continue
      }
      const tension = typeof raw['tension'] === 'number' && Number.isFinite(raw['tension']) ? Math.min(5, Math.max(1, Math.round(raw['tension']))) : undefined
      pend({
        kind: 'new-foreshadow', confidence: 'medium', chapter: chapter.n, reason: '新伏笔必待审',
        payload: { question, ...(tension === undefined ? {} : { tension }) },
        ...(evidence === undefined ? {} : { evidenceInText: evidence }),
      })
    }
    for (const raw of payload.new_characters ?? []) {
      const name = cleanText(raw['name'], 80)
      if (name === undefined) continue
      const evidence = cleanText(raw['evidence_in_text'], 60)
      if (!evidenceInBody(body, evidence)) {
        dropped.push({ kind: 'new-character', reason: 'evidence-not-found', ref: name })
        continue
      }
      pend({
        kind: 'new-character', confidence: 'medium', chapter: chapter.n, reason: '新角色必进待审',
        payload: { name, ...(cleanText(raw['identity'], 200) === undefined ? {} : { identity: cleanText(raw['identity'], 200)! }) },
        ...(evidence === undefined ? {} : { evidenceInText: evidence }),
      })
    }

    // Experiences + current states: roster-checked, evidence-gated, high lands / medium-low pends.
    // Automatic experience lines carry an id (the retract gesture's handle) and the 自动·可撤销 mark.
    const experienceLines: Record<string, unknown>[] = []
    let experienceNext = (await this.listExperiences({ workId: id })).reduce((max, row) => {
      const match = /^e(\d+)$/.exec(row.id ?? '')
      return match === null ? max : Math.max(max, Number(match[1]))
    }, 0) + 1
    const stateUpdates = new Map<string, CharacterRecord['currentState']>()
    for (const raw of payload.experiences ?? []) {
      const characterId = cleanText(raw['character_id'], 40)
      const entry = cleanText(raw['entry'], 500)
      if (characterId === undefined || entry === undefined) continue
      if (!rosterIds.has(characterId)) {
        dropped.push({ kind: 'experience', reason: 'character-not-in-roster', ref: characterId })
        continue
      }
      const evidence = cleanText(raw['evidence_in_text'], 60)
      if (!evidenceInBody(body, evidence)) {
        dropped.push({ kind: 'experience', reason: 'evidence-not-found', ref: characterId })
        continue
      }
      const confidence = raw['confidence'] === 'high' ? 'high' : raw['confidence'] === 'low' ? 'low' : 'medium'
      if (confidence === 'high') {
        experienceLines.push({ id: `e${experienceNext}`, characterId, chapter: chapter.n, entry, autoImported: true, createdAt: now })
        experienceNext += 1
      } else {
        pend({
          kind: 'experience', confidence, chapter: chapter.n, reason: `置信度 ${confidence}`,
          payload: { characterId, entry },
          ...(evidence === undefined ? {} : { evidenceInText: evidence }),
        })
      }
    }
    for (const raw of payload.current_states ?? []) {
      const characterId = cleanText(raw['character_id'], 40)
      if (characterId === undefined || !rosterIds.has(characterId)) continue
      if (raw['confidence'] !== 'high') continue
      stateUpdates.set(characterId, {
        ...(cleanText(raw['where'], 200) === undefined ? {} : { where: cleanText(raw['where'], 200)! }),
        ...(cleanText(raw['state'], 200) === undefined ? {} : { state: cleanText(raw['state'], 200)! }),
        ...(cleanText(raw['concern'], 200) === undefined ? {} : { concern: cleanText(raw['concern'], 200)! }),
      })
    }

    // Gate 5: plan verification against what the chapter actually touched.
    const newForeshadowPending = toPending.filter(item => item.kind === 'new-foreshadow').length
    for (const op of chapter.plan?.foreshadowOps ?? []) {
      const wanted = OP_TO_MENTION[op.op]
      const opId = foreshadowIdOf(op.id)
      const touched = opId === undefined ? [] : recordedMentions.filter(mention => mention.id === opId)
      const exact = touched.some(mention => mention.kind === wanted)
      const anyTouch = touched.length > 0 || (op.op === '新埋' && newForeshadowPending > 0)
      if (exact || anyTouch) {
        report.verified += 1
      } else {
        report.missed += 1
        pend({
          kind: 'plan-missed', confidence: 'medium', chapter: chapter.n,
          reason: `计划落空：${op.op}${opId === undefined ? (op.question === undefined ? '' : ` [${op.question}]`) : ` [#${opId.slice(1)}]`} —— 忘了还是改主意？`,
          payload: { op: op.op, ...(op.id === undefined ? {} : { id: op.id }), ...(op.question === undefined ? {} : { question: op.question }) },
        })
      }
    }

    // The guarded writes, one file at a time (ids allocate inside each).
    if (autoMemories.length > 0 || touch.size > 0) {
      const written = await this.mutateJson(
        await this.fileTarget(id, WORK_FILES.memories), session,
        raw => normalizeMemoryTable(raw),
        () => ({ version: 1 as const, memories: [] }),
        (table, timestamp) => {
          let next = table.memories.reduce((max, row) => Math.max(max, memoryNumberOf(row.id)), 0) + 1
          for (const memory of autoMemories) {
            table.memories.push({ ...memory, id: `m${next}` })
            next += 1
          }
          for (const [foreshadowId, mark] of touch) {
            const row = table.memories.find(candidate => candidate.id === foreshadowId)
            if (row === undefined) continue
            const mutable = row as { -readonly [K in keyof MemoryRecord]: MemoryRecord[K] }
            mutable.lastActiveChapter = chapter.n
            if (mark.kind === 'resolved') {
              mutable.specifics = { ...row.specifics, status: 'resolved', ...(mark.answer === undefined ? {} : { answer: mark.answer }) }
            } else if (row.specifics !== undefined) {
              mutable.specifics = { ...row.specifics, status: mark.kind }
            }
            mutable.updatedAt = timestamp
          }
          return table
        },
      )
      if (!written.ok) return { ok: false, error: written.error, ...empty, dropped }
    }
    const appendedMentions = await this.appendJsonl(await this.fileTarget(id, WORK_FILES.mentions), session, journalLines)
    if (!appendedMentions.ok) return { ok: false, error: appendedMentions.error ?? 'io', ...empty, dropped }
    const appendedExperiences = await this.appendJsonl(await this.fileTarget(id, WORK_FILES.experiences), session, experienceLines)
    if (!appendedExperiences.ok) return { ok: false, error: appendedExperiences.error ?? 'io', ...empty, dropped }
    if (stateUpdates.size > 0) {
      const written = await this.mutateJson(
        await this.fileTarget(id, WORK_FILES.characters), session,
        raw => normalizeCharacterTable(raw),
        undefined,
        (table, timestamp) => {
          for (const [characterId, currentState] of stateUpdates) {
            const row = table.characters.find(candidate => candidate.id === characterId)
            if (row === undefined) continue
            const mutable = row as { -readonly [K in keyof CharacterRecord]: CharacterRecord[K] }
            mutable.currentState = currentState
            mutable.updatedAt = timestamp
          }
          return table
        },
      )
      if (!written.ok) return { ok: false, error: written.error, ...empty, dropped }
    }
    const recap = cleanText(payload.recap, 500)
    const chapterWritten = await this.mutateJson(
      await this.fileTarget(id, WORK_FILES.chapters), session,
      raw => normalizeChapterTable(raw),
      undefined,
      (table, timestamp) => {
        const row = table.chapters.find(candidate => candidate.n === chapter.n)
        if (row === undefined) return 'missing'
        const mutable = row as { -readonly [K in keyof ChapterRecord]: ChapterRecord[K] }
        mutable.phase = 'extracted'
        if (recap !== undefined) mutable.recap = recap
        mutable.wordCount = typeof payload.word_count === 'number' && Number.isFinite(payload.word_count)
          ? Math.max(0, Math.round(payload.word_count))
          : body.replace(/\s+/g, '').length
        mutable.updatedAt = timestamp
        return table
      },
    )
    if (!chapterWritten.ok) return { ok: false, error: chapterWritten.error, ...empty, dropped }

    // The pending queue lands last (its ids allocate max+1 inside the write).
    const pendingItems: { id: string; kind: PendingKind; reason: string }[] = []
    if (toPending.length > 0) {
      const written = await this.mutateJson(
        await this.fileTarget(id, WORK_FILES.pending), session,
        raw => normalizePendingTable(raw),
        () => ({ version: 1 as const, items: [] }),
        (table, timestamp) => {
          let next = table.items.reduce((max, row) => {
            const match = /^p(\d+)$/.exec(row.id)
            return match === null ? max : Math.max(max, Number(match[1]))
          }, 0) + 1
          for (const item of toPending) {
            const idText = `p${next}`
            next += 1
            table.items.push({
              id: idText,
              kind: item.kind,
              confidence: item.confidence,
              ...(item.chapter === undefined ? {} : { chapter: item.chapter }),
              reason: item.reason,
              ...(item.evidenceInText === undefined ? {} : { evidenceInText: item.evidenceInText }),
              payload: item.payload,
              status: 'pending',
              createdAt: timestamp,
            })
            pendingItems.push({ id: idText, kind: item.kind, reason: item.reason })
          }
          return table
        },
      )
      if (!written.ok) return { ok: false, error: written.error, ...empty, dropped }
    }
    return { ok: true, ...report, dropped, pendingItems }
  }

  /* -------------------------------------------------------------- pending */

  /** Read the pending queue. */
  private async readPendingItems(workId: string): Promise<PendingItem[]> {
    const read = await this.readJson(await this.fileTarget(workId, WORK_FILES.pending), raw => normalizePendingTable(raw))
    return typeof read === 'object' ? read.data.items : []
  }

  /** List the pending queue (unresolved only, unless asked for history). */
  async listPending(request: { readonly workId: string; readonly includeResolved?: boolean }): Promise<PendingItem[]> {
    const id = normalizeWorkId(request.workId)
    if (id === undefined) return []
    const items = await this.readPendingItems(id)
    return items.filter(item => request.includeResolved === true || item.status === 'pending')
  }

  /**
   * The person's answer to one pending item. accept materializes the payload
   * through the same doors the writes use (a memory, a mention journal line,
   * a character, a foreshadow, an experience — plan-missed has nothing to
   * materialize: the answer IS the resolution); discard just settles the
   * item. Settled items stay in the table (the queue is a snapshot, and the
   * trail matters).
   * @param request - work id, item id, the action.
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns the receipt, or the failure code.
   */
  async decidePending(
    request: { readonly workId: string; readonly id: string; readonly action: 'accept' | 'discard' },
    session: Session,
  ): Promise<{ readonly ok: boolean; readonly error?: StoryError }> {
    const workId = normalizeWorkId(request.workId)
    if (workId === undefined) return { ok: false, error: 'invalid-name' }
    const items = await this.readPendingItems(workId)
    const item = items.find(candidate => candidate.id === request.id)
    if (item === undefined) return { ok: false, error: 'missing' }
    if (item.status !== 'pending') return { ok: false, error: 'invalid-name' }
    if (request.action === 'accept') {
      const applied = await this.materializePending(workId, item, session)
      if (applied !== undefined) return { ok: false, error: applied }
    }
    const settled = await this.mutateJson(
      await this.fileTarget(workId, WORK_FILES.pending), session,
      raw => normalizePendingTable(raw),
      undefined,
      (table, now) => {
        const row = table.items.find(candidate => candidate.id === request.id)
        if (row === undefined) return 'missing'
        const mutable = row as { -readonly [K in keyof PendingItem]: PendingItem[K] }
        mutable.status = request.action === 'accept' ? 'accepted' : 'discarded'
        mutable.resolvedAt = now
        return table
      },
    )
    return settled.ok ? { ok: true } : { ok: false, error: settled.error }
  }

  /** Materialize one accepted pending item; undefined on success, the failure code otherwise. */
  private async materializePending(workId: string, item: PendingItem, session: Session): Promise<StoryError | undefined> {
    const now = new Date().toISOString()
    if (item.kind === 'memory') {
      const outcome = await this.writeMemory({
        workId,
        content: cleanText(item.payload['content']) ?? item.reason,
        ...(cleanText(item.payload['type'], 20) === undefined ? {} : { type: cleanText(item.payload['type'], 20) as MemoryRecord['type'] }),
        ...(cleanText(item.payload['owner'], 40) === undefined ? {} : { owner: cleanText(item.payload['owner'], 40)! }),
        layer: 'canon',
        confidence: item.confidence,
        ...(item.evidenceInText === undefined ? {} : { evidenceInText: item.evidenceInText }),
        ...(item.chapter === undefined ? {} : { chapter: item.chapter }),
      }, session, 'agent')
      // Accepted by a person: stamp reviewed, whatever the origin wrote.
      if (outcome.ok && outcome.memory !== undefined) {
        const reviewed = await this.decideMemory({ workId, id: outcome.memory.id, action: 'accept' }, session)
        return reviewed.ok ? undefined : reviewed.error
      }
      return outcome.ok ? 'io' : outcome.error
    }
    if (item.kind === 'mention') {
      const foreshadowId = foreshadowIdOf(item.payload['foreshadowId'])
      const kind = cleanText(item.payload['kind'], 20)
      if (foreshadowId === undefined || (kind !== 'planted' && kind !== 'advanced' && kind !== 'hinted' && kind !== 'resolved')) return 'invalid-name'
      const appended = await this.appendJsonl(await this.fileTarget(workId, WORK_FILES.mentions), session, [{
        foreshadowId,
        chapter: item.chapter ?? 0,
        kind,
        planned: false,
        reconciled: true,
        ...(cleanText(item.payload['note'], 200) === undefined ? {} : { note: cleanText(item.payload['note'], 200)! }),
        createdAt: now,
      }])
      if (!appended.ok) return appended.error
      const touched = await this.mutateJson(
        await this.fileTarget(workId, WORK_FILES.memories), session,
        raw => normalizeMemoryTable(raw),
        undefined,
        (table, timestamp) => {
          const row = table.memories.find(candidate => candidate.id === foreshadowId)
          if (row === undefined) return 'missing'
          const mutable = row as { -readonly [K in keyof MemoryRecord]: MemoryRecord[K] }
          if (item.chapter !== undefined) mutable.lastActiveChapter = item.chapter
          if (kind === 'resolved') {
            mutable.specifics = {
              ...row.specifics,
              status: 'resolved',
              ...(cleanText(item.payload['answer'], 500) === undefined ? {} : { answer: cleanText(item.payload['answer'], 500)! }),
            }
          } else if (row.specifics !== undefined) {
            mutable.specifics = { ...row.specifics, status: kind }
          }
          mutable.updatedAt = timestamp
          return table
        },
      )
      return touched.ok ? undefined : touched.error
    }
    if (item.kind === 'new-foreshadow') {
      const question = cleanText(item.payload['question'], 200)
      if (question === undefined) return 'invalid-name'
      const tension = typeof item.payload['tension'] === 'number' ? item.payload['tension'] : undefined
      const outcome = await this.writeMemory({
        workId,
        content: question,
        type: 'prospective',
        layer: 'canon',
        confidence: 'medium',
        specifics: { question, status: 'planted', ...(tension === undefined ? {} : { tension }), ...(item.chapter === undefined ? {} : { plantedAt: item.chapter }) },
        ...(item.evidenceInText === undefined ? {} : { evidenceInText: item.evidenceInText }),
        ...(item.chapter === undefined ? {} : { chapter: item.chapter }),
      }, session, 'agent')
      if (outcome.ok && outcome.memory !== undefined) {
        const reviewed = await this.decideMemory({ workId, id: outcome.memory.id, action: 'accept' }, session)
        return reviewed.ok ? undefined : reviewed.error
      }
      return outcome.ok ? 'io' : outcome.error
    }
    if (item.kind === 'new-character') {
      const name = cleanText(item.payload['name'], 80)
      if (name === undefined) return 'invalid-name'
      const outcome = await this.writeCharacter({
        workId,
        name,
        ...(cleanText(item.payload['identity'], 200) === undefined ? {} : { identity: cleanText(item.payload['identity'], 200)! }),
      }, session)
      return outcome.ok ? undefined : outcome.error
    }
    if (item.kind === 'experience') {
      const characterId = cleanText(item.payload['characterId'], 40)
      const entry = cleanText(item.payload['entry'], 500)
      if (characterId === undefined || entry === undefined) return 'invalid-name'
      const experienceNext = (await this.listExperiences({ workId })).reduce((max, row) => {
        const match = /^e(\d+)$/.exec(row.id ?? '')
        return match === null ? max : Math.max(max, Number(match[1]))
      }, 0) + 1
      const appended = await this.appendJsonl(await this.fileTarget(workId, WORK_FILES.experiences), session, [{
        id: `e${experienceNext}`,
        characterId,
        chapter: item.chapter ?? 0,
        entry,
        createdAt: now,
      }])
      return appended.ok ? undefined : appended.error
    }
    // plan-missed: the person's answer is the resolution — nothing materializes.
    return undefined
  }
}

/** The last ~200 characters of a manuscript (the write brief's 上一章末段). */
export function tailOf(body: string, max = 200): string | undefined {
  const trimmed = body.trim()
  if (trimmed === '') return undefined
  return trimmed.length <= max ? trimmed : `……${trimmed.slice(-max)}`
}

/** Tolerant readers for the four JSON documents (the store's read gate). */
function normalizeMemoryTable(raw: unknown): MemoryTable | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const rows = (raw as Record<string, unknown>)['memories']
  if (!Array.isArray(rows)) return undefined
  return { version: 1, memories: rows.map(normalizeMemory).filter((row): row is MemoryRecord => row !== undefined) }
}

function normalizeCharacterTable(raw: unknown): CharacterTable | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const rows = (raw as Record<string, unknown>)['characters']
  if (!Array.isArray(rows)) return undefined
  return { version: 1, characters: rows.map(normalizeCharacter).filter((row): row is CharacterRecord => row !== undefined) }
}

function normalizeChapterTable(raw: unknown): ChapterTable | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const rows = (raw as Record<string, unknown>)['chapters']
  if (!Array.isArray(rows)) return undefined
  return { version: 1, chapters: rows.map(normalizeChapter).filter((row): row is ChapterRecord => row !== undefined) }
}

function normalizePendingTable(raw: unknown): PendingTable | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const rows = (raw as Record<string, unknown>)['items']
  if (!Array.isArray(rows)) return undefined
  return { version: 1, items: rows.map(normalizePendingItem).filter((row): row is PendingItem => row !== undefined) }
}

/** Tolerant read of one experience journal line. */
function normalizeExperience(raw: unknown): ExperienceEntry | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  const characterId = cleanText(record['characterId'], 40)
  const chapter = typeof record['chapter'] === 'number' && Number.isFinite(record['chapter']) ? record['chapter'] : undefined
  const entry = cleanText(record['entry'], 500)
  if (characterId === undefined || chapter === undefined || entry === undefined) return undefined
  const id = cleanText(record['id'], 40)
  return {
    characterId,
    chapter,
    entry,
    ...(id === undefined ? {} : { id }),
    ...(record['autoImported'] === true ? { autoImported: true } : {}),
    createdAt: cleanText(record['createdAt'], 40) ?? '',
  }
}

/** Tolerant read of one mention journal line. */
function normalizeMention(raw: unknown): MentionEntry | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  const foreshadowId = cleanText(record['foreshadowId'], 40)
  const chapter = typeof record['chapter'] === 'number' && Number.isFinite(record['chapter']) ? record['chapter'] : undefined
  const kind = record['kind']
  if (foreshadowId === undefined || chapter === undefined
    || (kind !== 'planted' && kind !== 'advanced' && kind !== 'hinted' && kind !== 'resolved')) return undefined
  const note = cleanText(record['note'], 200)
  return {
    foreshadowId,
    chapter,
    kind,
    planned: record['planned'] === true,
    reconciled: record['reconciled'] === true,
    ...(note === undefined ? {} : { note }),
    createdAt: cleanText(record['createdAt'], 40) ?? '',
  }
}

export default StoryBibleService
