/**
 * The canvas-novel's data vocabulary. The board's cards are the single source
 * of truth for what gets injected into writing — characters, world rules,
 * principles, foreshadows are canvas cards in the genre's role categories.
 * The engine keeps, under the canvas id's directory, only what is not the
 * user's to type: `annotations.json` (the sidecar — per-work display refs and
 * the audit notes, keyed by card id), `chapters.json`, `pending.json`, and the
 * two append-only journals (`experiences.jsonl`, `mentions.jsonl`, keyed by
 * card id). Every read applies a tolerant normalizer — a hand-edited or older
 * file reads as the closest valid document, and a document too broken to
 * read is refused by the store rather than rewritten blind (the canvas store
 * rule).
 *
 * Refs: world rules and principles render `w<n>`, foreshadows `#<n>`
 * (one numbering space), characters `c<n>` (their own); pending items are
 * `p<n>`, experiences `e<n>`. All are allocated per work as max+1. Chapter
 * files are named by the store alone: `第{n}章.md`.
 *
 * @module @khorsheed/dsh-canvas-novel
 */

import type { NovelCardStatus } from './genre.ts'

/* ------------------------------------------------------------------ works */

/**
 * One work = one canvas whose genre is `novel` (the 2026-10-04 decision). The
 * work's identity, title and workspace are the canvas's own — the engine
 * keeps no registry of its own and derives this view per call.
 */
export interface WorkMeta {
  /** The canvas id (also the engine's per-work state directory name). */
  readonly id: string
  /** The canvas title (the chapter files' folder under the workspace). */
  readonly title: string
  /** The canvas's first attached workspace, or undefined when none is attached yet. */
  readonly workspace: string | undefined
}

/** The novel genre's id on the canvas. */
export const NOVEL_GENRE_ID = 'novel'

/** A canvas id from untrusted input (the canvas's own id rule), or undefined. */
export function normalizeWorkId(id: unknown): string | undefined {
  return typeof id === 'string' && /^canvas_[a-z0-9]{8,40}$/.test(id) ? id : undefined
}

/* ------------------------------------------------------------ primitives */

/** One pick from a closed vocabulary, or undefined (the tolerant-read primitive). */
function pick<T>(raw: unknown, values: readonly T[]): T | undefined {
  return values.includes(raw as T) ? (raw as T) : undefined
}

/** A trimmed string from untrusted input, or undefined when empty/mistyped. */
export function cleanText(raw: unknown, max = 2000): string | undefined {
  if (typeof raw !== 'string') return undefined
  const clean = raw.trim().slice(0, max)
  return clean.length === 0 ? undefined : clean
}

/** A non-negative finite number from untrusted input, or undefined. */
export function cleanNumber(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : undefined
}

/** A string list from untrusted input. */
function cleanStringList(raw: unknown, max = 20): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map(item => cleanText(item, 200)).filter((item): item is string => item !== undefined).slice(0, max)
}

/* ---------------------------------------------------------- card entries */

/**
 * The four roles whose cards feed the brief. Each is a category the genre
 * seeds, found on the board by its role (a renamed label keeps its role).
 */
export type EntryRole = 'character' | 'world' | 'principle' | 'foreshadow'

/** A foreshadow card's status field (the genre's select options, in lifecycle order). */
export type ForeshadowState = '未埋' | '已埋' | '推进中' | '已揭晓' | '已放弃'

export const FORESHADOW_STATES: readonly ForeshadowState[] = ['未埋', '已埋', '推进中', '已揭晓', '已放弃']

export type Confidence = 'high' | 'medium' | 'low'

/**
 * How many reconciled chapters a live foreshadow may go untouched before the
 * ledger flags it (超期): a starred one is the user's main line and is
 * flagged sooner. The one place the threshold lives — the store, the briefs,
 * the tool answers and the story log all read it through {@link isOverdue}.
 */
export const SLEEP_THRESHOLD = { starred: 4, normal: 6 } as const

/** Starred foreshadows past this count get a soft hint (星标太多就不算重点了). */
export const STAR_SOFT_LIMIT = 5

