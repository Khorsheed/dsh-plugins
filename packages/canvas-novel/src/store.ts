/**
 * The canvas-novel's service core (`ctx.canvasNovel`). A work is a canvas
 * whose genre is `novel`: the engine keeps no registry and no focus of its
 * own. Title and workspace are read off the board per call (the canvas
 * service is probed — without it there are no works), and a session's work
 * is the canvas it is bound to (the canvas binding chip).
 *
 * The board's cards are the single source of truth for what gets injected
 * into writing: characters, world rules, principles and foreshadows are
 * cards in the genre's role categories, written through the canvas service
 * (`putCard` / `proposeCard` / `patchCard`) and never copied. The engine's
 * own state lives under `$DSH_HOME/state/novel/<canvasId>/`: the sidecar
 * (`annotations.json` — per-work refs and the audit notes, keyed by card id),
 * the chapter index, the pending queue and the three journals.
 *
 * That state root is deployment-level state, NOT a session workspace, and the
 * fence reflects that — the canvas store's exact pattern: the CALLING session
 * resolves the MODE (a read-only deployment stays read-only) and lends its id
 * to the write, while the writable boundary re-roots at the plugin's own
 * state dir. Every document write goes through the mounted `ctx.fs` under a
 * version guard (read → apply → replaceIfVersion, one stale retry); the
 * JSONL journals append by guarded read-concat-write, so a lost race retries
 * instead of clobbering (ctx.fs has no append verb; bare node:fs is never
 * used for state).
 *
 * @module @khorsheed/dsh-canvas-novel
 */
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { FsError, FsVersion, type FsTarget } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import type { Session } from '@deepseek-ai/dsh-session'
import { renderExtractBrief, type BriefData } from './brief.ts'
import {
  canvasBoardOf, NOVEL_GENRE, NOVEL_ROLES, WORLD_KINDS,
  type CanvasBoardSlice, type NovelBoardMutation, type NovelBoardView, type NovelCardSource, type NovelCardView,
  type NovelFieldValue,
} from './genre.ts'
import {
  chapterFileName, cleanNumber, cleanText, deriveForeshadowState, effectiveChapterPhase, isOverdue, laterForeshadowState, linesOf, MENTION_TO_STATE,
  normalizeAnnotations, normalizeChapter, normalizePendingItem, normalizePlan, normalizeWorkId, NOVEL_GENRE_ID,
  nextMilestoneOf, normalizeRelationEntry, OP_TO_MENTION, parseRef, PTS_PER_LEVEL, MAX_RELATION_DELTA, readRelationStage,
  refGroupOf, refOf, relationEventOf, relationMove, typeChangeOf, relationProgress, relationTypeOf, stageNameOf,
  type Annotations, type CardNote, type ChapterRecord, type ChapterRow, type ChapterTable, type CharacterView, type Confidence,
  type CurrentState, type EffectiveChapterPhase, type EntryRole, type ExperienceEntry, type ExtractPayload,
  type ForeshadowView, type ImportDrop, type ImportReport, type LedgerResult, type MentionEntry, type NovelError,
  type PendingItem, type PendingKind, type PendingPayload, type PendingTable, type RefGroup, type RelationEntry, type RelationEvent,
  type RelationType, type RelationView, type RuleView, type WorkMeta, type WriteChapterRequest,
} from './types.ts'

/** The state directory name under `$DSH_HOME/state`. */
export const NOVEL_STATE_DIR_NAME = 'novel'

/** Per-work file names, under `<stateRoot>/<canvasId>/`. */
export const WORK_FILES = {
  annotations: 'annotations.json',
  experiences: 'experiences.jsonl',
  mentions: 'mentions.jsonl',
  relations: 'relations.jsonl',
  chapters: 'chapters.json',
  pending: 'pending.json',
} as const

/**
 * Resolve the novel state root (the canvas/datasets precedent): an explicit
 * value wins, then `$DSH_HOME/state/novel`, then `<cwd>/.dsh-novel`.
 * @param configured - plugin-provided override, or ''/undefined.
 * @returns the state root directory.
 */
export function resolveNovelStateRoot(configured: string | undefined): string {
  if (configured !== undefined && configured !== '') return configured
  const home = process.env.DSH_HOME
  if (home !== undefined && home !== '') return join(home, 'state', NOVEL_STATE_DIR_NAME)
  return join(process.cwd(), '.dsh-novel')
}

/** Map one thrown fs value onto the store's failure codes. */
export function novelErrorOf(error: unknown): NovelError {
  if (error instanceof FsError) {
    if (error.code === 'FS_STALE_VERSION' || error.code === 'FS_NOT_OBSERVED') return 'stale'
    if (error.code === 'FS_SANDBOX_DENIED') return 'denied'
    if (error.code === 'FS_NOT_FOUND') return 'missing'
  }
  return 'io'
}

/** Map one canvas failure code onto the store's (the two vocabularies share their common codes). */
function canvasErrorOf(error: string): NovelError {
  return error === 'invalid-name' || error === 'missing' || error === 'stale' || error === 'denied' ? error : 'io'
}

/** Plugin config for the novel service; every key is optional. */
export interface NovelConfig {
  /** State root override (defaults to `$DSH_HOME/state/novel`). */
  stateRoot?: string
}

/** One document read: the data plus the freshness token, or which way it failed. */
type DocumentRead<T> = { readonly data: T; readonly version: string } | 'missing' | 'corrupt'

/** One mutation's receipt. */
type Mutation<T> = { readonly ok: true; readonly data: T; readonly created: boolean } | { readonly ok: false; readonly error: NovelError }

/** A mention's evidence grep: exact substring first, then a whitespace-tolerant pass (line wraps are not fabrication). */
export function evidenceInBody(body: string, evidence: string | undefined): boolean {
  if (evidence === undefined) return false
  const needle = evidence.trim()
  if (needle.length === 0) return false
  if (body.includes(needle)) return true
  const squash = (text: string): string => text.replace(/\s+/g, ' ')
  return squash(body).includes(squash(needle))
}

/** The field that carries each role's main text (the card's face line). */
export const MAIN_FIELD: Readonly<Record<EntryRole, string>> = {
  character: 'name',
  world: 'rule',
  principle: 'principle',
  foreshadow: 'question',
  relation: 'name',
}

const ENTRY_ROLES = Object.values(NOVEL_ROLES) as EntryRole[]

/** A foreshadow the ledger still owes the reader (not yet resolved or dropped). */
function isLiveForeshadow(view: ForeshadowView): boolean {
  return view.state === '已埋' || view.state === '推进中'
}

/** One card field read as display text (numbers stringify, lists join). */
function fieldText(card: NovelCardView, key: string, max = 2000): string | undefined {
  const value = card.fields?.[key]
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return cleanText(value.join('\n'), max)
  return cleanText(value, max)
}

/** A card's main text: its role's main field, else the card's free text. */
function mainTextOf(card: NovelCardView, role: EntryRole): string {
  return fieldText(card, MAIN_FIELD[role]) ?? cleanText(card.text) ?? ''
}

/**
 * Whether a new card of this role has every field its card type requires
 * (a character its name; a world card its name and its setting; …).
 * @param role - the role.
 * @param fields - the cleaned fields.
 */
export function hasRequiredFields(role: EntryRole, fields: Readonly<Record<string, NovelFieldValue>>): boolean {
  const defs = NOVEL_GENRE.categories.find(category => category.role === role)?.definition?.fields ?? []
  return defs.every(def => def.required !== true || fields[def.key] !== undefined)
}

/**
 * The live card a new character or world card would duplicate: one of the
 * same role and the same name that is not archived. Names are what the model and the user tell
 * these cards apart by; two 艾文 cards are always a mistake.
 * @param entries - the work's entries.
 * @param role - the role of the card about to be written.
 * @param name - its name.
 * @returns the existing card's id and ref, or undefined.
 */
export function namesake(entries: WorkEntries, role: EntryRole, name: string | undefined): { readonly cardId: string; readonly ref: string } | undefined {
  if (name === undefined) return undefined
  const views = role === 'character' ? entries.characters.map(view => ({ ...view, status: view.cardStatus }))
    : role === 'world' ? entries.rules.filter(view => view.role === 'world').map(view => ({ ...view, name: view.name ?? '' }))
      : []
  const found = views.find(view => view.status !== 'archived' && view.name === name)
  return found === undefined ? undefined : { cardId: found.cardId, ref: found.ref }
}

/**
 * A setting's title when the subagent gave none: its first clause, short —
 * so a world card never reaches the board without a name.
 * @param content - the setting.
 */
export function settingNameOf(content: string): string {
  const clause = content.split(/[，。；：、,.;:！？!?\n]/)[0]!.trim()
  return (clause === '' ? content : clause).slice(0, 16)
}

/**
 * Lay a manuscript out as paragraphs. Chinese prose breaks a paragraph with
 * one newline, but markdown joins single-newline lines into one paragraph —
 * a chapter sent that way renders as a single wall of text. A body with no
 * blank line at all therefore gets one between every line; a body that
 * already has blank lines is the author's own layout and is kept as is.
 * @param content - the manuscript as sent.
 * @returns the manuscript to write.
 */
export function manuscriptParagraphs(content: string): string {
  const body = content.replace(/\r\n?/g, '\n').replace(/^\n+/, '').trimEnd()
  if (/\n[ \t\u3000]*\n/.test(body)) return content
  const paragraphs = body.split('\n').map(line => line.trimEnd())
  return paragraphs.length <= 1 ? content : `${paragraphs.join('\n\n')}\n`
}

/** The foreshadow states a write may set: the rest come from the mention journal. */
const HAND_SET_FORESHADOW_STATES: ReadonlySet<string> = new Set(['未埋', '已埋', '已放弃'])

/**
 * Check agent-sent fields against the genre's seeded card type for a role:
 * known keys only, select values from their options, numbers as numbers,
 * lists joined one item per line (一行一件). A foreshadow's status takes only
 * the hand-set states — 推进中 and 已揭晓 follow from what the chapters do.
 * @returns the accepted fields and the keys that were ignored.
 */
export function cleanFields(role: EntryRole, raw: unknown): { readonly fields: Record<string, NovelFieldValue>; readonly ignored: string[] } {
  const defs = NOVEL_GENRE.categories.find(category => category.role === role)?.definition?.fields ?? []
  const fields: Record<string, NovelFieldValue> = {}
  const ignored: string[] = []
  if (typeof raw !== 'object' || raw === null) return { fields, ignored }
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const def = defs.find(candidate => candidate.key === key)
    if (def === undefined) {
      ignored.push(key)
      continue
    }
    if (def.type === 'number') {
      const n = cleanNumber(typeof value === 'string' ? Number(value) : value)
      if (n === undefined) ignored.push(key)
      else fields[key] = n
      continue
    }
    if (def.type === 'ref') {
      // Card handles (ids, refs or names), resolved by the caller against the work's cards.
      const tokens = (Array.isArray(value) ? value : [value])
        .map(token => cleanText(typeof token === 'number' ? String(token) : token, 80))
        .filter((token): token is string => token !== undefined)
      if (tokens.length === 0) ignored.push(key)
      else fields[key] = tokens
      continue
    }
    const text = Array.isArray(value) ? cleanText(value.map(String).join('\n')) : cleanText(typeof value === 'number' ? String(value) : value)
    if (text === undefined || (def.options !== undefined && !def.options.includes(text)) || (role === 'foreshadow' && key === 'status' && !HAND_SET_FORESHADOW_STATES.has(text))) {
      ignored.push(key)
      continue
    }
    fields[key] = text
  }
  return { fields, ignored }
}

