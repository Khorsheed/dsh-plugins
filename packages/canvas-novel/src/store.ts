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
 * the chapter index, the pending queue and the two journals.
 *
 * That state root is deployment-level state, NOT a session workspace, and the
 * fence reflects that — the canvas store's exact pattern: the CALLING session
 * resolves the MODE (a read-only deployment stays read-only) and lends its id
 * to the write, while the writable boundary re-roots at the plugin's own
 * state dir. Every document write goes through the mounted `ctx.fs` under a
 * version guard (read → apply → replaceIfVersion, one stale retry); the two
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
  canvasBoardOf, NOVEL_GENRE, NOVEL_ROLES,
  type CanvasBoardSlice, type NovelBoardMutation, type NovelBoardView, type NovelCardSource, type NovelCardView,
  type NovelFieldValue,
} from './genre.ts'
import {
  chapterFileName, cleanNumber, cleanText, effectiveChapterPhase, foreshadowStateOf, linesOf, MENTION_TO_STATE,
  normalizeAnnotations, normalizeChapter, normalizePendingItem, normalizePlan, normalizeWorkId, NOVEL_GENRE_ID,
  OP_TO_MENTION, parseRef, refGroupOf, refOf,
  type Annotations, type CardNote, type ChapterRecord, type ChapterRow, type ChapterTable, type CharacterView, type Confidence,
  type CurrentState, type EffectiveChapterPhase, type EntryRole, type ExperienceEntry, type ExtractPayload,
  type ForeshadowView, type ImportDrop, type ImportReport, type LedgerResult, type MentionEntry, type NovelError,
  type PendingItem, type PendingKind, type PendingPayload, type PendingTable, type ReviewAction, type RuleView,
  type WorkMeta, type WriteChapterRequest,
} from './types.ts'

/** The state directory name under `$DSH_HOME/state`. */
export const NOVEL_STATE_DIR_NAME = 'novel'