/** Whether a foreshadow has slept past its threshold. */
export function isOverdue(view: { readonly starred?: boolean; readonly slept?: number }): boolean {
  return (view.slept ?? 0) >= (view.starred === true ? SLEEP_THRESHOLD.starred : SLEEP_THRESHOLD.normal)
}

/** A character's where-and-now (当前态), refreshed by each 对账. */
export interface CurrentState {
  readonly where?: string
  readonly state?: string
  readonly concern?: string
}

/**
 * The engine's notes on one card: the audit trail of how it got there and
 * the derived state that is not the user's to type. None of it is a card
 * field — the card holds only what the user would write themselves.
 */
export interface CardNote {
  /** ≤60 characters quoted verbatim from the chapter (the import gate grepped for it). */
  readonly evidenceInText?: string
  /** Characters only: 当前态 as of the last 对账 (or the user's own edit). */
  readonly currentState?: CurrentState
  /** Foreshadows only: the user's star (主线重点 — planned first, never trimmed, flagged sooner). */
  readonly starred?: boolean
}

/**
 * `annotations.json`, the engine's sidecar to the board, keyed by card id:
 * the per-work display numbers (`refs`) and the notes. A card the sidecar
 * does not know yet simply has no number until the next write allocates one.
 */
export interface Annotations {
  readonly version: 1
  readonly refs: Record<string, number>
  readonly notes: Record<string, CardNote>
}

/** The two ref numbering spaces: characters (`c<n>`) and every other entry (`w<n>` / `#<n>`). */
export type RefGroup = 'character' | 'entry'

/** Which numbering space a role's cards draw from. */
export function refGroupOf(role: EntryRole): RefGroup {
  return role === 'character' ? 'character' : 'entry'
}

/** A card's display ref: world rules and principles `w12`, foreshadows `#12`, characters `c3`. */
export function refOf(role: EntryRole, n: number): string {
  if (role === 'character') return `c${n}`
  return role === 'foreshadow' ? `#${n}` : `w${n}`
}

/**
 * A ref from any spelling the model may send (`w12`, `#12`, `12`, `c3`), or
 * undefined. Only the shape is read here — whether a card holds that number
 * is the board's question.
 */
export function parseRef(raw: unknown): { readonly group: RefGroup; readonly n: number } | undefined {
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined
  const match = /^([wc#]?)(\d+)$/i.exec(String(raw).trim())
  if (match === null) return undefined
  return { group: match[1]!.toLowerCase() === 'c' ? 'character' : 'entry', n: Number(match[2]) }
}

/** Tolerant read of one card note. */
function normalizeNote(raw: unknown): CardNote | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  const out: { -readonly [K in keyof CardNote]?: CardNote[K] } = {}
  const evidenceInText = cleanText(record['evidenceInText'], 60)
  if (evidenceInText !== undefined) out.evidenceInText = evidenceInText
  if (record['starred'] === true) out.starred = true
  if (typeof record['currentState'] === 'object' && record['currentState'] !== null) {
    const state = record['currentState'] as Record<string, unknown>
    const where = cleanText(state['where'], 200)
    const now = cleanText(state['state'], 200)
    const concern = cleanText(state['concern'], 200)
    out.currentState = {
      ...(where === undefined ? {} : { where }),
      ...(now === undefined ? {} : { state: now }),
      ...(concern === undefined ? {} : { concern }),
    }
  }
  return Object.keys(out).length === 0 ? undefined : out
}

/** Tolerant read of the sidecar; undefined when the file is not one. */
export function normalizeAnnotations(raw: unknown): Annotations | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  const refsRaw = record['refs']
  const notesRaw = record['notes']
  if (typeof refsRaw !== 'object' || refsRaw === null || typeof notesRaw !== 'object' || notesRaw === null) return undefined
  const refs: Record<string, number> = {}
  for (const [cardId, n] of Object.entries(refsRaw as Record<string, unknown>)) {
    const clean = cleanNumber(n)
    if (clean !== undefined && Number.isInteger(clean) && clean > 0) refs[cardId] = clean
  }
  const notes: Record<string, CardNote> = {}
  for (const [cardId, note] of Object.entries(notesRaw as Record<string, unknown>)) {
    const clean = normalizeNote(note)
    if (clean !== undefined) notes[cardId] = clean
  }
  return { version: 1, refs, notes }
}