/**
 * One work's cards, read for the brief and the ledger: the four role views,
 * plus what the engine needs to resolve refs (role by card id, the sidecar).
 */
export interface WorkEntries {
  readonly board: NovelBoardView
  readonly annotations: Annotations
  /** The role of every card in one of the four role categories (any status). */
  readonly roleOf: ReadonlyMap<string, EntryRole>
  readonly rules: readonly RuleView[]
  readonly foreshadows: readonly ForeshadowView[]
  readonly characters: readonly CharacterView[]
  readonly relations: readonly RelationView[]
  /** The newest chapter number — the sleeping baseline. */
  readonly currentChapter: number
}

/** A resolved card: its id and role. */
export interface CardHandle {
  readonly cardId: string
  readonly role: EntryRole
}

/** The empty sidecar. */
function emptyAnnotations(): Annotations {
  return { version: 1, refs: {}, notes: {} }
}

/**
 * The canvas-novel's service core. Stateless apart from the context it borrows
 * for `ctx.fs` and the canvas, and the policy home it resolves each caller's
 * mode through.
 */
export class NovelService {
  static inject = ['fs']

  /** The resolved state root (also the writable boundary of every fence). */
  readonly stateRoot: string

  /** The per-session policy home, captured only when the mounted filesystem actually confines. */
  private readonly sandboxPolicy: SandboxPolicyService | undefined

  /**
   * @param ctx - host context carrying the mounted filesystem.
   * @param config - optional state-root override.
   */
  constructor(
    private readonly ctx: Context,
    config: NovelConfig = {},
  ) {
    this.stateRoot = resolveNovelStateRoot(config.stateRoot)
    this.sandboxPolicy = ctx.fs.sandboxMode === undefined ? undefined : ctx.get('sandboxPolicy')
  }

  private get fs(): Context['fs'] {
    return this.ctx.fs
  }