/** Per-work file names, under `<stateRoot>/<canvasId>/`. */
export const WORK_FILES = {
  annotations: 'annotations.json',
  experiences: 'experiences.jsonl',
  mentions: 'mentions.jsonl',
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
 * Check agent-sent fields against the genre's seeded card type for a role:
 * known keys only, select values from their options, numbers as numbers,
 * lists joined one item per line (一行一件).
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
    const text = Array.isArray(value) ? cleanText(value.map(String).join('\n')) : cleanText(typeof value === 'number' ? String(value) : value)
    if (text === undefined || (def.options !== undefined && !def.options.includes(text))) {
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
   * the sidecar note.
   * @param workId - the canvas id.
   * @returns the entries, or undefined when the canvas is no novel work.
   */
  async readEntries(workId: string): Promise<WorkEntries | undefined> {
    const board = await this.readNovelBoard(workId)
    if (board === undefined) return undefined
    const [annotations, mentions, chapters] = await Promise.all([
      this.readAnnotations(board.id), this.listMentions({ workId: board.id }), this.readChapters(board.id),
    ])
    return entriesOf(board, annotations, mentions, chapters)
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
      const used: Record<'character' | 'entry', Set<number>> = { character: new Set(), entry: new Set() }
      const refs: Record<string, number> = { ...data.refs }
      const waiting: { cardId: string; group: 'character' | 'entry' }[] = []
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
   * card id, a ref (`c3`, `#12`, `w12`), a bare number (its numbering space
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
   * The agent's card write. Without an id it proposes a new card in the
   * role's category — a ghost the user keeps (✓) or archives (✗), never
   * injected before then; with an id it merges the given fields into that
   * card (absent fields keep). Fields are checked against the genre's card
   * type; unknown keys are ignored and reported back.
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
      if (category === undefined || fields[MAIN_FIELD[request.role]] === undefined) return { ok: false, error: 'invalid-name', ignored }
      const comment = cleanText(request.comment, 500)
      mutation = await canvas.proposeCard({
        canvasId: entries.board.id, kind: category, text: '', fields,
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
   * The review verb on one card (采纳/丢弃/归档/撤销), through the canvas's
   * own status: accept keeps a ghost, discard archives it, archive retires a
   * kept card, retract takes an automatic import back (自动·可撤销). Archived
   * cards stay on the board, hidden — nothing is deleted.
   * @param request - work id, card handle, the action.
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns the receipt, or the failure code.
   */
  async reviewCard(
    request: { readonly workId: string; readonly id: string; readonly action: ReviewAction },
    session: Session,
  ): Promise<{ readonly ok: boolean; readonly error?: NovelError; readonly cardId?: string }> {
    const canvas = this.canvas
    const entries = await this.readEntries(request.workId)
    if (canvas === undefined || entries === undefined) return { ok: false, error: 'missing' }
    const handle = this.resolveCard(entries, request.id)
    const card = handle === undefined ? undefined : entries.board.cards.find(candidate => candidate.id === handle.cardId)
    if (card === undefined) return { ok: false, error: 'missing' }
    const legal = request.action === 'accept' || request.action === 'discard'
      ? card.status === 'proposed'
      : request.action === 'archive'
        ? card.status === 'kept'
        : card.status === 'kept' && entries.annotations.notes[card.id]?.autoImported === true
    if (!legal) return { ok: false, error: 'invalid-name' }
    const mutation = await canvas.patchCard({
      canvasId: entries.board.id, cardId: card.id, status: request.action === 'accept' ? 'kept' : 'archived',
    }, session)
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

  /**
   * Take one automatic experience back (自动·可撤销, invariant 3): the line
   * leaves the journal. The journal is append-only for the SYSTEM; the user's
   * retract gesture is the one sanctioned exception, and it rides the same
   * guarded rewrite the appends use, keeping every other line byte-identical.
   * A line without an id cannot be retracted by handle — the user edits the
   * journal by hand for those.
   * @param request - work id and the entry id (`e<n>`).
   * @param session - the session that owns the gesture; supplies the fence.
   * @returns the receipt, or the failure code.
   */
  async retractExperience(
    request: { readonly workId: string; readonly id: string },
    session: Session,
  ): Promise<{ readonly ok: boolean; readonly error?: NovelError }> {
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
        return { ok: false, error: novelErrorOf(error) }
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
        const code = novelErrorOf(error)
        if (code === 'stale' && attempt === 0) continue
        return { ok: false, error: code }
      }
    }
    /* v8 ignore next -- the loop's second iteration always returns */
    return { ok: false, error: 'stale' }
  }

  /** The mention journal (a foreshadow card's chapter track), optionally one card's, oldest first. */
  async listMentions(request: { readonly workId: string; readonly foreshadowId?: string }): Promise<MentionEntry[]> {
    const id = normalizeWorkId(request.workId)
    if (id === undefined) return []
    const entries = await this.readJsonl(await this.fileTarget(id, WORK_FILES.mentions), raw => normalizeMention(raw))
    return entries.filter(entry => request.foreshadowId === undefined || entry.foreshadowId === request.foreshadowId)
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
          characters: rawPlan.characters.map(token => toCard(token, 'character')),
        }
      }
    }
    const content = typeof request.content === 'string' && request.content.length > 0 ? request.content.slice(0, 2_000_000) : undefined

    // The body lands before the registration (F1-2): a write that the fence
    // refuses means NO chapter row — the 空槽登记 bug class is closed by
    // construction.
    if (content !== undefined) {
      const workspace = meta.workspace
      if (workspace === undefined) return { ok: false, error: 'no-workspace' }
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
   * answers, and the health counts (活跃/超期⚠/已揭/弃置). 超期 = 3+ chapters
   * untouched.
   * @param request - the work id.
   * @returns the ledger rows and counts, or the failure code.
   */
  async ledger(request: { readonly workId: string }): Promise<LedgerResult> {
    const entries = await this.readEntries(request.workId)
    if (entries === undefined) return { ok: false, error: 'missing', active: [], resolved: [], counts: { active: 0, overdue: 0, resolved: 0, abandoned: 0 }, currentChapter: 0 }
    const kept = entries.foreshadows.filter(view => view.cardStatus === 'kept')
    const active = sortBySleep(kept.filter(isLiveForeshadow))
    const resolved = kept.filter(view => view.state === '已揭晓')
    return {
      ok: true,
      active,
      resolved,
      counts: {
        active: active.length,
        overdue: active.filter(view => (view.slept ?? 0) >= 3).length,
        resolved: resolved.length,
        abandoned: kept.filter(view => view.state === '已放弃').length,
      },
      currentChapter: entries.currentChapter,
    }
  }

  /* --------------------------------------------------------------- brief */

  /**
   * Gather everything one brief renders (the async half; brief.ts renders
   * synchronously from this). Only kept cards feed it — a ghost card is not
   * the user's yet. The target chapter: the explicit n, else the newest
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
    const inSceneIds = new Set(target.plan?.characters ?? [])
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
   *   3. new rules, foreshadows and characters below high confidence — and
   *      every new foreshadow and character — land as ghost cards the user
   *      keeps or archives on the board;
   *   4. high confidence lands automatically (a kept card or a journal line,
   *      marked 自动·可撤销); medium/low journal lines go to the pending queue;
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
    const empty = {
      verified: 0, missed: 0, autoImported: 0, pending: 0,
      dropped: [] as ImportDrop[], pendingItems: [] as { id: string; kind: PendingKind; reason: string }[],
      proposedCards: [] as { cardId: string; role: EntryRole; text: string }[],
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
    const report = { verified: 0, missed: 0, autoImported: 0, pending: 0 }
    const toPending: { kind: PendingKind; confidence: 'medium' | 'low'; chapter?: number; reason: string; evidenceInText?: string; payload: PendingPayload }[] = []
    const pend = (item: (typeof toPending)[number]): void => { toPending.push(item); report.pending += 1 }
    const confidenceOf = (raw: unknown): Confidence => raw === 'high' ? 'high' : raw === 'low' ? 'low' : 'medium'
    const foreshadowOf = new Map(entries.foreshadows.map(view => [view.cardId, view]))
    const whitelist = new Set(entries.foreshadows
      .filter(view => view.cardStatus === 'kept' && (isLiveForeshadow(view) || view.state === '未埋'))
      .map(view => view.cardId))
    const roster = new Set(entries.characters.filter(view => view.cardStatus === 'kept').map(view => view.cardId))
    const asForeshadow = (token: unknown): string | undefined => {
      const handle = this.resolveCard(entries, token, 'foreshadow')
      return handle?.role === 'foreshadow' ? handle.cardId : undefined
    }
    const asCharacter = (token: unknown): string | undefined => {
      const handle = this.resolveCard(entries, token, 'character')
      return handle?.role === 'character' ? handle.cardId : undefined
    }
    const now = new Date().toISOString()
    const source: NovelCardSource = { type: 'file', ref: join(meta.workspace ?? '', meta.title, chapter.file), title: `第${chapter.n}章` }

    // The card writes this import will make (gate 3/4), collected first and landed below.
    const cardWrites: { role: EntryRole; fields: Record<string, NovelFieldValue>; auto: boolean; note: CardNote; comment?: string; ref: string }[] = []

    // World rules and principles: evidence first (gate 1); high → a kept card, medium/low → a ghost.
    for (const raw of payload.memories ?? []) {
      const content = cleanText(raw.content)
      if (content === undefined) continue
      const evidence = cleanText(raw.evidence_in_text, 60)
      if (!evidenceInBody(body, evidence)) {
        dropped.push({ kind: 'memory', reason: 'evidence-not-found', ref: content.slice(0, 30) })
        continue
      }
      const role: EntryRole = cleanText(raw.kind, 10) === '原则' ? 'principle' : 'world'
      const confidence = confidenceOf(raw.confidence)
      const note: CardNote = { extractedBy: 'llm', confidence, evidenceInText: evidence!, firstChapter: chapter.n }
      if (confidence === 'high') {
        cardWrites.push({ role, fields: { [MAIN_FIELD[role]]: content }, auto: true, note: { ...note, autoImported: true }, ref: content.slice(0, 30) })
      } else {
        cardWrites.push({
          role, fields: { [MAIN_FIELD[role]]: content }, auto: false, note,
          comment: `置信度 ${confidence} · 第${chapter.n}章：「${evidence}」`, ref: content.slice(0, 30),
        })
      }
    }

    // Mentions: whitelist (gate 2) + evidence (gate 1); high records, medium/low pends.
    const recordedMentions: { id: string; kind: MentionEntry['kind'] }[] = []
    const journalLines: Record<string, unknown>[] = []
    const touch = new Map<string, { readonly kind: MentionEntry['kind']; readonly answer?: string }>()
    const plannedIds = new Set((chapter.plan?.foreshadowOps ?? []).map(op => asForeshadow(op.id)).filter(Boolean))
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

    // Gate 3: new foreshadows and characters are always ghosts (evidence still greps — gate 1).
    let newForeshadows = 0
    for (const raw of payload.new_foreshadows ?? []) {
      const question = cleanText(raw.question, 200)
      if (question === undefined) continue
      const evidence = cleanText(raw.evidence_in_text, 60)
      if (!evidenceInBody(body, evidence)) {
        dropped.push({ kind: 'new-foreshadow', reason: 'evidence-not-found', ref: question.slice(0, 30) })
        continue
      }
      const tension = cleanNumber(raw.tension)
      newForeshadows += 1
      cardWrites.push({
        role: 'foreshadow', fields: { question, status: '已埋', plantedAt: chapter.n }, auto: false,
        note: { extractedBy: 'llm', evidenceInText: evidence!, firstChapter: chapter.n, ...(tension === undefined ? {} : { tension }) },
        comment: `第${chapter.n}章新埋：「${evidence}」`, ref: question.slice(0, 30),
      })
    }
    for (const raw of payload.new_characters ?? []) {
      const name = cleanText(raw.name, 80)
      if (name === undefined) continue
      const evidence = cleanText(raw.evidence_in_text, 60)
      if (!evidenceInBody(body, evidence)) {
        dropped.push({ kind: 'new-character', reason: 'evidence-not-found', ref: name })
        continue
      }
      const identity = cleanText(raw.identity, 200)
      cardWrites.push({
        role: 'character', fields: { name, ...(identity === undefined ? {} : { identity }) }, auto: false,
        note: { extractedBy: 'llm', evidenceInText: evidence!, firstChapter: chapter.n },
        comment: `第${chapter.n}章登场：「${evidence}」`, ref: name,
      })
    }

    // Experiences + current states: roster-checked, evidence-gated, high lands / medium-low pends.
    // Automatic experience lines carry an id (the retract gesture's handle) and the 自动·可撤销 mark.
    const experienceLines: Record<string, unknown>[] = []
    let experienceNext = nextExperienceNumber(await this.listExperiences({ workId: id }))
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

    // Gate 5: plan verification against what the chapter actually touched.
    for (const op of chapter.plan?.foreshadowOps ?? []) {
      const wanted = OP_TO_MENTION[op.op]
      const opId = op.id === undefined ? undefined : asForeshadow(op.id)
      const touched = opId === undefined ? [] : recordedMentions.filter(mention => mention.id === opId)
      const exact = touched.some(mention => mention.kind === wanted)
      const anyTouch = touched.length > 0 || (op.op === '新埋' && newForeshadows > 0)
      if (exact || anyTouch) {
        report.verified += 1
      } else {
        report.missed += 1
        const label = opId !== undefined
          ? ` [${foreshadowOf.get(opId)?.ref ?? opId}]`
          : op.id !== undefined ? ` [${op.id}]` : op.question === undefined ? '' : ` [${op.question}]`
        pend({
          kind: 'plan-missed', confidence: 'medium', chapter: chapter.n,
          reason: `计划落空：${op.op}${label} —— 忘了还是改主意？`,
          payload: { op: op.op, ...(op.id === undefined ? {} : { id: opId ?? op.id }), ...(op.question === undefined ? {} : { question: op.question }) },
        })
      }
    }

    // The writes. Cards first (through the canvas), then the sidecar, the journals, the chapter, the queue.
    const notes = new Map<string, CardNote>()
    const proposedCards: { cardId: string; role: EntryRole; text: string }[] = []
    let board = entries.board
    for (const write of cardWrites) {
      const category = categoryOf(board, write.role)
      const mutation = category === undefined
        ? undefined
        : write.auto
          ? await canvas.putCard({ canvasId: id, kind: category, text: '', fields: write.fields, source }, session)
          : await canvas.proposeCard({ canvasId: id, kind: category, text: '', fields: write.fields, source, ...(write.comment === undefined ? {} : { comment: write.comment }) }, session)
      if (mutation === undefined || !mutation.ok) {
        dropped.push({ kind: write.role, reason: 'card-refused', ref: write.ref })
        continue
      }
      board = mutation.board
      const cardId = board.cards[board.cards.length - 1]!.id
      notes.set(cardId, write.note)
      if (write.auto) report.autoImported += 1
      else proposedCards.push({ cardId, role: write.role, text: String(write.fields[MAIN_FIELD[write.role]]) })
    }
    for (const [foreshadowId, mark] of touch) {
      const card = board.cards.find(candidate => candidate.id === foreshadowId)
      if (card === undefined) continue
      const fields: Record<string, NovelFieldValue> = { ...card.fields, status: MENTION_TO_STATE[mark.kind] }
      if (mark.kind === 'planted' && cleanNumber(card.fields?.['plantedAt']) === undefined) fields['plantedAt'] = chapter.n
      if (mark.kind === 'resolved' && mark.answer !== undefined) fields['answer'] = mark.answer
      const mutation = await canvas.patchCard({ canvasId: id, cardId: foreshadowId, fields }, session)
      if (!mutation.ok) return { ok: false, error: canvasErrorOf(mutation.error), ...empty, dropped }
      board = mutation.board
    }
    for (const [characterId, currentState] of stateUpdates) notes.set(characterId, { currentState })
    const annotated = await this.ensureRefs(id, session, board, notes)
    if (!annotated.ok) return { ok: false, error: annotated.error ?? 'io', ...empty, dropped }
    const appendedMentions = await this.appendJsonl(await this.fileTarget(id, WORK_FILES.mentions), session, journalLines)
    if (!appendedMentions.ok) return { ok: false, error: appendedMentions.error ?? 'io', ...empty, dropped }
    const appendedExperiences = await this.appendJsonl(await this.fileTarget(id, WORK_FILES.experiences), session, experienceLines)
    if (!appendedExperiences.ok) return { ok: false, error: appendedExperiences.error ?? 'io', ...empty, dropped }
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
    return { ok: true, ...report, dropped, pendingItems, proposedCards }
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
    if (item.kind === 'mention') {
      const canvas = this.canvas
      const foreshadowId = item.payload.foreshadowId
      const kind = item.payload.kind
      if (foreshadowId === undefined || (kind !== 'planted' && kind !== 'advanced' && kind !== 'hinted' && kind !== 'resolved')) return 'invalid-name'
      const board = await this.readNovelBoard(workId)
      const card = board?.cards.find(candidate => candidate.id === foreshadowId)
      if (canvas === undefined || card === undefined) return 'missing'
      const appended = await this.appendJsonl(await this.fileTarget(workId, WORK_FILES.mentions), session, [{
        foreshadowId,
        chapter: item.chapter ?? 0,
        kind,
        planned: false,
        reconciled: true,
        ...(item.payload.note === undefined ? {} : { note: item.payload.note }),
        createdAt: now,
      }])
      if (!appended.ok) return appended.error
      const fields: Record<string, NovelFieldValue> = { ...card.fields, status: MENTION_TO_STATE[kind] }
      if (kind === 'planted' && item.chapter !== undefined && cleanNumber(card.fields?.['plantedAt']) === undefined) fields['plantedAt'] = item.chapter
      if (kind === 'resolved' && item.payload.answer !== undefined) fields['answer'] = item.payload.answer
      const mutation = await canvas.patchCard({ canvasId: workId, cardId: foreshadowId, fields }, session)
      return mutation.ok ? undefined : canvasErrorOf(mutation.error)
    }
    if (item.kind === 'experience') {
      const { characterId, entry } = item.payload
      if (characterId === undefined || entry === undefined) return 'invalid-name'
      const appended = await this.appendJsonl(await this.fileTarget(workId, WORK_FILES.experiences), session, [{
        id: `e${nextExperienceNumber(await this.listExperiences({ workId }))}`,
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
  return [...views].sort((a, b) => (b.slept ?? 0) - (a.slept ?? 0))
}

/** The next free `e<n>` over an experience journal. */
function nextExperienceNumber(entries: readonly ExperienceEntry[]): number {
  return entries.reduce((max, row) => {
    const match = /^e(\d+)$/.exec(row.id ?? '')
    return match === null ? max : Math.max(max, Number(match[1]))
  }, 0) + 1
}

/**
 * Build the role views off one board read (pure: the store reads, this
 * derives).
 * @param board - the novel board.
 * @param annotations - the sidecar.
 * @param mentions - the mention journal.
 * @param chapters - the chapter index.
 * @returns the work's entries.
 */
export function entriesOf(
  board: NovelBoardView,
  annotations: Annotations,
  mentions: readonly MentionEntry[],
  chapters: readonly ChapterRecord[],
): WorkEntries {
  const roleOf = rolesOn(board)
  const currentChapter = chapters.reduce((max, chapter) => Math.max(max, chapter.n), 0)
  const lastActive = new Map<string, number>()
  for (const mention of mentions) lastActive.set(mention.foreshadowId, Math.max(lastActive.get(mention.foreshadowId) ?? 0, mention.chapter))
  const rules: RuleView[] = []
  const foreshadows: ForeshadowView[] = []
  const characters: CharacterView[] = []
  for (const card of board.cards) {
    const role = roleOf.get(card.id)
    if (role === undefined) continue
    const n = annotations.refs[card.id]
    const ref = n === undefined ? card.id : refOf(role, n)
    const note = annotations.notes[card.id]
    if (role === 'world' || role === 'principle') {
      rules.push({ cardId: card.id, ref, role, text: mainTextOf(card, role), status: card.status, autoImported: note?.autoImported === true })
    } else if (role === 'foreshadow') {
      const plantedAt = cleanNumber(card.fields?.['plantedAt'])
      const active = lastActive.get(card.id)
      const answer = fieldText(card, 'answer', 500)
      const base = active ?? plantedAt
      foreshadows.push({
        cardId: card.id,
        ref,
        question: mainTextOf(card, role),
        state: foreshadowStateOf(card.fields?.['status']),
        cardStatus: card.status,
        ...(plantedAt === undefined ? {} : { plantedAt }),
        ...(answer === undefined ? {} : { answer }),
        ...(note?.tension === undefined ? {} : { tension: note.tension }),
        ...(active === undefined ? {} : { lastActiveChapter: active }),
        ...(base === undefined ? {} : { slept: Math.max(0, currentChapter - base) }),
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
        relations: linesOf(card.fields?.['relations']),
        ...(note?.currentState === undefined ? {} : { currentState: note.currentState }),
        cardStatus: card.status,
      })
    }
  }
  return { board, annotations, roleOf, rules, foreshadows, characters, currentChapter }
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

export default NovelService