/* ---------------------------------------------------------- experiences */

/** One line of `experiences.jsonl`: what this character did and how their state moved in one chapter. */
export interface ExperienceEntry {
  /** The character's card id. */
  readonly characterId: string
  readonly chapter: number
  readonly entry: string
  readonly createdAt: string
}

/* -------------------------------------------------------------- chapters */

/**
 * The stored half of a chapter's phase (proposal §2: 阶段从事实派生). 写作中
 * is NOT stored — it derives from the manuscript file existing with content;
 * the store only records 规划中 → 已抽取（对账完成）→ 已审过（用户的人工闸门，
 * 永远最后：收章）.
 */
export type ChapterPhase = 'planning' | 'reviewed' | 'extracted'

/** The phase the UI shows, given whether the manuscript has content. `fileMissing`: a chapter past planning whose manuscript file is gone (存量坏数据的温和迁移面). */
export type EffectiveChapterPhase = 'planning' | 'writing' | 'extracted' | 'reviewed' | 'fileMissing'

/** One planned foreshadow operation (推进/暗示/新埋/揭晓), referencing the ledger by id, or a question for 新埋. */
export interface ForeshadowOp {
  readonly op: '推进' | '暗示' | '新埋' | '揭晓'
  /** The foreshadow card id (or its ref — `#12`, `12`; writeChapter stores the card id when it resolves). */
  readonly id?: string
  /** 新埋 only: the question being planted. */
  readonly question?: string
  /** What this op moves: the clue it adds, the step it advances, what the plant looks like on the page. */
  readonly note?: string
}

/** One step of the chapter's 走向: when it happens, what happens, and whether it turns or lands the chapter. */
export interface PlanBeat {
  /** The time label the reader orients by (`午后`, `第二天`). */
  readonly at?: string
  readonly text: string
  readonly mark?: '转折' | '落点'
}

/** One character on stage: who (a character ref, id or name) and what they do in this chapter. */
export interface PlanCast {
  readonly who: string
  readonly role?: string
}

/**
 * The chapter plan: 梗概 / 走向 / 冲突 / 看点 / 伏笔 / 出场 / 章末钩子. It is
 * the reader's decision aid, so every row says what happens, not where it is
 * filed; the person changes it by talking, never by ticking items.
 */
export interface ChapterPlan {
  /** 梗概: the chapter in two or three sentences. */
  readonly summary: string
  /** 走向: the beats, in order. */
  readonly beats: readonly PlanBeat[]
  /** 冲突: what stands against whom. */
  readonly conflict?: string
  /** 看点: what the reader comes away with. */
  readonly highlight?: string
  readonly foreshadowOps: readonly ForeshadowOp[]
  readonly cast: readonly PlanCast[]
  /** The POV character (one of the cast). */
  readonly pov?: string
  readonly hook?: string
}

/**
 * What the extract import found of the plan in the manuscript, index for
 * index: a beat or an op the text carried is true. A missed op is also a
 * pending 计划落空 item; a missed beat is a reminder only.
 */
export interface PlanDelivery {
  readonly beats: readonly boolean[]
  readonly ops: readonly boolean[]
}

/** One row of `chapters.json`: n is the continuous number (max+1 on create), seq the sort key that allows inserts. */
export interface ChapterRecord {
  readonly n: number
  readonly seq: number
  readonly title: string
  /** Store-generated file name, `第{n}章.md` — free-form names are never stored. */
  readonly file: string
  readonly phase: ChapterPhase
  readonly plan?: ChapterPlan
  /** The user's ✓确认计划 timestamp (the plan gate's durable fact; absent = unconfirmed). */
  readonly planConfirmedAt?: string
  /**
   * 用户原稿: the user wrote this chapter themselves (imported or pasted). It
   * needs no plan to carry a body, and the 对账 skips plan verification.
   */
  readonly byUser?: true
  /** How much of the plan the manuscript carried, written by the extract import. */
  readonly delivery?: PlanDelivery
  /** 2-3 sentence summary, written by the extract import. */
  readonly recap?: string
  readonly wordCount?: number
  readonly sessionIds: readonly string[]
  readonly createdAt: string
  readonly updatedAt: string
}