  /** The canvas service, probed per call (absent → no works). */
  private get canvas(): CanvasBoardSlice | undefined {
    return canvasBoardOf(this.ctx)
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

  /** The manuscript file one chapter record points at (`<workspace>/<title>/第{n}章.md`, the single source of truth). */
  private bodyPath(work: WorkMeta, chapter: ChapterRecord): string | undefined {
    return work.workspace === undefined ? undefined : join(work.workspace, work.title, chapter.file)
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
    change: (data: T, now: string) => T | NovelError,
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
        const code = novelErrorOf(error)
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
  ): Promise<{ readonly ok: boolean; readonly error?: NovelError }> {
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
        if (!(error instanceof FsError && error.code === 'FS_NOT_FOUND')) return { ok: false, error: novelErrorOf(error) }
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
        const code = novelErrorOf(error)
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

  /* ---------------------------------------------------------------- works */

  /** The board of a novel work, or undefined (no canvas, no board, not this genre). */
  private async readNovelBoard(workId: string): Promise<NovelBoardView | undefined> {
    const id = normalizeWorkId(workId)
    const canvas = this.canvas
    if (id === undefined || canvas === undefined) return undefined
    const read = await canvas.readBoard({ canvasId: id })
    if (!read.ok || read.board.genre?.id !== NOVEL_GENRE_ID) return undefined
    return read.board
  }

  /**
   * One work's view, read off its canvas: the gate every per-work verb passes
   * first. A canvas that is missing, unreadable or not of the novel genre is
   * no work (undefined), and so is every canvas when the canvas is absent.
   * @param workId - the canvas id.
   * @returns the work view, or undefined.
   */
  async readWorkMeta(workId: string): Promise<WorkMeta | undefined> {
    const board = await this.readNovelBoard(workId)
    return board === undefined ? undefined : { id: board.id, title: board.title, workspace: board.attachedWorkspaces[0] }
  }

  /**
   * The work one session writes into: the canvas it is bound to, when that
   * canvas is a novel work. The sidebar's focus never counts — a writing
   * session perceives only its bound canvas.
   * @param sessionId - the session.
   * @returns the work view, or undefined.
   */
  async boundWork(sessionId: string): Promise<WorkMeta | undefined> {
    const canvas = this.canvas
    if (canvas === undefined) return undefined
    const canvasId = await canvas.boundCanvasId(sessionId)
    return canvasId === undefined ? undefined : this.readWorkMeta(canvasId)
  }

  /**
   * The works a session may bind to: the 长篇小说 canvases not archived.
   * @returns id and title per work, in the canvas list's order.
   */
  async listWorks(): Promise<readonly { readonly id: string; readonly title: string }[]> {
    const canvas = this.canvas
    if (canvas === undefined) return []
    const { items } = await canvas.listCanvases()
    return items
      .filter(item => item.genre === NOVEL_GENRE.id && item.archivedAt === null)
      .map(item => ({ id: item.id, title: item.title }))
  }

  /**
   * Bind the calling session to one work, named by canvas id or title (an
   * exact title wins; otherwise a unique title containing the name). The
   * model binds by the conversation's subject; the chip stays the user's
   * own way to do the same.
   * @param name - canvas id or (part of) the title.
   * @param session - the session being bound.
   * @returns the bound work, or the failure with the candidates to choose from.
   */
  async bindWork(name: string, session: Session): Promise<
    | { readonly ok: true; readonly work: { readonly id: string; readonly title: string } }
    | { readonly ok: false; readonly error: NovelError | 'ambiguous'; readonly works: readonly { readonly id: string; readonly title: string }[] }
  > {
    const canvas = this.canvas
    const works = await this.listWorks()
    const wanted = name.trim().replace(/^《(.*)》$/, '$1')
    const exact = works.filter(work => work.id === wanted || work.title === wanted)
    const matches = exact.length > 0 ? exact : works.filter(work => wanted !== '' && work.title.includes(wanted))
    if (canvas === undefined || matches.length === 0) return { ok: false, error: 'missing', works }
    if (matches.length > 1) return { ok: false, error: 'ambiguous', works: matches }
    const work = matches[0]!
    const bound = await canvas.bindSession({ canvasId: work.id }, session)
    if (!bound.ok) return { ok: false, error: bound.error === 'missing' ? 'missing' : 'io', works }
    return { ok: true, work }
  }

  /* -------------------------------------------------------------- entries */

  /** Read the sidecar (missing/corrupt reads as empty — mutations re-check through mutateJson). */
  private async readAnnotations(workId: string): Promise<Annotations> {
    const read = await this.readJson(await this.fileTarget(workId, WORK_FILES.annotations), normalizeAnnotations)
    return typeof read === 'object' ? read.data : emptyAnnotations()
  }

  /**
   * One work's cards in the four role categories, as views: the main text off
   * its field, the ref off the sidecar (the card id until one is allocated),
   * a foreshadow's activity off the mention journal, a character's 当前态 off
   * the sidecar note, a relation's progress off the relation journal.
   * @param workId - the canvas id.
   * @returns the entries, or undefined when the canvas is no novel work.
   */
  async readEntries(workId: string): Promise<WorkEntries | undefined> {
    const board = await this.readNovelBoard(workId)
    if (board === undefined) return undefined
    const [annotations, mentions, chapters, relationJournal] = await Promise.all([
      this.readAnnotations(board.id), this.listMentions({ workId: board.id }), this.readChapters(board.id),
      this.listRelationJournal({ workId: board.id }),
    ])
    return entriesOf(board, annotations, mentions, chapters, relationJournal)
  }

  /**
   * Give every role card on the board a display ref, and merge engine notes
   * in, in one guarded sidecar write. A card keeps the number it has unless
   * another card in its numbering space holds it already (first in board
   * order wins); a card without one draws max+1. Nothing is written when
   * nothing changes, so reads may call this freely.
   * @param workId - the canvas id.
   * @param session - the session that owns the gesture; supplies the fence.
   * @param board - the board as just returned by a card mutation, or undefined to read it.
   * @param notes - per-card note fields to merge (later fields win).
   * @returns the fresh sidecar, or the failure code.
   */
  async ensureRefs(
    workId: string,
    session: Session,
    board?: NovelBoardView,
    notes: ReadonlyMap<string, CardNote> = new Map(),
  ): Promise<{ readonly ok: boolean; readonly error?: NovelError; readonly annotations?: Annotations }> {
    const current = board ?? await this.readNovelBoard(workId)
    if (current === undefined) return { ok: false, error: 'missing' }
    const roleOf = rolesOn(current)
    const apply = (data: Annotations): Annotations | undefined => {
      const used: Record<RefGroup, Set<number>> = { character: new Set(), relation: new Set(), entry: new Set() }
      const refs: Record<string, number> = { ...data.refs }
      const waiting: { cardId: string; group: RefGroup }[] = []
      let changed = false
      for (const card of current.cards) {
        const role = roleOf.get(card.id)
        if (role === undefined) continue
        const group = refGroupOf(role)
        const n = refs[card.id]
        if (n !== undefined && !used[group].has(n)) used[group].add(n)
        else waiting.push({ cardId: card.id, group })
      }
      for (const { cardId, group } of waiting) {
        const n = Math.max(0, ...used[group]) + 1
        used[group].add(n)
        refs[cardId] = n
        changed = true
      }
      const merged: Record<string, CardNote> = { ...data.notes }
      for (const [cardId, note] of notes) {
        merged[cardId] = { ...merged[cardId], ...note }
        changed = true
      }
      return changed ? { version: 1, refs, notes: merged } : undefined
    }
    const snapshot = await this.readAnnotations(current.id)
    if (apply(snapshot) === undefined) return { ok: true, annotations: snapshot }
    const outcome = await this.mutateJson(
      await this.fileTarget(current.id, WORK_FILES.annotations), session,
      normalizeAnnotations, emptyAnnotations,
      data => apply(data) ?? data,
    )
    return outcome.ok ? { ok: true, annotations: outcome.data } : { ok: false, error: outcome.error }
  }

  /**
   * Find one card from any handle the model or a plan may send: an exact
   * card id, a ref (`c3`, `r2`, `#12`, `w12`), a bare number (its numbering space
   * picked by the role hint), or — characters — an exact name.
   * @param entries - the work's entries.
   * @param token - the handle.
   * @param roleHint - the role the context expects (decides a bare number's space).
   * @returns the card, or undefined.
   */
  resolveCard(entries: WorkEntries, token: unknown, roleHint?: EntryRole): CardHandle | undefined {
    const text = typeof token === 'number' ? String(token) : cleanText(token, 200)
    if (text === undefined) return undefined
    const direct = entries.roleOf.get(text)
    if (direct !== undefined) return { cardId: text, role: direct }
    const ref = parseRef(text)
    if (ref !== undefined) {
      const group = /^\d/.test(text) && roleHint !== undefined ? refGroupOf(roleHint) : ref.group
      for (const [cardId, role] of entries.roleOf) {
        if (refGroupOf(role) === group && entries.annotations.refs[cardId] === ref.n) return { cardId, role }
      }
      return undefined
    }
    if (roleHint === undefined || roleHint === 'character') {
      const character = entries.characters.find(view => view.name === text)
      if (character !== undefined) return { cardId: character.cardId, role: 'character' }
    }
    return undefined
  }

  /**
   * The agent's card write. Without an id it lands a new card in the
   * role's category live — kept at once, in the brief and the ledger, marked
   * new (✦) on the board until the user looks; a character or world
   * card whose name a live card already has is refused as `duplicate`, naming
   * that card; with an id it merges the given fields into that
   * card (absent fields keep). Fields are checked against the genre's card
   * type; unknown keys are ignored and reported back. A relation card goes
   * through {@link NovelService.writeRelation}.
   * @param request - work id, role, optional card handle, fields, optional comment.
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns the card's id and ref, or the failure code.
   */
  async writeCard(
    request: { readonly workId: string; readonly role: EntryRole; readonly id?: string; readonly fields: unknown; readonly comment?: string },
    session: Session,
  ): Promise<{ readonly ok: boolean; readonly error?: NovelError; readonly cardId?: string; readonly ref?: string; readonly ignored?: readonly string[] }> {
    const canvas = this.canvas
    const entries = await this.readEntries(request.workId)
    if (canvas === undefined || entries === undefined) return { ok: false, error: 'missing' }
    const { fields, ignored } = cleanFields(request.role, request.fields)
    if (request.role === 'relation') return this.writeRelation(entries, request, fields, ignored, session)
    let mutation: NovelBoardMutation
    let cardId: string
    if (request.id !== undefined) {
      const handle = this.resolveCard(entries, request.id, request.role)
      if (handle === undefined || handle.role !== request.role) return { ok: false, error: 'missing' }
      if (Object.keys(fields).length === 0) return { ok: false, error: 'invalid-name', ignored }
      const card = entries.board.cards.find(candidate => candidate.id === handle.cardId)!
      cardId = handle.cardId
      mutation = await canvas.patchCard({ canvasId: entries.board.id, cardId, fields: { ...card.fields, ...fields } }, session)
    } else {
      const category = categoryOf(entries.board, request.role)
      if (category === undefined || !hasRequiredFields(request.role, fields)) return { ok: false, error: 'invalid-name', ignored }
      const existing = namesake(entries, request.role, typeof fields['name'] === 'string' ? fields['name'] : undefined)
      if (existing !== undefined) return { ok: false, error: 'duplicate', cardId: existing.cardId, ref: existing.ref, ignored }
      const comment = cleanText(request.comment, 500)
      mutation = await canvas.proposeCard({
        canvasId: entries.board.id, kind: category, text: '', fields, live: true,
        ...(comment === undefined ? {} : { comment }),
      }, session)
      if (!mutation.ok) return { ok: false, error: canvasErrorOf(mutation.error) }
      cardId = mutation.board.cards[mutation.board.cards.length - 1]!.id
    }
    if (!mutation.ok) return { ok: false, error: canvasErrorOf(mutation.error) }
    const refs = await this.ensureRefs(entries.board.id, session, mutation.board)
    const n = refs.annotations?.refs[cardId]
    return { ok: true, cardId, ref: n === undefined ? cardId : refOf(request.role, n), ignored }
  }

  /**
   * writeCard for a relation card. 双方 resolves to two distinct characters
   * (without it, the name `甲 × 乙` is read against the roster), the name
   * follows the pair when none is given, the stage reads against the type —
   * a level's name or number, 裂痕 or 决裂; a new card starts at the first
   * level, a new type keeps the level unless the pair moves into or out of
   * 对手 (then the first level) — and one pair holds one card. The relation
   * journal records the start, and any stage or type the write moves (the
   * pair's progress restarts).
   */
  private async writeRelation(
    entries: WorkEntries,
    request: { readonly id?: string; readonly comment?: string },
    fields: Record<string, NovelFieldValue>,
    ignored: string[],
    session: Session,
  ): Promise<{ readonly ok: boolean; readonly error?: NovelError; readonly cardId?: string; readonly ref?: string; readonly ignored?: readonly string[] }> {
    const canvas = this.canvas!
    const handle = request.id === undefined ? undefined : this.resolveCard(entries, request.id, 'relation')
    if (request.id !== undefined && handle?.role !== 'relation') return { ok: false, error: 'missing' }
    const before = handle === undefined ? undefined : entries.relations.find(view => view.cardId === handle.cardId)
    const card = handle === undefined ? undefined : entries.board.cards.find(candidate => candidate.id === handle.cardId)
    if (before !== undefined && Object.keys(fields).length === 0) return { ok: false, error: 'invalid-name', ignored }
    const living = entries.characters.filter(view => view.cardStatus !== 'archived')
    const givenName = typeof fields['name'] === 'string' ? fields['name'] : undefined
    let pair: readonly string[]
    if (Array.isArray(fields['pair'])) {
      const ids = fields['pair'].map(token => this.resolveCard(entries, token, 'character'))
      pair = ids.every(id => id?.role === 'character') ? [...new Set(ids.map(id => id!.cardId))] : []
    } else {
      pair = before !== undefined && before.pair.length === 2 ? before.pair : pairFromName(living, givenName ?? before?.name)
    }
    const type = relationTypeOf(fields['type']) ?? before?.type
    if (pair.length !== 2 || type === undefined) return { ok: false, error: 'invalid-name', ignored }
    const twin = entries.relations.find(view => view.cardId !== before?.cardId && view.cardStatus !== 'archived' && samePair(view.pair, pair))
    if (twin !== undefined) return { ok: false, error: 'duplicate', cardId: twin.cardId, ref: twin.ref, ignored }

    // The stage: what the write names, else the level the card stood at (restarted when the type change calls for it).
    let level = before?.level
    let rift = before?.rift
    if (before !== undefined && type !== before.type && typeChangeOf(before.type, type, before.rift) !== 'keep') level = 1
    if (fields['stage'] !== undefined) {
      const read = readRelationStage(type, fields['stage'])
      if (read.level === undefined && read.rift === undefined) ignored.push('stage')
      else {
        level = read.level ?? level
        rift = read.rift
      }
    }
    const stage = rift ?? stageNameOf(type, level ?? 1)
    const names = pair.map(id => entries.characters.find(view => view.cardId === id)?.name ?? id)
    const next: Record<string, NovelFieldValue> = {
      ...card?.fields, ...fields,
      name: givenName ?? before?.name ?? `${names[0]} × ${names[1]}`,
      pair: [...pair], type, stage,
    }
    const event: RelationEvent | undefined = before === undefined ? 'start'
      : type !== before.type ? 'type'
        : stage === before.stage ? undefined
          : rift === '裂痕' ? 'crack' : rift === '决裂' ? 'break' : before.rift !== undefined ? 'fix' : 'set'

    let mutation: NovelBoardMutation
    let cardId: string
    if (card !== undefined) {
      cardId = card.id
      mutation = await canvas.patchCard({ canvasId: entries.board.id, cardId, fields: next }, session)
    } else {
      const category = categoryOf(entries.board, 'relation')
      if (category === undefined) return { ok: false, error: 'invalid-name', ignored }
      const comment = cleanText(request.comment, 500)
      mutation = await canvas.proposeCard({
        canvasId: entries.board.id, kind: category, text: '', fields: next, live: true,
        ...(comment === undefined ? {} : { comment }),
      }, session)
      if (!mutation.ok) return { ok: false, error: canvasErrorOf(mutation.error) }
      cardId = mutation.board.cards[mutation.board.cards.length - 1]!.id
    }
    if (!mutation.ok) return { ok: false, error: canvasErrorOf(mutation.error) }
    if (event !== undefined) {
      const appended = await this.appendJsonl(await this.fileTarget(entries.board.id, WORK_FILES.relations), session, [stageLine({
        relationId: cardId, chapter: entries.currentChapter, event, stage,
        ...(rift === undefined ? { level: level ?? 1 } : {}),
        ...(event === 'type' ? { fromType: before!.type, toType: type } : {}),
      })])
      if (!appended.ok) return { ok: false, error: appended.error ?? 'io' }
    }
    const refs = await this.ensureRefs(entries.board.id, session, mutation.board)
    const n = refs.annotations?.refs[cardId]
    return { ok: true, cardId, ref: n === undefined ? cardId : refOf('relation', n), ignored }
  }

  /**
   * The ✗ on one card: archive it through the canvas's own status. Archived
   * cards stay on the board, hidden — nothing is deleted.
   * @param request - work id, card handle.
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns the receipt, or the failure code.
   */
  async archiveCard(
    request: { readonly workId: string; readonly id: string },
    session: Session,
  ): Promise<{ readonly ok: boolean; readonly error?: NovelError; readonly cardId?: string }> {
    const canvas = this.canvas
    const entries = await this.readEntries(request.workId)
    if (canvas === undefined || entries === undefined) return { ok: false, error: 'missing' }
    const handle = this.resolveCard(entries, request.id)
    const card = handle === undefined ? undefined : entries.board.cards.find(candidate => candidate.id === handle.cardId)
    if (card === undefined) return { ok: false, error: 'missing' }
    if (card.status === 'archived') return { ok: false, error: 'invalid-name' }
    const mutation = await canvas.patchCard({ canvasId: entries.board.id, cardId: card.id, status: 'archived' }, session)
    return mutation.ok ? { ok: true, cardId: card.id } : { ok: false, error: canvasErrorOf(mutation.error) }
  }

  /* ---------------------------------------------------------- experiences */

  /** List the experience journal (optionally one character's), oldest first. */
  async listExperiences(request: { readonly workId: string; readonly characterId?: string }): Promise<ExperienceEntry[]> {
    const id = normalizeWorkId(request.workId)
    if (id === undefined) return []
    const entries = await this.readJsonl(await this.fileTarget(id, WORK_FILES.experiences), raw => normalizeExperience(raw))
    return entries.filter(entry => request.characterId === undefined || entry.characterId === request.characterId)
  }

  /** The mention journal (a foreshadow card's chapter track), optionally one card's, oldest first. */
  async listMentions(request: { readonly workId: string; readonly foreshadowId?: string }): Promise<MentionEntry[]> {
    const id = normalizeWorkId(request.workId)
    if (id === undefined) return []
    const entries = await this.readJsonl(await this.fileTarget(id, WORK_FILES.mentions), raw => normalizeMention(raw))
    return entries.filter(entry => request.foreshadowId === undefined || entry.foreshadowId === request.foreshadowId)
  }

  /** The relation journal (a relation card's points and stage events), optionally one card's, oldest first. */
  async listRelationJournal(request: { readonly workId: string; readonly relationId?: string }): Promise<RelationEntry[]> {
    const id = normalizeWorkId(request.workId)
    if (id === undefined) return []
    const entries = await this.readJsonl(await this.fileTarget(id, WORK_FILES.relations), raw => normalizeRelationEntry(raw))
    return entries.filter(entry => request.relationId === undefined || entry.relationId === request.relationId)
  }

  /* ------------------------------------------------------------- chapters */

  /** Read the whole chapter table. */
  private async readChapters(workId: string): Promise<ChapterRecord[]> {
    const read = await this.readJson(await this.fileTarget(workId, WORK_FILES.chapters), raw => normalizeChapterTable(raw))
    return typeof read === 'object' ? read.data.chapters : []
  }

  /** Whether the manuscript file has content (the 写作中 derivation). */
  private async hasBody(work: WorkMeta, chapter: ChapterRecord): Promise<boolean> {
    const path = this.bodyPath(work, chapter)
    if (path === undefined) return false
    try {
      const info = await this.fs.stat(await this.fs.resolve(path))
      return info !== undefined && (info.size ?? 0) > 0
    } catch {
      return false
    }
  }

  /** The chapter index, seq-ordered, with the effective phase derived per row. */
  async listChapters(request: { readonly workId: string }): Promise<ChapterRow[]> {
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
    const path = this.bodyPath(work, chapter)
    if (path === undefined) return ''
    try {
      return await this.fs.readText(await this.fs.resolve(path))
    } catch {
      return ''
    }
  }

  /** One chapter by number, with its body and effective phase. */
  async readChapter(request: { readonly workId: string; readonly n: number }): Promise<{
    readonly ok: boolean
    readonly error?: NovelError
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
   * to n; an explicit seq inserts the chapter between its neighbors. A plan's
   * foreshadow ops and characters are stored as card ids when they resolve
   * (a ref or a name the board does not know is kept as written).
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
  ): Promise<{ readonly ok: boolean; readonly error?: NovelError; readonly chapter?: ChapterRecord }> {
    const workId = normalizeWorkId(request.workId)
    const title = cleanText(request.title, 200)
    if (workId === undefined || title === undefined) return { ok: false, error: 'invalid-name' }
    const meta = await this.readWorkMeta(workId)
    if (meta === undefined) return { ok: false, error: 'missing' }
    const rawPlan = request.plan === undefined ? undefined : normalizePlan(request.plan)
    if (request.plan !== undefined && rawPlan === undefined) return { ok: false, error: 'invalid-name' }
    let plan = rawPlan
    if (rawPlan !== undefined) {
      const entries = await this.readEntries(workId)
      if (entries !== undefined) {
        const toCard = (token: string, role: EntryRole): string => {
          const handle = this.resolveCard(entries, token, role)
          return handle?.role === role ? handle.cardId : token
        }
        plan = {
          ...rawPlan,
          foreshadowOps: rawPlan.foreshadowOps.map(op => op.id === undefined ? op : { ...op, id: toCard(op.id, 'foreshadow') }),
          cast: rawPlan.cast.map(member => ({ ...member, who: toCard(member.who, 'character') })),
          ...(rawPlan.pov === undefined ? {} : { pov: toCard(rawPlan.pov, 'character') }),
        }
      }
    }
    const content = typeof request.content === 'string' && request.content.trim().length > 0
      ? manuscriptParagraphs(request.content.slice(0, 2_000_000))
      : undefined
    const byUser = request.byUser === true

    // 计划门禁: the model writes a body only into a chapter whose plan the user
    // confirmed; the user's own text (用户原稿) needs no plan. Checked before
    // the body lands, so a refused write leaves the workspace untouched.
    const workspace = meta.workspace
    if (content !== undefined && workspace === undefined) return { ok: false, error: 'no-workspace' }
    if (content !== undefined && !byUser) {
      const row = request.n === undefined ? undefined : (await this.readChapters(workId)).find(candidate => candidate.n === request.n)
      if (request.n !== undefined && row === undefined) return { ok: false, error: 'missing' }
      const replanned = plan !== undefined && row?.plan !== undefined && JSON.stringify(plan) !== JSON.stringify(row.plan)
      if (row === undefined || (row.byUser !== true && (row.planConfirmedAt === undefined || replanned))) {
        return { ok: false, error: 'plan-unconfirmed' }
      }
    }

    // The body lands before the registration (F1-2): a write that the fence
    // refuses means NO chapter row — the 空槽登记 bug class is closed by
    // construction.
    if (content !== undefined && workspace !== undefined) {
      const chapters = await this.readChapters(workId)
      const n = request.n ?? chapters.reduce((max, row) => Math.max(max, row.n), 0) + 1
      const target = await this.fs.resolve(join(workspace, meta.title, chapterFileName(n)))
      const resolved = this.sandboxPolicy?.resolve({ session })
      if (resolved?.mode === 'read-only') return { ok: false, error: 'denied' }
      const policy = resolved === undefined ? undefined : { ...resolved, workspaceRoot: workspace }
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
        return { ok: false, error: novelErrorOf(error) }
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
          if (plan !== undefined && JSON.stringify(plan) !== JSON.stringify(row.plan)) {
            mutable.plan = plan
            // The delivery indexes the old plan's rows; a new plan has none
            // yet — and the user has not confirmed it.
            delete mutable.delivery
            delete mutable.planConfirmedAt
          }
          if (byUser) mutable.byUser = true
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
          ...(byUser ? { byUser: true as const } : {}),
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
  ): Promise<{ readonly ok: boolean; readonly error?: NovelError; readonly chapter?: ChapterRecord }> {
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

  /**
   * The user's ★ on a foreshadow card (主线重点). The star is the user's,
   * never the engine's: it lives in the sidecar, so the card fields stay
   * what the user typed.
   * @param request - work id, the foreshadow's card id, and the new star.
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns ok, or the failure code.
   */
  async starForeshadow(
    request: { readonly workId: string; readonly cardId: string; readonly starred: boolean },
    session: Session,
  ): Promise<{ readonly ok: boolean; readonly error?: NovelError }> {
    const entries = await this.readEntries(request.workId)
    if (entries === undefined) return { ok: false, error: 'missing' }
    if (entries.roleOf.get(request.cardId) !== 'foreshadow') return { ok: false, error: 'invalid-name' }
    const outcome = await this.ensureRefs(request.workId, session, entries.board, new Map([[request.cardId, { starred: request.starred }]]))
    return outcome.ok ? { ok: true } : { ok: false, error: outcome.error ?? 'io' }
  }

  /**
   * The user's own edit of a character's 此刻 (当前态). The next 对账
   * overwrites it with what the chapter shows, as it does any 当前态.
   * @param request - work id, the character's card id, and the whole new state (empty parts clear).
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns ok, or the failure code.
   */
  async setCurrentState(
    request: { readonly workId: string; readonly cardId: string; readonly state: CurrentState },
    session: Session,
  ): Promise<{ readonly ok: boolean; readonly error?: NovelError }> {
    const entries = await this.readEntries(request.workId)
    if (entries === undefined) return { ok: false, error: 'missing' }
    if (entries.roleOf.get(request.cardId) !== 'character') return { ok: false, error: 'invalid-name' }
    const clean = (text: string | undefined): string | undefined => {
      const trimmed = text?.trim().slice(0, 200)
      return trimmed === undefined || trimmed === '' ? undefined : trimmed
    }
    const where = clean(request.state.where)
    const now = clean(request.state.state)
    const concern = clean(request.state.concern)
    const currentState: CurrentState = {
      ...(where === undefined ? {} : { where }),
      ...(now === undefined ? {} : { state: now }),
      ...(concern === undefined ? {} : { concern }),
    }
    const outcome = await this.ensureRefs(request.workId, session, entries.board, new Map([[request.cardId, { currentState }]]))
    return outcome.ok ? { ok: true } : { ok: false, error: outcome.error ?? 'io' }
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
  ): Promise<{ readonly ok: boolean; readonly error?: NovelError; readonly chapter?: ChapterRecord }> {
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

  /* -------------------------------------------------------------- ledger */

  /**
   * The 伏笔沉睡榜 + 健康度 over the kept foreshadow cards: live ones sorted
   * longest-slept first (the maintenance meeting's agenda), resolved ones with
   * answers, and the health counts (活跃/超期⚠/已揭/弃置). 超期 = slept
   * past the threshold ({@link isOverdue}: starred 4, otherwise 6). The kept
   * relations ride along, 可升 first, so a maintenance pass sees the pairs
   * waiting for their key scene.
   * @param request - the work id.
   * @returns the ledger rows and counts, or the failure code.
   */
  async ledger(request: { readonly workId: string }): Promise<LedgerResult> {
    const entries = await this.readEntries(request.workId)
    if (entries === undefined) return { ok: false, error: 'missing', active: [], resolved: [], counts: { active: 0, overdue: 0, resolved: 0, abandoned: 0 }, relations: [], currentChapter: 0 }
    const kept = entries.foreshadows.filter(view => view.cardStatus === 'kept')
    const active = sortBySleep(kept.filter(isLiveForeshadow))
    const resolved = kept.filter(view => view.state === '已揭晓')
    return {
      ok: true,
      active,
      resolved,
      counts: {
        active: active.length,
        overdue: active.filter(isOverdue).length,
        resolved: resolved.length,
        abandoned: kept.filter(view => view.state === '已放弃').length,
      },
      relations: entries.relations.filter(view => view.cardStatus === 'kept').sort((a, b) => Number(b.ready) - Number(a.ready)),
      currentChapter: entries.currentChapter,
    }
  }

  /* --------------------------------------------------------------- brief */

  /**
   * Gather everything one brief renders (the async half; brief.ts renders
   * synchronously from this). Only kept cards feed it — a card the canvas
   * holds as a proposal is not the user's yet. The target chapter: the explicit n, else the newest
   * chapter still planning (the one being planned/written), else the newest
   * chapter overall — none at all is a guidance error, never a throw.
   * @param request - work id and optional chapter number.
   * @returns the render data, or the failure code.
   */
  async gatherBrief(request: { readonly workId: string; readonly chapter?: number }): Promise<{
    readonly ok: boolean
    readonly error?: NovelError
    readonly data?: BriefData
  }> {
    const meta = await this.readWorkMeta(request.workId)
    const entries = await this.readEntries(request.workId)
    if (meta === undefined || entries === undefined) return { ok: false, error: 'missing' }
    const chapters = [...await this.readChapters(meta.id)].sort((a, b) => a.seq - b.seq || a.n - b.n)
    const target = request.chapter !== undefined
      ? chapters.find(candidate => candidate.n === request.chapter)
      : [...chapters].reverse().find(candidate => candidate.phase === 'planning') ?? chapters[chapters.length - 1]
    if (target === undefined) return { ok: false, error: 'missing' }
    const experiences = await this.listExperiences({ workId: meta.id })
    const rules = entries.rules.filter(view => view.status === 'kept')
    const foreshadows = entries.foreshadows.filter(view => view.cardStatus === 'kept')
    const roster = entries.characters.filter(view => view.cardStatus === 'kept')
    const relations = entries.relations.filter(view => view.cardStatus === 'kept')
    const inSceneIds = new Set([...(target.plan?.cast ?? []).map(member => member.who), ...(target.plan?.pov === undefined ? [] : [target.plan.pov])])
    const inScene = roster.filter(view => inSceneIds.has(view.cardId) || inSceneIds.has(view.name) || inSceneIds.has(view.ref))
    const previous = chapters.filter(candidate => candidate.seq < target.seq)
    const previousChapter = previous[previous.length - 1]
    const previousTail = previousChapter === undefined ? undefined : tailOf(await this.readChapterBody(meta, previousChapter))
    return {
      ok: true,
      data: {
        workTitle: meta.title,
        target,
        canonRules: rules.filter(view => view.role === 'world'),
        principles: rules.filter(view => view.role === 'principle'),
        activeForeshadows: sortBySleep(foreshadows.filter(isLiveForeshadow)),
        unplantedForeshadows: foreshadows.filter(view => view.state === '未埋'),
        resolvedForeshadows: foreshadows.filter(view => view.state === '已揭晓'),
        allForeshadows: entries.foreshadows,
        currentChapter: entries.currentChapter,
        inScene: inScene.map(character => ({
          character,
          recent: experiences.filter(entry => entry.characterId === character.cardId).slice(-3),
        })),
        roster,
        relations,
        inSceneRelations: inSceneIds.size === 0
          ? relations
          : relations.filter(view => view.pair.length === 2 && view.pair.every(id => inScene.some(character => character.cardId === id))),
        previousRecaps: previous.filter(candidate => candidate.recap !== undefined),
        ...(previousTail === undefined ? {} : { previousTail }),
      },
    }
  }

  /* -------------------------------------------------------------- extract */

  /**
   * The prepare half of 对账: the C-variant material pack (chapter body in
   * full, plan, the live-foreshadow whitelist, the roster, the output
   * schema). The gate is the WRITING state (stored planning + a non-empty
   * manuscript): nothing to reconcile without a body, already-extracted and
   * reviewed chapters are refused (对账只发生在写作后、审过收章前 — 审过是人工
   * 闸门，永远最后). Delegating the pack to the subagent is the main agent's
   * job; the store never delegates.
   * @param request - work id and chapter number.
   * @returns the pack text plus the whitelist (card ids), or the failure code.
   */
  async extractPrepare(request: { readonly workId: string; readonly n: number }): Promise<{
    readonly ok: boolean
    readonly error?: NovelError
    readonly text?: string
    readonly foreshadowIds?: readonly string[]
    readonly characterIds?: readonly string[]
  }> {
    const meta = await this.readWorkMeta(request.workId)
    if (meta === undefined) return { ok: false, error: 'missing' }
    const chapter = (await this.readChapters(meta.id)).find(candidate => candidate.n === request.n)
    if (chapter === undefined) return { ok: false, error: 'missing' }
    const body = await this.readChapterBody(meta, chapter)
    if (chapter.phase !== 'planning' || body.trim() === '') return { ok: false, error: 'not-reviewed' }
    const gathered = await this.gatherBrief({ workId: meta.id, chapter: chapter.n })
    if (!gathered.ok || gathered.data === undefined) return { ok: false, error: gathered.error ?? 'io' }
    return {
      ok: true,
      text: renderExtractBrief(gathered.data, body),
      foreshadowIds: [...gathered.data.activeForeshadows, ...gathered.data.unplantedForeshadows].map(view => view.cardId),
      characterIds: gathered.data.roster.map(view => view.cardId),
    }
  }

  /**
   * The import half of 对账 — plugin service code, trusting no model (the
   * five gates of proposal §5):
   *   1. evidence grep: every item's quote must appear in the chapter body,
   *      else dropped with a log entry (anti-fabrication);
   *   2. foreshadow refs must resolve to a kept, unsettled foreshadow card,
   *      else dropped;
   *   3. new rules, foreshadows and characters land as live cards, marked
   *      new (✦) on the board — the user edits or archives (✗)
   *      what is wrong;
   *   4. high-confidence journal lines land automatically; medium/low ones
   *      go to the pending queue;
   *   5. plan operations verify against the recorded mentions; a planned op
   *      with no touch lands in pending as 计划落空 (「忘了还是改主意」是人答
   *      的题), and every journal mention carries its planned flag.
   *      Plan beats the subagent found (evidence-gated like everything else)
   *      land on the chapter's delivery; a missed beat is a reminder only.
   * @param request - work id, chapter number, the subagent's strict JSON.
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns the reconciliation report, or the failure code.
   */
  async extractImport(
    request: { readonly workId: string; readonly n: number; readonly payload: ExtractPayload },
    session: Session,
  ): Promise<ImportReport> {
    const empty = {
      verified: 0, missed: 0, beats: { delivered: 0, missed: 0 }, pending: 0,
      dropped: [] as ImportDrop[], pendingItems: [] as { id: string; kind: PendingKind; reason: string }[],
      newCards: [] as { cardId: string; role: EntryRole; text: string }[],
    }
    const canvas = this.canvas
    const meta = await this.readWorkMeta(request.workId)
    const entries = await this.readEntries(request.workId)
    if (canvas === undefined || meta === undefined || entries === undefined) return { ok: false, error: 'missing', ...empty }
    const id = meta.id
    const chapter = (await this.readChapters(id)).find(candidate => candidate.n === request.n)
    if (chapter === undefined) return { ok: false, error: 'missing', ...empty }
    const body = await this.readChapterBody(meta, chapter)
    if (chapter.phase !== 'planning' || body.trim() === '') return { ok: false, error: 'not-reviewed', ...empty }
    const { payload } = request
    const dropped: ImportDrop[] = []
    const report = { verified: 0, missed: 0, beats: { delivered: 0, missed: 0 }, pending: 0 }
    const toPending: { kind: PendingKind; confidence?: 'medium' | 'low'; chapter?: number; reason: string; evidenceInText?: string; payload: PendingPayload }[] = []
    const pend = (item: (typeof toPending)[number]): void => { toPending.push(item); report.pending += 1 }
    const confidenceOf = (raw: unknown): Confidence => raw === 'high' ? 'high' : raw === 'low' ? 'low' : 'medium'
    const foreshadowOf = new Map(entries.foreshadows.map(view => [view.cardId, view]))
    const whitelist = new Set(entries.foreshadows
      .filter(view => view.cardStatus === 'kept' && (isLiveForeshadow(view) || view.state === '未埋'))
      .map(view => view.cardId))
    // Experiences may name any live character, including one
    // this very import lands (its id joins below, once the card exists).
    const roster = new Set(entries.characters.filter(view => view.cardStatus !== 'archived').map(view => view.cardId))
    const newCharacterIds = new Map<string, string>()
    const asForeshadow = (token: unknown): string | undefined => {
      const handle = this.resolveCard(entries, token, 'foreshadow')
      return handle?.role === 'foreshadow' ? handle.cardId : undefined
    }
    const asCharacter = (token: unknown): string | undefined => {
      const named = newCharacterIds.get(cleanText(token, 80) ?? '')
      if (named !== undefined) return named
      const handle = this.resolveCard(entries, token, 'character')
      return handle?.role === 'character' ? handle.cardId : undefined
    }
    const now = new Date().toISOString()
    const source: NovelCardSource = { type: 'file', ref: join(meta.workspace ?? '', meta.title, chapter.file), title: `第${chapter.n}章` }

    // The card writes this import will make (gate 3), collected first and landed below.
    const cardWrites: { role: EntryRole; fields: Record<string, NovelFieldValue>; note: CardNote; comment: string; ref: string }[] = []
    // A name a live card or an earlier row of this payload already holds is a duplicate, never a second card.
    const seenNames = new Set<string>()
    const duplicateOf = (role: EntryRole, name: string): string | undefined => {
      const key = `${role}:${name}`
      if (seenNames.has(key)) return '本次已提过'
      seenNames.add(key)
      const existing = namesake(entries, role, name)
      return existing === undefined ? undefined : `已有 ${existing.ref}`
    }

    // World rules and principles: evidence first (gate 1), then a live card quoting its line.
    for (const raw of payload.memories ?? []) {
      const content = cleanText(raw.content)
      if (content === undefined) continue
      const evidence = cleanText(raw.evidence_in_text, 60)
      if (!evidenceInBody(body, evidence)) {
        dropped.push({ kind: 'memory', reason: 'evidence-not-found', ref: content.slice(0, 30) })
        continue
      }
      const role: EntryRole = cleanText(raw.kind, 10) === '原则' ? 'principle' : 'world'
      const fields: Record<string, NovelFieldValue> = { [MAIN_FIELD[role]]: content }
      if (role === 'world') {
        const name = cleanText(raw.name, 80) ?? settingNameOf(content)
        const duplicate = duplicateOf(role, name)
        if (duplicate !== undefined) {
          dropped.push({ kind: 'memory', reason: 'duplicate', ref: `${name}（${duplicate}）` })
          continue
        }
        fields['name'] = name
        const kind = cleanText(raw.world_kind, 10)
        if (kind !== undefined && WORLD_KINDS.includes(kind)) fields['kind'] = kind
      }
      cardWrites.push({
        role, fields, note: { evidenceInText: evidence! },
        comment: `第${chapter.n}章：「${evidence}」`, ref: String(fields['name'] ?? content.slice(0, 30)),
      })
    }

    // Mentions: whitelist (gate 2) + evidence (gate 1); high records, medium/low pends.
    const recordedMentions: { id: string; kind: MentionEntry['kind'] }[] = []
    const journalLines: Record<string, unknown>[] = []
    const touch = new Map<string, { readonly kind: MentionEntry['kind']; readonly answer?: string }>()
    // 用户原稿 was never planned: nothing to verify, no plan flags on its mentions.
    const plan = chapter.byUser === true ? undefined : chapter.plan
    const plannedIds = new Set((plan?.foreshadowOps ?? []).map(op => asForeshadow(op.id)).filter(Boolean))
    for (const raw of payload.foreshadow_mentions ?? []) {
      const kind = cleanText(raw.kind, 20)
      const mentionKind = kind === 'planted' || kind === 'advanced' || kind === 'hinted' || kind === 'resolved' ? kind : undefined
      if (raw.foreshadow_id === undefined || mentionKind === undefined) continue
      const foreshadowId = asForeshadow(raw.foreshadow_id)
      if (foreshadowId === undefined || !whitelist.has(foreshadowId)) {
        dropped.push({ kind: 'mention', reason: 'id-not-in-ledger', ref: String(raw.foreshadow_id) })
        continue
      }
      const evidence = cleanText(raw.evidence_in_text, 60)
      if (!evidenceInBody(body, evidence)) {
        dropped.push({ kind: 'mention', reason: 'evidence-not-found', ref: foreshadowOf.get(foreshadowId)?.ref ?? foreshadowId })
        continue
      }
      const confidence = confidenceOf(raw.confidence)
      const note = cleanText(raw.note, 200)
      const answer = cleanText(raw.answer, 500)
      if (confidence === 'high') {
        recordedMentions.push({ id: foreshadowId, kind: mentionKind })
        touch.set(foreshadowId, { kind: mentionKind, ...(answer === undefined ? {} : { answer }) })
        journalLines.push({
          foreshadowId, chapter: chapter.n, kind: mentionKind,
          planned: plannedIds.has(foreshadowId),
          ...(note === undefined ? {} : { note }),
          createdAt: now,
        } satisfies Record<string, unknown>)
      } else {
        pend({
          kind: 'mention', confidence, chapter: chapter.n, reason: '疑似提及',
          payload: { foreshadowId, kind: mentionKind, ...(note === undefined ? {} : { note }), ...(answer === undefined ? {} : { answer }) },
          ...(evidence === undefined ? {} : { evidenceInText: evidence }),
        })
      }
    }

    // Gate 3: new foreshadows and characters land as live cards (evidence still greps — gate 1).
    let newForeshadows = 0
    for (const raw of payload.new_foreshadows ?? []) {
      const question = cleanText(raw.question, 200)
      if (question === undefined) continue
      const evidence = cleanText(raw.evidence_in_text, 60)
      if (!evidenceInBody(body, evidence)) {
        dropped.push({ kind: 'new-foreshadow', reason: 'evidence-not-found', ref: question.slice(0, 30) })
        continue
      }
      newForeshadows += 1
      cardWrites.push({
        role: 'foreshadow', fields: { question, status: '已埋', plantedAt: chapter.n },
        note: { evidenceInText: evidence! },
        comment: `第${chapter.n}章新埋：「${evidence}」`, ref: question.slice(0, 30),
      })
    }
    for (const raw of payload.new_characters ?? []) {
      const name = cleanText(raw.name, 80)
      if (name === undefined) continue
      // A character the board already has (from an earlier chapter, say) is not new: the
      // experiences below still reach it by name, and no second card is made.
      if (duplicateOf('character', name) !== undefined) continue
      const evidence = cleanText(raw.evidence_in_text, 60)
      if (!evidenceInBody(body, evidence)) {
        dropped.push({ kind: 'new-character', reason: 'evidence-not-found', ref: name })
        continue
      }
      const identity = cleanText(raw.identity, 200)
      cardWrites.push({
        role: 'character', fields: { name, ...(identity === undefined ? {} : { identity }) },
        note: { evidenceInText: evidence! },
        comment: `第${chapter.n}章登场：「${evidence}」`, ref: name,
      })
    }

    // Gate 5: plan verification against what the chapter actually touched.
    // A missed op is a question for the person (pending); a missed beat only
    // shows on the chapter's delivery line.
    const opsDelivered: boolean[] = []
    for (const op of plan?.foreshadowOps ?? []) {
      const wanted = OP_TO_MENTION[op.op]
      const opId = op.id === undefined ? undefined : asForeshadow(op.id)
      const touched = opId === undefined ? [] : recordedMentions.filter(mention => mention.id === opId)
      const exact = touched.some(mention => mention.kind === wanted)
      const anyTouch = touched.length > 0 || (op.op === '新埋' && newForeshadows > 0)
      opsDelivered.push(exact || anyTouch)
      if (exact || anyTouch) {
        report.verified += 1
      } else {
        report.missed += 1
        const label = opId !== undefined
          ? ` [${foreshadowOf.get(opId)?.ref ?? opId}]`
          : op.id !== undefined ? ` [${op.id}]` : op.question === undefined ? '' : ` [${op.question}]`
        pend({
          kind: 'plan-missed', chapter: chapter.n,
          reason: `计划落空：${op.op}${label} —— 忘了还是改主意？`,
          payload: { op: op.op, ...(op.id === undefined ? {} : { id: opId ?? op.id }), ...(op.question === undefined ? {} : { question: op.question }) },
        })
      }
    }
    const beatsSeen = new Set<number>()
    for (const raw of payload.beats_delivered ?? []) {
      const beat = cleanNumber(raw.beat)
      if (beat === undefined || !Number.isInteger(beat) || beat < 1 || beat > (plan?.beats.length ?? 0)) continue
      const evidence = cleanText(raw.evidence_in_text, 60)
      if (!evidenceInBody(body, evidence)) {
        dropped.push({ kind: 'beat', reason: 'evidence-not-found', ref: String(beat) })
        continue
      }
      beatsSeen.add(beat)
    }
    const beatsDelivered = (plan?.beats ?? []).map((_beat, index) => beatsSeen.has(index + 1))
    report.beats.delivered = beatsDelivered.filter(Boolean).length
    report.beats.missed = beatsDelivered.length - report.beats.delivered

    // The writes. Cards first (through the canvas), then the sidecar, the journals, the chapter, the queue.
    const notes = new Map<string, CardNote>()
    const newCards: { cardId: string; role: EntryRole; text: string }[] = []
    let board = entries.board
    for (const write of cardWrites) {
      const category = categoryOf(board, write.role)
      const mutation = category === undefined
        ? undefined
        : await canvas.proposeCard({ canvasId: id, kind: category, text: '', fields: write.fields, source, comment: write.comment, live: true }, session)
      if (mutation === undefined || !mutation.ok) {
        dropped.push({ kind: write.role, reason: 'card-refused', ref: write.ref })
        continue
      }
      board = mutation.board
      const cardId = board.cards[board.cards.length - 1]!.id
      notes.set(cardId, write.note)
      if (write.role === 'character') {
        newCharacterIds.set(write.ref, cardId)
        roster.add(cardId)
      }
      newCards.push({ cardId, role: write.role, text: String(write.fields['name'] ?? write.fields[MAIN_FIELD[write.role]]) })
    }
    // Experiences + current states: roster-checked, evidence-gated, high lands / medium-low pends.
    // They run after the card writes so a character this import landed is already on the roster.
    const experienceLines: Record<string, unknown>[] = []
    const stateUpdates = new Map<string, CurrentState>()
    for (const raw of payload.experiences ?? []) {
      const entry = cleanText(raw.entry, 500)
      if (raw.character_id === undefined || entry === undefined) continue
      const characterId = asCharacter(raw.character_id)
      if (characterId === undefined || !roster.has(characterId)) {
        dropped.push({ kind: 'experience', reason: 'character-not-in-roster', ref: String(raw.character_id) })
        continue
      }
      const evidence = cleanText(raw.evidence_in_text, 60)
      if (!evidenceInBody(body, evidence)) {
        dropped.push({ kind: 'experience', reason: 'evidence-not-found', ref: String(raw.character_id) })
        continue
      }
      const confidence = confidenceOf(raw.confidence)
      if (confidence === 'high') {
        experienceLines.push({ characterId, chapter: chapter.n, entry, createdAt: now })
      } else {
        pend({
          kind: 'experience', confidence, chapter: chapter.n, reason: '拿不准的经历',
          payload: { characterId, entry },
          ...(evidence === undefined ? {} : { evidenceInText: evidence }),
        })
      }
    }
    for (const raw of payload.current_states ?? []) {
      const characterId = asCharacter(raw.character_id)
      if (characterId === undefined || !roster.has(characterId) || raw.confidence !== 'high') continue
      const where = cleanText(raw.where, 200)
      const state = cleanText(raw.state, 200)
      const concern = cleanText(raw.concern, 200)
      stateUpdates.set(characterId, {
        ...(where === undefined ? {} : { where }),
        ...(state === undefined ? {} : { state }),
        ...(concern === undefined ? {} : { concern }),
      })
    }

    // 信息差: a planned gap the text closed (evidence-gated) waits for the person — adopting it rewrites 知道/不知道.
    const gapsSeen = new Set<number>()
    for (const raw of payload.info_gaps_closed ?? []) {
      const index = cleanNumber(raw.gap)
      const gap = index === undefined || !Number.isInteger(index) ? undefined : plan?.infoGaps?.[index - 1]
      if (gap === undefined || gapsSeen.has(index!)) continue
      const evidence = cleanText(raw.evidence_in_text, 60)
      if (!evidenceInBody(body, evidence)) {
        dropped.push({ kind: 'info-gap', reason: 'evidence-not-found', ref: String(index) })
        continue
      }
      const characterId = asCharacter(gap.who)
      if (characterId === undefined || !roster.has(characterId)) {
        dropped.push({ kind: 'info-gap', reason: 'character-not-in-roster', ref: gap.who })
        continue
      }
      gapsSeen.add(index!)
      pend({
        kind: 'info-gap', chapter: chapter.n, reason: `信息差：得知「${gap.fact}」`,
        payload: { characterId, fact: gap.fact },
        evidenceInText: evidence!,
      })
    }

    // Relations. Points land in the journal at once (evidence-gated, one row per pair);
    // a milestone, a rift, a repair or a new type waits for the person.
    const relationLines: Record<string, unknown>[] = []
    const relationOf = new Map(entries.relations.filter(view => view.cardStatus === 'kept').map(view => [view.cardId, view]))
    const asRelation = (token: unknown): RelationView | undefined => {
      const handle = this.resolveCard(entries, token, 'relation')
      return handle?.role === 'relation' ? relationOf.get(handle.cardId) : undefined
    }
    const scored = new Set<string>()
    for (const raw of payload.relation_points ?? []) {
      const view = asRelation(raw.relation_id)
      if (view === undefined) {
        dropped.push({ kind: 'relation', reason: 'id-not-in-ledger', ref: String(raw.relation_id) })
        continue
      }
      const delta = Math.max(-MAX_RELATION_DELTA, Math.min(MAX_RELATION_DELTA, Math.round(Number(raw.delta))))
      if (!Number.isFinite(delta) || delta === 0 || scored.has(view.cardId)) continue
      const evidence = cleanText(raw.evidence_in_text, 60)
      if (!evidenceInBody(body, evidence)) {
        dropped.push({ kind: 'relation', reason: 'evidence-not-found', ref: view.ref })
        continue
      }
      scored.add(view.cardId)
      relationLines.push({ relationId: view.cardId, chapter: chapter.n, kind: 'points', delta, evidence: evidence!, createdAt: now })
    }
    const relationPended = new Set<string>()
    const pendRelation = (view: RelationView, event: RelationEvent, reason: string, evidence: string, toType?: RelationType): void => {
      const key = `${view.cardId}:${event}`
      if (relationPended.has(key)) return
      relationPended.add(key)
      const move = relationMove(view, event, toType, [])
      pend({
        kind: 'relation', chapter: chapter.n, reason, evidenceInText: evidence,
        payload: { relationId: view.cardId, event, ...(move === undefined ? {} : { stage: move.stage }), ...(toType === undefined ? {} : { toType }) },
      })
    }
    for (const raw of payload.relation_milestones ?? []) {
      const view = asRelation(raw.relation_id)
      if (view === undefined) {
        dropped.push({ kind: 'relation', reason: 'id-not-in-ledger', ref: String(raw.relation_id) })
        continue
      }
      // Only a pair the brief offered as 可升 can level up: the bar is the code's, not the model's.
      const next = view.ready ? nextMilestoneOf(view) : undefined
      if (next === undefined) {
        dropped.push({ kind: 'relation', reason: 'stage-mismatch', ref: view.ref })
        continue
      }
      const evidence = cleanText(raw.evidence_in_text, 60)
      if (!evidenceInBody(body, evidence)) {
        dropped.push({ kind: 'relation', reason: 'evidence-not-found', ref: view.ref })
        continue
      }
      pendRelation(view, 'up', `关系升级：${view.name} ${view.stage} → ${next.stage}`, evidence!)
    }
    // Rifts first, so a type change in the same chapter (同盟 → 裂痕 → 对手) sees the rift it needs.
    const CHANGE_EVENT: Readonly<Record<string, RelationEvent>> = { 裂痕: 'crack', 决裂: 'break', 修复: 'fix', 转类型: 'type' }
    const changes = (payload.relation_changes ?? [])
      .map(raw => ({ raw, event: CHANGE_EVENT[cleanText(raw.change, 10) ?? ''] }))
      .sort((a, b) => Number(a.event === 'type') - Number(b.event === 'type'))
    const riftAfter = new Map<string, '裂痕' | '决裂'>()
    for (const { raw, event } of changes) {
      const view = asRelation(raw.relation_id)
      if (view === undefined || event === undefined) {
        dropped.push({ kind: 'relation', reason: 'id-not-in-ledger', ref: String(raw.relation_id) })
        continue
      }
      const toType = relationTypeOf(cleanText(raw.to_type, 10))
      const rift = riftAfter.get(view.cardId) ?? view.rift
      if (relationMove({ type: view.type, ...(view.level === undefined ? {} : { level: view.level }), ...(rift === undefined ? {} : { rift }) }, event, toType, []) === undefined) {
        dropped.push({ kind: 'relation', reason: 'stage-mismatch', ref: view.ref })
        continue
      }
      const evidence = cleanText(raw.evidence_in_text, 60)
      if (!evidenceInBody(body, evidence)) {
        dropped.push({ kind: 'relation', reason: 'evidence-not-found', ref: view.ref })
        continue
      }
      if (event === 'crack' || event === 'break') riftAfter.set(view.cardId, event === 'crack' ? '裂痕' : '决裂')
      const reason = event === 'crack' ? `关系裂痕：${view.name}`
        : event === 'break' ? `关系决裂：${view.name}`
          : event === 'fix' ? `关系修复：${view.name}`
            : `关系转为「${toType}」：${view.name}`
      pendRelation(view, event, reason, evidence!, event === 'type' ? toType : undefined)
    }
    // New pairs land as live cards at the first level, like new characters (gate 3).
    const pairsSeen: string[][] = entries.relations.filter(view => view.cardStatus !== 'archived').map(view => [...view.pair])
    for (const raw of payload.new_relations ?? []) {
      const a = asCharacter(raw.a)
      const b = asCharacter(raw.b)
      const type = relationTypeOf(cleanText(raw.type, 10))
      const label = `${cleanText(raw.a, 40) ?? '?'} × ${cleanText(raw.b, 40) ?? '?'}`
      if (a === undefined || b === undefined || a === b || !roster.has(a) || !roster.has(b)) {
        dropped.push({ kind: 'new-relation', reason: 'character-not-in-roster', ref: label })
        continue
      }
      if (type === undefined) continue
      if (pairsSeen.some(pair => samePair(pair, [a, b]))) {
        dropped.push({ kind: 'new-relation', reason: 'duplicate', ref: label })
        continue
      }
      const evidence = cleanText(raw.evidence_in_text, 60)
      if (!evidenceInBody(body, evidence)) {
        dropped.push({ kind: 'new-relation', reason: 'evidence-not-found', ref: label })
        continue
      }
      pairsSeen.push([a, b])
      const nameOf = (cardId: string): string => entries.characters.find(view => view.cardId === cardId)?.name
        ?? [...newCharacterIds].find(([, id]) => id === cardId)?.[0] ?? cardId
      const name = `${nameOf(a)} × ${nameOf(b)}`
      const stage = stageNameOf(type, 1)
      const nowLine = cleanText(raw.now, 200)
      const category = categoryOf(board, 'relation')
      const mutation = category === undefined ? undefined : await canvas.proposeCard({
        canvasId: id, kind: category, text: '', source, comment: `第${chapter.n}章：「${evidence}」`, live: true,
        fields: { name, pair: [a, b], type, stage, ...(nowLine === undefined ? {} : { now: nowLine }) },
      }, session)
      if (mutation === undefined || !mutation.ok) {
        dropped.push({ kind: 'relation', reason: 'card-refused', ref: name })
        continue
      }
      board = mutation.board
      const cardId = board.cards[board.cards.length - 1]!.id
      notes.set(cardId, { evidenceInText: evidence! })
      newCards.push({ cardId, role: 'relation', text: name })
      relationLines.push(stageLine({ relationId: cardId, chapter: chapter.n, event: 'start', stage, level: 1, evidence: evidence! }))
    }

    for (const [foreshadowId, mark] of touch) {
      const card = board.cards.find(candidate => candidate.id === foreshadowId)
      if (card === undefined) continue
      // The card's 状态 mirrors the derived state, so the board face reads what the ledger reads.
      const status = laterForeshadowState(foreshadowOf.get(foreshadowId)?.state ?? '已埋', MENTION_TO_STATE[mark.kind])
      const fields: Record<string, NovelFieldValue> = { ...card.fields, status }
      if (mark.kind === 'planted' && cleanNumber(card.fields?.['plantedAt']) === undefined) fields['plantedAt'] = chapter.n
      if (mark.kind === 'resolved' && mark.answer !== undefined) fields['answer'] = mark.answer
      const mutation = await canvas.patchCard({ canvasId: id, cardId: foreshadowId, fields }, session)
      if (!mutation.ok) return { ok: false, error: canvasErrorOf(mutation.error), ...empty, dropped }
      board = mutation.board
    }
    for (const [characterId, currentState] of stateUpdates) notes.set(characterId, { currentState })
    const annotated = await this.ensureRefs(id, session, board, notes)
    if (!annotated.ok) return { ok: false, error: annotated.error ?? 'io', ...empty, dropped }
    const refs = annotated.annotations?.refs ?? {}
    const landed = newCards.map(card => refs[card.cardId] === undefined ? card : { ...card, ref: refOf(card.role, refs[card.cardId]!) })
    const appendedMentions = await this.appendJsonl(await this.fileTarget(id, WORK_FILES.mentions), session, journalLines)
    if (!appendedMentions.ok) return { ok: false, error: appendedMentions.error ?? 'io', ...empty, dropped }
    const appendedExperiences = await this.appendJsonl(await this.fileTarget(id, WORK_FILES.experiences), session, experienceLines)
    if (!appendedExperiences.ok) return { ok: false, error: appendedExperiences.error ?? 'io', ...empty, dropped }
    const appendedRelations = await this.appendJsonl(await this.fileTarget(id, WORK_FILES.relations), session, relationLines)
    if (!appendedRelations.ok) return { ok: false, error: appendedRelations.error ?? 'io', ...empty, dropped }
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
        if (plan !== undefined) mutable.delivery = { beats: beatsDelivered, ops: opsDelivered }
        if (recap !== undefined) mutable.recap = recap
        mutable.wordCount = body.replace(/\s+/g, '').length
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
              ...(item.confidence === undefined ? {} : { confidence: item.confidence }),
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
    return { ok: true, ...report, dropped, pendingItems, newCards: landed }
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
   * (a mention journal line plus its card's status, an experience line —
   * plan-missed has nothing to materialize: the answer IS the resolution);
   * discard just settles the item. Settled items stay in the table (the queue
   * is a snapshot, and the trail matters).
   * @param request - work id, item id, the action.
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns the receipt, or the failure code.
   */
  async decidePending(
    request: { readonly workId: string; readonly id: string; readonly action: 'accept' | 'discard' },
    session: Session,
  ): Promise<{ readonly ok: boolean; readonly error?: NovelError }> {
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
  private async materializePending(workId: string, item: PendingItem, session: Session): Promise<NovelError | undefined> {
    const now = new Date().toISOString()
    // Every journal line belongs to the chapter its finding came from; an item without one cannot land.
    const chapter = item.chapter
    if (item.kind === 'mention') {
      const canvas = this.canvas
      const foreshadowId = item.payload.foreshadowId
      const kind = item.payload.kind
      if (chapter === undefined || foreshadowId === undefined || (kind !== 'planted' && kind !== 'advanced' && kind !== 'hinted' && kind !== 'resolved')) return 'invalid-name'
      const entries = await this.readEntries(workId)
      const card = entries?.board.cards.find(candidate => candidate.id === foreshadowId)
      const view = entries?.foreshadows.find(candidate => candidate.cardId === foreshadowId)
      if (canvas === undefined || card === undefined) return 'missing'
      const appended = await this.appendJsonl(await this.fileTarget(workId, WORK_FILES.mentions), session, [{
        foreshadowId,
        chapter,
        kind,
        planned: false,
        ...(item.payload.note === undefined ? {} : { note: item.payload.note }),
        createdAt: now,
      }])
      if (!appended.ok) return appended.error
      const fields: Record<string, NovelFieldValue> = { ...card.fields, status: laterForeshadowState(view?.state ?? '已埋', MENTION_TO_STATE[kind]) }
      if (kind === 'planted' && cleanNumber(card.fields?.['plantedAt']) === undefined) fields['plantedAt'] = chapter
      if (kind === 'resolved' && item.payload.answer !== undefined) fields['answer'] = item.payload.answer
      const mutation = await canvas.patchCard({ canvasId: workId, cardId: foreshadowId, fields }, session)
      return mutation.ok ? undefined : canvasErrorOf(mutation.error)
    }
    if (item.kind === 'experience') {
      const { characterId, entry } = item.payload
      if (chapter === undefined || characterId === undefined || entry === undefined) return 'invalid-name'
      const appended = await this.appendJsonl(await this.fileTarget(workId, WORK_FILES.experiences), session, [{
        characterId,
        chapter,
        entry,
        createdAt: now,
      }])
      return appended.ok ? undefined : appended.error
    }
    if (item.kind === 'info-gap') {
      const canvas = this.canvas
      const { characterId, fact } = item.payload
      if (chapter === undefined || characterId === undefined || fact === undefined) return 'invalid-name'
      const card = (await this.readEntries(workId))?.board.cards.find(candidate => candidate.id === characterId)
      if (canvas === undefined || card === undefined) return 'missing'
      const mutation = await canvas.patchCard({ canvasId: workId, cardId: characterId, fields: learnFact(card.fields ?? {}, fact, chapter) }, session)
      return mutation.ok ? undefined : canvasErrorOf(mutation.error)
    }
    if (item.kind === 'relation') {
      const canvas = this.canvas
      const { relationId } = item.payload
      const event = relationEventOf(item.payload.event)
      if (chapter === undefined || relationId === undefined || event === undefined) return 'invalid-name'
      const entries = await this.readEntries(workId)
      const view = entries?.relations.find(candidate => candidate.cardId === relationId)
      const card = entries?.board.cards.find(candidate => candidate.id === relationId)
      if (canvas === undefined || view === undefined || card === undefined) return 'missing'
      // The move is re-derived from the card as it stands now: the person may have changed it since.
      const toType = relationTypeOf(item.payload.toType)
      const move = relationMove(view, event, toType, await this.listRelationJournal({ workId, relationId }))
      if (move === undefined) return 'invalid-name'
      const mutation = await canvas.patchCard({ canvasId: workId, cardId: relationId, fields: { ...card.fields, type: move.type, stage: move.stage } }, session)
      if (!mutation.ok) return canvasErrorOf(mutation.error)
      const appended = await this.appendJsonl(await this.fileTarget(workId, WORK_FILES.relations), session, [stageLine({
        relationId, chapter, event, stage: move.stage,
        ...(move.level === undefined ? {} : { level: move.level }),
        ...(event === 'type' ? { fromType: view.type, toType: move.type } : {}),
        ...(item.evidenceInText === undefined ? {} : { evidence: item.evidenceInText }),
      })])
      return appended.ok ? undefined : appended.error
    }
    // plan-missed: the person's answer is the resolution — nothing materializes.
    return undefined
  }
}

/**
 * A character card's fields once they learn a fact in chapter n: the fact
 * joins 知道 as `fact（第n章得知）`, and the 不知道 lines it answers (the
 * same line, or one either contains) leave.
 */
export function learnFact(fields: Readonly<Record<string, NovelFieldValue>>, fact: string, chapter: number): Record<string, NovelFieldValue> {
  const lines = (key: string): string[] => linesOf(fields[key])
  const answered = (line: string): boolean => line === fact || line.includes(fact) || fact.includes(line)
  const knows = [...lines('knows').filter(line => !line.startsWith(fact)), `${fact}（第${chapter}章得知）`]
  const unaware = lines('unaware').filter(line => !answered(line))
  const out: Record<string, NovelFieldValue> = { ...fields, knows: knows.join('\n') }
  if (unaware.length > 0) out['unaware'] = unaware.join('\n')
  else delete out['unaware']
  return out
}

/** The last ~200 characters of a manuscript (the write brief's 上一章末段). */
export function tailOf(body: string, max = 200): string | undefined {
  const trimmed = body.trim()
  if (trimmed === '') return undefined
  return trimmed.length <= max ? trimmed : `……${trimmed.slice(-max)}`
}

/** One relation-journal stage line, stamped now. */
function stageLine(line: {
  readonly relationId: string; readonly chapter: number; readonly event: RelationEvent; readonly stage: string
  readonly level?: number; readonly fromType?: RelationType; readonly toType?: RelationType; readonly evidence?: string
}): Record<string, unknown> {
  return { ...line, kind: 'stage', createdAt: new Date().toISOString() }
}

/** Whether two pairs name the same two characters, in either order. */
function samePair(a: readonly string[], b: readonly string[]): boolean {
  return a.length === 2 && b.length === 2 && a.includes(b[0]!) && a.includes(b[1]!)
}

/**
 * The pair a relation's name spells (`老周 × 小满`, `老周&小满`, `老周、小满`):
 * the two character ids whose names the halves are, or fewer when a half
 * names no character.
 */
export function pairFromName(characters: readonly Pick<CharacterView, 'cardId' | 'name'>[], name: string | undefined): string[] {
  if (name === undefined) return []
  const ids = name.split(/\s*[×xX＆&/／、]\s*/)
    .map(half => characters.find(view => view.name === half.trim())?.cardId)
    .filter((id): id is string => id !== undefined)
  return [...new Set(ids)]
}

/** The category id holding a role's cards on this board, or undefined. */
function categoryOf(board: NovelBoardView, role: EntryRole): string | undefined {
  return board.categories.find(category => category.role === role)?.id
}

/** Every card in one of the four role categories, by id → role. */
function rolesOn(board: NovelBoardView): Map<string, EntryRole> {
  const roleOfCategory = new Map<string, EntryRole>()
  for (const category of board.categories) {
    const role = ENTRY_ROLES.find(candidate => candidate === category.role)
    if (role !== undefined) roleOfCategory.set(category.id, role)
  }
  const out = new Map<string, EntryRole>()
  for (const card of board.cards) {
    const role = roleOfCategory.get(card.kind)
    if (role !== undefined) out.set(card.id, role)
  }
  return out
}

/** Live foreshadows, longest-slept first (an unknown sleep sorts as just touched). */
function sortBySleep(views: readonly ForeshadowView[]): ForeshadowView[] {
  return [...views].sort((a, b) => Number(b.starred) - Number(a.starred) || (b.slept ?? 0) - (a.slept ?? 0))
}

/**
 * How many reconciled chapters come after one chapter in reading order (seq,
 * not n — an inserted chapter sits where it reads). Only reconciled chapters
 * count: mentions are recorded by the 对账, so a chapter still being planned
 * or written cannot have touched anything yet and must not age the ledger.
 * A base chapter the table does not hold (a hand-typed 埋于) places by its
 * number.
 * @param chapters - the chapter index.
 * @returns the counter for one base chapter number.
 */
export function sleepCounter(chapters: readonly ChapterRecord[]): (base: number) => number {
  const reconciled = chapters.filter(chapter => chapter.phase === 'extracted' || chapter.phase === 'reviewed')
  return base => {
    const at = chapters.find(chapter => chapter.n === base)?.seq ?? base
    return reconciled.filter(chapter => chapter.seq > at).length
  }
}

/**
 * Build the role views off one board read (pure: the store reads, this
 * derives).
 * @param board - the novel board.
 * @param annotations - the sidecar.
 * @param mentions - the mention journal.
 * @param chapters - the chapter index.
 * @param relationJournal - the relation journal.
 * @returns the work's entries.
 */
export function entriesOf(
  board: NovelBoardView,
  annotations: Annotations,
  mentions: readonly MentionEntry[],
  chapters: readonly ChapterRecord[],
  relationJournal: readonly RelationEntry[] = [],
): WorkEntries {
  const roleOf = rolesOn(board)
  const currentChapter = chapters.reduce((max, chapter) => Math.max(max, chapter.n), 0)
  const slept = sleepCounter(chapters)
  const lastActive = new Map<string, number>()
  const kindsOf = new Map<string, MentionEntry['kind'][]>()
  for (const mention of mentions) {
    lastActive.set(mention.foreshadowId, Math.max(lastActive.get(mention.foreshadowId) ?? 0, mention.chapter))
    const kinds = kindsOf.get(mention.foreshadowId)
    if (kinds === undefined) kindsOf.set(mention.foreshadowId, [mention.kind])
    else kinds.push(mention.kind)
  }
  const rules: RuleView[] = []
  const foreshadows: ForeshadowView[] = []
  const characters: CharacterView[] = []
  const relationCards: { card: NovelCardView; ref: string }[] = []
  for (const card of board.cards) {
    const role = roleOf.get(card.id)
    if (role === undefined) continue
    const n = annotations.refs[card.id]
    const ref = n === undefined ? card.id : refOf(role, n)
    const note = annotations.notes[card.id]
    if (role === 'relation') {
      relationCards.push({ card, ref })
    } else if (role === 'world' || role === 'principle') {
      const body = mainTextOf(card, role)
      const name = role === 'world' ? fieldText(card, 'name', 80) : undefined
      const kind = role === 'world' ? fieldText(card, 'kind', 10) : undefined
      const text = name === undefined ? body : `${name}${kind === undefined ? '' : `（${kind}）`}：${body}`
      rules.push({ cardId: card.id, ref, role, ...(name === undefined ? {} : { name }), text, status: card.status })
    } else if (role === 'foreshadow') {
      const plantedAt = cleanNumber(card.fields?.['plantedAt'])
      const active = lastActive.get(card.id)
      const answer = fieldText(card, 'answer', 500)
      const base = active ?? plantedAt
      const starred = note?.starred === true
      foreshadows.push({
        cardId: card.id,
        ref,
        question: mainTextOf(card, role),
        state: deriveForeshadowState(card.fields?.['status'], plantedAt, kindsOf.get(card.id) ?? []),
        cardStatus: card.status,
        ...(plantedAt === undefined ? {} : { plantedAt }),
        ...(answer === undefined ? {} : { answer }),
        starred,
        ...(active === undefined ? {} : { lastActiveChapter: active }),
        ...(base === undefined ? {} : { slept: slept(base) }),
      })
    } else {
      const optional = (key: 'identity' | 'want' | 'lack' | 'wound' | 'appearance' | 'voice') => {
        const value = fieldText(card, key, 500)
        return value === undefined ? {} : { [key]: value }
      }
      characters.push({
        cardId: card.id,
        ref,
        name: mainTextOf(card, role),
        ...optional('identity'),
        ...optional('want'),
        ...optional('lack'),
        ...optional('wound'),
        ...optional('appearance'),
        ...optional('voice'),
        knows: linesOf(card.fields?.['knows']),
        unaware: linesOf(card.fields?.['unaware']),
        secrets: linesOf(card.fields?.['secrets']),
        relations: [],
        ...(note?.currentState === undefined ? {} : { currentState: note.currentState }),
        cardStatus: card.status,
      })
    }
  }
  // Relations read last: their pair names characters, and a character's 关系 is read off them.
  const living = characters.filter(view => view.cardStatus !== 'archived')
  const relations = relationCards.map(({ card, ref }): RelationView => {
    const type = relationTypeOf(card.fields?.['type']) ?? '其他'
    const name = mainTextOf(card, 'relation')
    const refs = Array.isArray(card.fields?.['pair']) ? card.fields['pair'].filter(id => roleOf.get(id) === 'character') : []
    const pair = refs.length > 0 ? [...new Set(refs)] : pairFromName(living, name)
    const written = fieldText(card, 'stage', 20)
    const read = written === undefined ? { level: 1 } : readRelationStage(type, written)
    const progress = relationProgress(relationJournal.filter(entry => entry.relationId === card.id))
    const now = fieldText(card, 'now', 200)
    return {
      cardId: card.id, ref, name, pair, type,
      stage: written ?? stageNameOf(type, 1),
      ...(read.level === undefined ? {} : { level: read.level }),
      ...(read.rift === undefined ? {} : { rift: read.rift }),
      ...(now === undefined ? {} : { now }),
      views: linesOf(card.fields?.['views']),
      progress,
      ready: read.level !== undefined && read.level < 4 && read.rift === undefined && progress >= PTS_PER_LEVEL,
      cardStatus: card.status,
    }
  })
  const withRelations = characters.map(view => {
    const lines = relations
      .filter(relation => relation.cardStatus !== 'archived' && relation.pair.length === 2 && relation.pair.includes(view.cardId))
      .map(relation => {
        const other = characters.find(candidate => candidate.cardId === relation.pair.find(id => id !== view.cardId))?.name ?? '?'
        return `${other} · ${relation.type} · ${relation.stage}${relation.now === undefined ? '' : ` — ${relation.now}`}`
      })
    return lines.length === 0 ? view : { ...view, relations: lines }
  })
  return { board, annotations, roleOf, rules, foreshadows, characters: withRelations, relations, currentChapter }
}

/** Tolerant readers for the JSON documents (the store's read gate). */
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
  return {
    characterId,
    chapter,
    entry,
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
    ...(note === undefined ? {} : { note }),
    createdAt: cleanText(record['createdAt'], 40) ?? '',
  }
}

export default NovelService