/** `chapters.json` as one document. */
export interface ChapterTable {
  readonly version: 1
  readonly chapters: ChapterRecord[]
}

/** The manuscript file name a chapter number owns — the ONLY naming rule (proposal §2). */
export function chapterFileName(n: number): string {
  return `第${n}章.md`
}

/** The chapter number behind a store-generated file name, or undefined for a foreign name. */
export function chapterNumberOfFile(file: string): number | undefined {
  const match = /^第(\d+)章\.md$/.exec(file)
  return match === null ? undefined : Number(match[1])
}

/** The stored phase plus the manuscript fact → the phase the UI shows (规划中→写作中→已抽取→已审过; 审过是人工闸门，永远最后). */
export function effectiveChapterPhase(chapter: ChapterRecord, hasBody: boolean): EffectiveChapterPhase {
  // A chapter past planning whose manuscript is gone reads 文件丢失, not its
  // stored phase (the gentle migration for pre-F1-2 rows).
  if (chapter.phase !== 'planning' && !hasBody) return 'fileMissing'
  if (chapter.phase === 'planning' && hasBody) return 'writing'
  return chapter.phase
}

/** One line of `mentions.jsonl`: a foreshadow touch the text carried in one chapter. */
export interface MentionEntry {
  readonly foreshadowId: string
  readonly chapter: number
  readonly kind: 'planted' | 'advanced' | 'hinted' | 'resolved'
  /** The chapter plan listed this operation. */
  readonly planned: boolean
  readonly note?: string
  readonly createdAt: string
}

const FORESHADOW_OPS: readonly ForeshadowOp['op'][] = ['推进', '暗示', '新埋', '揭晓']
const BEAT_MARKS: readonly NonNullable<PlanBeat['mark']>[] = ['转折', '落点']

/** The object rows of a list field; anything else is skipped. */
function rowsOf(raw: unknown, max: number): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null).slice(0, max)
}

/** Tolerant read of one chapter plan; undefined when no 梗概 is there to plan around. */
export function normalizePlan(raw: unknown): ChapterPlan | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  const summary = cleanText(record['summary'], 400)
  if (summary === undefined) return undefined
  const pov = cleanText(record['pov'], 80)
  const conflict = cleanText(record['conflict'], 300)
  const highlight = cleanText(record['highlight'], 300)
  const hook = cleanText(record['hook'], 300)
  const beats = rowsOf(record['beats'], 12).map((row): PlanBeat | undefined => {
    const text = cleanText(row['text'], 200)
    if (text === undefined) return undefined
    const at = cleanText(row['at'], 20)
    const mark = pick(row['mark'], BEAT_MARKS)
    return { text, ...(at === undefined ? {} : { at }), ...(mark === undefined ? {} : { mark }) }
  }).filter((beat): beat is PlanBeat => beat !== undefined)
  const foreshadowOps = rowsOf(record['foreshadowOps'], 12).map((row): ForeshadowOp | undefined => {
    const verb = pick(row['op'], FORESHADOW_OPS)
    if (verb === undefined) return undefined
    const id = cleanText(row['id'], 40)
    const question = cleanText(row['question'], 200)
    const note = cleanText(row['note'], 200)
    return {
      op: verb,
      ...(id === undefined ? {} : { id }),
      ...(question === undefined ? {} : { question }),
      ...(note === undefined ? {} : { note }),
    }
  }).filter((op): op is ForeshadowOp => op !== undefined)
  const cast = rowsOf(record['cast'], 12).map((row): PlanCast | undefined => {
    const who = cleanText(row['who'], 80)
    if (who === undefined) return undefined
    const role = cleanText(row['role'], 120)
    return { who, ...(role === undefined ? {} : { role }) }
  }).filter((member): member is PlanCast => member !== undefined)
  return {
    summary,
    beats,
    ...(conflict === undefined ? {} : { conflict }),
    ...(highlight === undefined ? {} : { highlight }),
    foreshadowOps,
    cast,
    ...(pov === undefined ? {} : { pov }),
    ...(hook === undefined ? {} : { hook }),
  }
}

/** Tolerant read of a plan delivery: two boolean lists, or nothing. */
function normalizeDelivery(raw: unknown): PlanDelivery | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  const flags = (value: unknown): boolean[] => Array.isArray(value) ? value.map(flag => flag === true) : []
  return { beats: flags(record['beats']), ops: flags(record['ops']) }
}

/** Tolerant read of one chapter record; undefined when n/title/file cannot be trusted. */
export function normalizeChapter(raw: unknown): ChapterRecord | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  const n = cleanNumber(record['n'])
  const title = cleanText(record['title'], 200)
  const file = cleanText(record['file'], 200)
  if (n === undefined || title === undefined || file === undefined || chapterNumberOfFile(file) !== n) return undefined
  const now = new Date().toISOString()
  const plan = normalizePlan(record['plan'])
  const recap = cleanText(record['recap'], 500)
  const wordCount = cleanNumber(record['wordCount'])
  const planConfirmedAt = cleanText(record['planConfirmedAt'], 40)
  const delivery = normalizeDelivery(record['delivery'])
  return {
    n,
    seq: cleanNumber(record['seq']) ?? n,
    title,
    file,
    phase: record['phase'] === 'reviewed' || record['phase'] === 'extracted' ? record['phase'] : 'planning',
    ...(plan === undefined ? {} : { plan }),
    ...(planConfirmedAt === undefined ? {} : { planConfirmedAt }),
    ...(record['byUser'] === true ? { byUser: true as const } : {}),
    ...(delivery === undefined ? {} : { delivery }),
    ...(recap === undefined ? {} : { recap }),
    ...(wordCount === undefined ? {} : { wordCount }),
    sessionIds: cleanStringList(record['sessionIds'], 40),
    createdAt: cleanText(record['createdAt'], 40) ?? now,
    updatedAt: cleanText(record['updatedAt'], 40) ?? now,
  }
}

/* ---------------------------------------------------------------- views */

/** Split a multiline card field into its non-empty lines (一行一件). */
export function linesOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(line => line.length > 0)
  if (typeof value !== 'string') return []
  return value.split(/\r?\n/).map(line => line.replace(/^[-*·•]\s*/, '').trim()).filter(line => line.length > 0)
}

/** A world-rule or principle card, as the brief reads it. */
export interface RuleView {
  readonly cardId: string
  /** `w<n>`, or the card id before a number is allocated. */
  readonly ref: string
  readonly role: 'world' | 'principle'
  /** A world card's title (名称), when it has one. */
  readonly name?: string
  /** What the brief prints: `名称（类型）：设定` for a named world card, the body alone otherwise. */
  readonly text: string
  readonly status: NovelCardStatus
}

/** A foreshadow card plus what its mentions derive. */
export interface ForeshadowView {
  readonly cardId: string
  /** `#<n>`, or the card id before a number is allocated. */
  readonly ref: string
  readonly question: string
  readonly state: ForeshadowState
  readonly plantedAt?: number
  readonly answer?: string
  /** The user's star (the sidecar note). */
  readonly starred: boolean
  /** The newest chapter that touched it (max mention chapter). */
  readonly lastActiveChapter?: number
  /**
   * Reconciled chapters since its last touch (lastActive ?? plantedAt),
   * counted by seq position; undefined when neither is known.
   */
  readonly slept?: number
  readonly cardStatus: NovelCardStatus
}

/** A character card, its multiline fields split into lines, plus the sidecar's 当前态. */
export interface CharacterView {
  readonly cardId: string
  /** `c<n>`, or the card id before a number is allocated. */
  readonly ref: string
  readonly name: string
  readonly identity?: string
  readonly want?: string
  readonly lack?: string
  readonly wound?: string
  readonly appearance?: string
  readonly voice?: string
  readonly knows: readonly string[]
  readonly unaware: readonly string[]
  readonly secrets: readonly string[]
  readonly relations: readonly string[]
  readonly currentState?: CurrentState
  readonly cardStatus: NovelCardStatus
}

/** The mention kind a foreshadow op names (the journal's vocabulary). */
export const OP_TO_MENTION: Readonly<Record<ForeshadowOp['op'], MentionEntry['kind']>> = {
  推进: 'advanced',
  暗示: 'hinted',
  新埋: 'planted',
  揭晓: 'resolved',
}

/** The foreshadow state a reconciled mention moves the card to. */
export const MENTION_TO_STATE: Readonly<Record<MentionEntry['kind'], ForeshadowState>> = {
  planted: '已埋',
  advanced: '推进中',
  hinted: '推进中',
  resolved: '已揭晓',
}

/** A foreshadow state from a card field (the cold default is 已埋: a card on the board is a planted question). */
export function foreshadowStateOf(raw: unknown): ForeshadowState {
  return pick(raw, FORESHADOW_STATES) ?? '已埋'
}

/* --------------------------------------------------------------- pending */

/**
 * What a pending item proposes. Proposed entries (a new rule, foreshadow or
 * character) are not pending items — they land as live cards on the board,
 * edited or archived there; the queue holds only the journal lines that wait for a
 * person.
 */
export type PendingKind = 'mention' | 'experience' | 'plan-missed'

const PENDING_KINDS: readonly PendingKind[] = ['mention', 'experience', 'plan-missed']

/**
 * A pending item's proposed record, flattened to JSON-safe scalars (the wire
 * carries it, so no nested unknowns). Which keys matter follows `kind`.
 */
export interface PendingPayload {
  /** mention: the foreshadow card id. */
  readonly foreshadowId?: string
  /** mention: planted / advanced / hinted / resolved. */
  readonly kind?: string
  readonly note?: string
  /** mention (resolved): the answer the text gave. */
  readonly answer?: string
  /** experience: the character card id. */
  readonly characterId?: string
  readonly entry?: string
  /** plan-missed: the planned op, and the foreshadow card id or 新埋 question. */
  readonly op?: string
  readonly id?: string
  readonly question?: string
}

/** One row of `pending.json` (the review queue's snapshot — a derived cache that can be rebuilt). */
export interface PendingItem {
  readonly id: string
  readonly kind: PendingKind
  /** A doubtful finding's confidence (mention/experience); absent on the kinds that are questions, not guesses. */
  readonly confidence?: 'medium' | 'low'
  readonly chapter?: number
  /** One line on why this waits for a person (疑似提及 / 计划落空…). */
  readonly reason: string
  readonly evidenceInText?: string
  /** The proposed record, shaped per kind (mention, experience, plan op). */
  readonly payload: PendingPayload
  readonly status: 'pending' | 'accepted' | 'discarded'
  readonly createdAt: string
  readonly resolvedAt?: string
}

/** `pending.json` as one document. */
export interface PendingTable {
  readonly version: 1
  readonly items: PendingItem[]
}

/** Tolerant read of one pending payload: only the known scalar keys survive. */
function normalizePendingPayload(raw: unknown): PendingPayload {
  if (typeof raw !== 'object' || raw === null) return {}
  const record = raw as Record<string, unknown>
  const out: { -readonly [K in keyof PendingPayload]?: PendingPayload[K] } = {}
  for (const key of ['foreshadowId', 'kind', 'note', 'answer', 'question', 'characterId', 'entry', 'op', 'id'] as const) {
    const value = cleanText(record[key], 500)
    if (value !== undefined) out[key] = value
  }
  return out
}

/** Tolerant read of one pending item; undefined when id/kind/reason cannot be trusted. */
export function normalizePendingItem(raw: unknown): PendingItem | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  const id = cleanText(record['id'], 40)
  const kind = pick(record['kind'], PENDING_KINDS)
  const reason = cleanText(record['reason'], 300)
  if (id === undefined || kind === undefined || reason === undefined) return undefined
  const now = new Date().toISOString()
  const chapter = cleanNumber(record['chapter'])
  const evidenceInText = cleanText(record['evidenceInText'], 60)
  const resolvedAt = cleanText(record['resolvedAt'], 40)
  const confidence = pick(record['confidence'], ['medium', 'low'] as const)
  return {
    id,
    kind,
    ...(confidence === undefined ? {} : { confidence }),
    ...(chapter === undefined ? {} : { chapter }),
    reason,
    ...(evidenceInText === undefined ? {} : { evidenceInText }),
    payload: normalizePendingPayload(record['payload']),
    status: record['status'] === 'accepted' || record['status'] === 'discarded' ? record['status'] : 'pending',
    createdAt: cleanText(record['createdAt'], 40) ?? now,
    ...(resolvedAt === undefined ? {} : { resolvedAt }),
  }
}

/* --------------------------------------------------------------- outcomes */

/** The store's failure codes (the canvas vocabulary, plus the chapter gates'). */
export type NovelError = 'invalid-name' | 'missing' | 'io' | 'stale' | 'denied' | 'not-reviewed' | 'not-extracted' | 'no-workspace' | 'duplicate' | 'plan-unconfirmed'

/* ---------------------------------------------- wire-boundary contracts */

/** The review verb's actions: a pending item is accepted or discarded, a card is archived. */
export type ReviewAction = 'accept' | 'discard' | 'archive'

/** A chapter create (no n) or plan/title update (n present). */
export interface WriteChapterRequest {
  readonly workId: string
  readonly n?: number
  readonly title: string
  readonly plan?: unknown
  /** Insert position (defaults to n — 插章 gives an explicit seq, proposal §2). */
  readonly seq?: number
  /**
   * The manuscript body: given, the store writes it to `<workspace>/<title>/第{n}章.md`
   * through the calling session's fence (boundary re-rooted at the work's mounted
   * workspace) BEFORE registering — a write that fails refuses the registration,
   * so a chapter never registers onto an empty slot (the F1-2 rule).
   */
  readonly content?: string
  /**
   * 用户原稿: the body (or the file already in the workspace) is the user's own
   * text. Without it a body lands only on a chapter whose plan the user
   * confirmed (计划门禁, `plan-unconfirmed`).
   */
  readonly byUser?: boolean
}

/** The subagent's world-rule row (strict JSON, tolerant reads): 世界 by default, 原则 for a writing principle. */
export interface ExtractMemoryInput {
  readonly kind?: string
  /** 世界 only: the setting's title — a place, an item, a rule's name. */
  readonly name?: string
  /** 世界 only: 地点|势力|道具|规则|历史|其他. */
  readonly world_kind?: string
  readonly content?: string
  readonly evidence_in_text?: string
}

/** The subagent's foreshadow-mention row. */
export interface ExtractMentionInput {
  readonly foreshadow_id?: string | number
  readonly kind?: string
  readonly answer?: string
  readonly note?: string
  readonly confidence?: string
  readonly evidence_in_text?: string
}

/** The subagent's new-foreshadow row. */
export interface ExtractNewForeshadowInput {
  readonly question?: string
  readonly evidence_in_text?: string
}

/** The subagent's new-character row. */
export interface ExtractNewCharacterInput {
  readonly name?: string
  readonly identity?: string
  readonly evidence_in_text?: string
}

/** The subagent's experience row. */
export interface ExtractExperienceInput {
  readonly character_id?: string
  readonly entry?: string
  readonly confidence?: string
  readonly evidence_in_text?: string
}

/** The subagent's current-state row. */
export interface ExtractCurrentStateInput {
  readonly character_id?: string
  readonly where?: string
  readonly state?: string
  readonly concern?: string
  readonly confidence?: string
}

/** The subagent's row for one plan beat the manuscript carried. */
export interface ExtractBeatInput {
  /** 1-based, as the pack numbers the 走向. */
  readonly beat?: number
  readonly evidence_in_text?: string
}

/** The subagent's strict JSON, as `novel_extract` import receives it (tolerant reads throughout). */
export interface ExtractPayload {
  readonly beats_delivered?: readonly ExtractBeatInput[]
  readonly memories?: readonly ExtractMemoryInput[]
  readonly foreshadow_mentions?: readonly ExtractMentionInput[]
  readonly new_foreshadows?: readonly ExtractNewForeshadowInput[]
  readonly new_characters?: readonly ExtractNewCharacterInput[]
  readonly experiences?: readonly ExtractExperienceInput[]
  readonly current_states?: readonly ExtractCurrentStateInput[]
  readonly recap?: string
}

/** One dropped import item and why (the anti-fabrication log). */
export interface ImportDrop {
  readonly kind: string
  readonly reason: 'evidence-not-found' | 'id-not-in-ledger' | 'character-not-in-roster' | 'card-refused' | 'duplicate'
  readonly ref: string
}

/** The import's reconciliation report (the model's 汇报格式 rides on these numbers). */
export interface ImportReport {
  readonly ok: boolean
  readonly error?: NovelError
  readonly verified: number
  readonly missed: number
  /** Plan beats the manuscript carried, and the beats it did not (a reminder, never pending). */
  readonly beats: { readonly delivered: number; readonly missed: number }
  readonly pending: number
  readonly dropped: readonly ImportDrop[]
  readonly pendingItems: readonly { readonly id: string; readonly kind: PendingKind; readonly reason: string }[]
  /** The live cards this import landed (new rules, foreshadows, characters), marked new (✦) on the board. */
  readonly newCards: readonly { readonly cardId: string; readonly role: EntryRole; readonly text: string; readonly ref?: string }[]
}

/** The ledger answer (伏笔沉睡榜 + 健康度) — kept foreshadow cards only. */
export interface LedgerResult {
  readonly ok: boolean
  readonly error?: NovelError
  readonly active: readonly ForeshadowView[]
  readonly resolved: readonly ForeshadowView[]
  readonly counts: { readonly active: number; readonly overdue: number; readonly resolved: number; readonly abandoned: number }
  /** The newest chapter number — the sleeping baseline. */
  readonly currentChapter: number
}

/** One chapter row for the wire: the record plus its effective (derived) phase. */
export interface ChapterRow {
  readonly chapter: ChapterRecord
  readonly phase: EffectiveChapterPhase
}

/* ------------------------------------------------------------------ wire */

/** One canvas (= one work). */
export interface NovelWorkRequest {
  readonly canvasId: string
}

/** One chapter of a work. */
export interface NovelChapterRequest extends NovelWorkRequest {
  readonly n: number
}

/** The person's answer to one pending item. */
export interface NovelDecideRequest extends NovelWorkRequest {
  readonly id: string
  readonly action: 'accept' | 'discard'
}

/** A pending item as the board's strip shows it: the queue row plus what it is about. */
export interface PendingView extends PendingItem {
  /** The card it concerns, as the reader knows it (`#5 时间兑换率？`, `艾文`); absent when the card is gone. */
  readonly subject?: string
  /** That card's id, so the strip can open it. */
  readonly subjectCardId?: string
}

/** The pending strip's read. */
export interface NovelPendingResult {
  readonly ok: boolean
  readonly error?: NovelError
  readonly items: readonly PendingView[]
}

/** One touch on a foreshadow's chapter track. */
export interface LedgerMark {
  readonly chapter: number
  readonly kind: MentionEntry['kind']
  /** Listed by the chapter plan. */
  readonly planned: boolean
}

/** The ledger page's read: the ledger plus every foreshadow's track, keyed by card id. */
export interface NovelLedgerResult extends LedgerResult {
  readonly marks: Readonly<Record<string, readonly LedgerMark[]>>
}

/** The chapter index as the pages read it: the rows plus each chapter's unresolved pending count. */
export interface NovelChaptersResult {
  readonly ok: boolean
  readonly error?: NovelError
  readonly chapters: readonly ChapterRow[]
  /** Unresolved pending items per chapter number. */
  readonly pending: Readonly<Record<number, number>>
}

/** One chapter as the reader page shows it. */
export interface NovelChapterResult {
  readonly ok: boolean
  readonly error?: NovelError
  readonly chapter?: ChapterRecord
  readonly phase?: EffectiveChapterPhase
  readonly body?: string
  /** This chapter's unresolved pending items (the ✓ 审过 gate waits on them). */
  readonly pending: number
  /** Display names of the card ids the plan names (characters, foreshadows). */
  readonly names: Readonly<Record<string, string>>
  /** The manuscript's workspace-relative path (`<title>/第n章.md`). */
  readonly file?: string
}

/** A gesture's receipt on the wire. */
export interface NovelGestureResult {
  readonly ok: boolean
  readonly error?: NovelError
}
