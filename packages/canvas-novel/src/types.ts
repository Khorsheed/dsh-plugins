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
 * The roles whose cards feed the brief. Each is a category the genre seeds,
 * found on the board by its role (a renamed label keeps its role).
 */
export type EntryRole = 'character' | 'world' | 'principle' | 'foreshadow' | 'relation'

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
  /**
   * Characters, world cards and relations: the plot fields as the engine
   * last saw them ({@link plotOf}) — what the next sync diffs the board
   * against to write the card's change history.
   */
  readonly plot?: Readonly<Record<string, string>>
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
  /**
   * When the change history started (the first sync that snapshotted the
   * board). Before it, every card's state is taken as given, never logged.
   */
  readonly historySince?: string
}

/** The ref numbering spaces: characters (`c<n>`), relations (`r<n>`) and every other entry (`w<n>` / `#<n>`). */
export type RefGroup = 'character' | 'relation' | 'entry'

/** Which numbering space a role's cards draw from. */
export function refGroupOf(role: EntryRole): RefGroup {
  return role === 'character' || role === 'relation' ? role : 'entry'
}

/** A card's display ref: world rules and principles `w12`, foreshadows `#12`, characters `c3`, relations `r2`. */
export function refOf(role: EntryRole, n: number): string {
  if (role === 'character') return `c${n}`
  if (role === 'relation') return `r${n}`
  return role === 'foreshadow' ? `#${n}` : `w${n}`
}

/**
 * A ref from any spelling the model may send (`w12`, `#12`, `12`, `c3`, `r2`), or
 * undefined. Only the shape is read here — whether a card holds that number
 * is the board's question.
 */
export function parseRef(raw: unknown): { readonly group: RefGroup; readonly n: number } | undefined {
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined
  const match = /^([wcr#]?)(\d+)$/i.exec(String(raw).trim())
  if (match === null) return undefined
  const prefix = match[1]!.toLowerCase()
  return { group: prefix === 'c' ? 'character' : prefix === 'r' ? 'relation' : 'entry', n: Number(match[2]) }
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
  if (typeof record['plot'] === 'object' && record['plot'] !== null) {
    const plot: Record<string, string> = {}
    for (const [field, value] of Object.entries(record['plot'] as Record<string, unknown>)) {
      if (typeof value === 'string') plot[field] = value
    }
    out.plot = plot
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
  const historySince = cleanText(record['historySince'], 40)
  return { version: 1, refs, notes, ...(historySince === undefined ? {} : { historySince }) }
}

/* -------------------------------------------------------------- history */

/**
 * Who changed a card: 采纳 (the person adopted a pending finding), 模型整理
 * (the model wrote it — a chat write or the import), 你改的 (the person
 * edited the card on the canvas, or 此刻 on its page).
 */
export type HistorySource = 'accept' | 'model' | 'user'

/** One field's move: a line added or removed (the list fields), or a value replaced. */
export interface HistoryChange {
  readonly field: string
  readonly op: '+' | '−' | '→'
  readonly value: string
  /** `→` only: the value before. */
  readonly from?: string
}

/** One line of `history.jsonl`: one card's plot fields moving in one write, at one chapter. */
export interface HistoryEntry {
  readonly cardId: string
  readonly chapter: number
  readonly source: HistorySource
  /** create: the card's first state (its non-empty fields as `+`); change: a diff. */
  readonly kind: 'create' | 'change'
  readonly changes: readonly HistoryChange[]
  /** The chapter's words that justified it (adopted and imported changes). */
  readonly evidence?: string
  readonly createdAt: string
}

/**
 * The plot fields per role — what the story is about, not the card's
 * bookkeeping (a name, a pair, a 现在 line the model rewrites every
 * chapter). `now` is the character's 此刻, kept in the sidecar, not a field.
 */
export const PLOT_FIELDS: Readonly<Partial<Record<EntryRole, readonly string[]>>> = {
  character: ['identity', 'want', 'lack', 'wound', 'appearance', 'voice', 'knows', 'unaware', 'secrets', 'now'],
  world: ['kind', 'rule'],
  relation: ['type', 'stage'],
}

/** The plot fields read line by line (一行一件): their history is lines added and removed. */
const LIST_FIELDS = new Set(['knows', 'unaware', 'secrets'])

/** 此刻 as one line: where · state · concern. */
export function currentStateLine(state: CurrentState | undefined): string {
  return [state?.where, state?.state, state?.concern].filter(part => part !== undefined && part !== '').join(' · ')
}

/**
 * A card's plot fields as text, for the snapshot: list fields one line per
 * item, the rest trimmed; empty fields absent.
 */
export function plotOf(role: EntryRole, fields: Readonly<Record<string, unknown>> | undefined, state?: CurrentState): Record<string, string> {
  const out: Record<string, string> = {}
  for (const field of PLOT_FIELDS[role] ?? []) {
    const value = field === 'now' ? currentStateLine(state)
      : LIST_FIELDS.has(field) ? linesOf(fields?.[field]).join('\n')
        : typeof fields?.[field] === 'string' || typeof fields?.[field] === 'number' ? String(fields[field]).trim() : ''
    if (value !== '') out[field] = value
  }
  return out
}

/** What moved between two snapshots of one card, in field order. */
export function plotDiff(role: EntryRole, before: Readonly<Record<string, string>>, after: Readonly<Record<string, string>>): HistoryChange[] {
  const changes: HistoryChange[] = []
  for (const field of PLOT_FIELDS[role] ?? []) {
    const was = before[field] ?? ''
    const is = after[field] ?? ''
    if (was === is) continue
    if (LIST_FIELDS.has(field)) {
      const wasLines = was === '' ? [] : was.split('\n')
      const isLines = is === '' ? [] : is.split('\n')
      for (const line of isLines) if (!wasLines.includes(line)) changes.push({ field, op: '+', value: line })
      for (const line of wasLines) if (!isLines.includes(line)) changes.push({ field, op: '−', value: line })
    } else if (was === '') {
      changes.push({ field, op: '+', value: is })
    } else if (is === '') {
      changes.push({ field, op: '−', value: was })
    } else {
      changes.push({ field, op: '→', value: is, from: was })
    }
  }
  return changes
}

const HISTORY_SOURCES = new Set<HistorySource>(['accept', 'model', 'user'])
const HISTORY_OPS = new Set(['+', '−', '→'])

/** Tolerant read of one `history.jsonl` line. */
export function normalizeHistoryEntry(raw: unknown): HistoryEntry | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  const cardId = cleanText(record['cardId'], 80)
  const chapter = cleanNumber(record['chapter'])
  const source = record['source'] as HistorySource
  const kind = record['kind'] === 'create' ? 'create' : record['kind'] === 'change' ? 'change' : undefined
  if (cardId === undefined || chapter === undefined || !HISTORY_SOURCES.has(source) || kind === undefined || !Array.isArray(record['changes'])) return undefined
  const changes: HistoryChange[] = []
  for (const item of record['changes'] as unknown[]) {
    if (typeof item !== 'object' || item === null) continue
    const change = item as Record<string, unknown>
    const field = cleanText(change['field'], 40)
    const value = typeof change['value'] === 'string' ? change['value'] : undefined
    if (field === undefined || value === undefined || !HISTORY_OPS.has(String(change['op']))) continue
    const from = typeof change['from'] === 'string' ? change['from'] : undefined
    changes.push({ field, op: change['op'] as HistoryChange['op'], value, ...(from === undefined ? {} : { from }) })
  }
  const evidence = cleanText(record['evidence'], 60)
  return { cardId, chapter, source, kind, changes, ...(evidence === undefined ? {} : { evidence }), createdAt: cleanText(record['createdAt'], 40) ?? '' }
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

/** 信息差: one character learns one fact in this chapter (what they did not know before). */
export interface PlanInfoGap {
  /** The character, by name. */
  readonly who: string
  /** What they learn, one line — matched against their 不知道 list on adoption. */
  readonly fact: string
}

/**
 * The chapter plan: 梗概 / 走向 / 冲突 / 看点 / 伏笔 / 出场 / 信息差 / 章末钩子. It is
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
  /** 信息差: who learns what this chapter (absent on plans that close none). */
  readonly infoGaps?: readonly PlanInfoGap[]
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
  const infoGaps = rowsOf(record['infoGaps'], 8).map((row): PlanInfoGap | undefined => {
    const who = cleanText(row['who'], 80)
    const fact = cleanText(row['fact'], 200)
    return who === undefined || fact === undefined ? undefined : { who, fact }
  }).filter((gap): gap is PlanInfoGap => gap !== undefined)
  return {
    summary,
    beats,
    ...(conflict === undefined ? {} : { conflict }),
    ...(highlight === undefined ? {} : { highlight }),
    foreshadowOps,
    cast,
    ...(infoGaps.length === 0 ? {} : { infoGaps }),
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
  /** Derived from the relation cards naming this character, one line per pair (`艾文 · 友情 · 投缘 — 现状`). */
  readonly relations: readonly string[]
  readonly currentState?: CurrentState
  readonly cardStatus: NovelCardStatus
}

/* ------------------------------------------------------------- relations */

/** A relation card's kind (类型): what the two are to each other. */
export type RelationType = '爱情' | '亲情' | '友情' | '师徒' | '对手' | '同盟' | '其他'

export const RELATION_TYPES: readonly RelationType[] = ['爱情', '亲情', '友情', '师徒', '对手', '同盟', '其他']

/** The two states a relation can fall into from any level: a rift, and a break. */
export type RelationRift = '裂痕' | '决裂'

export const RELATION_RIFTS: readonly RelationRift[] = ['裂痕', '决裂']

/**
 * Each type's four levels (阶段), lowest first, and the milestone that earns
 * each — what has to happen on the page for the pair to stand at that level.
 * The milestone of the next level is what 整理 asks about once a pair has
 * banked {@link PTS_PER_LEVEL} points.
 */
export const RELATION_LADDERS: Readonly<Record<RelationType, readonly { readonly stage: string; readonly milestone: string }[]>> = {
  爱情: [
    { stage: '相遇', milestone: '正面打过交道，对彼此留下了印象' },
    { stage: '心动', milestone: '一方开始在意对方，会为对方分神或找借口靠近' },
    { stage: '动情', milestone: '互相露出真心或软肋，对方接住了' },
    { stage: '相守', milestone: '把感情说出口，或许下要在一起的承诺' },
  ],
  亲情: [
    { stage: '相认', milestone: '知道了彼此是亲人，或被当作家人' },
    { stage: '接纳', milestone: '开始把对方当自己人，愿意照顾或被照顾' },
    { stage: '交底', milestone: '说出不对外人说的旧事或秘密' },
    { stage: '认定', milestone: '明确认定「你是我的家人」，或为对方承担代价' },
  ],
  友情: [
    { stage: '结识', milestone: '认识了，有过一次像样的来往' },
    { stage: '投缘', milestone: '主动找对方，聊得来，有一起做的事' },
    { stage: '知己', milestone: '把心事告诉对方，被理解' },
    { stage: '结义', milestone: '许下同进退的约定，或为对方冒险' },
  ],
  师徒: [
    { stage: '拜见', milestone: '见了面，一方亮出了另一方想学的本事' },
    { stage: '受教', milestone: '开始教与学，有一次具体的传授' },
    { stage: '传承', milestone: '交出真正的底牌或心法，对方懂了它的分量' },
    { stage: '出师', milestone: '徒弟独立做成一件事，师傅认可或放手' },
  ],
  对手: [
    { stage: '交锋', milestone: '正面交手或冲突一次，知道了对方是谁' },
    { stage: '较劲', milestone: '把对方当成要赢的人，会针对对方做准备' },
    { stage: '惺惺相惜', milestone: '看见对方的长处或苦衷，生出敬意' },
    { stage: '宿命对决', milestone: '双方都认定只能由彼此了结，走向决战' },
  ],
  同盟: [
    { stage: '接触', milestone: '为同一个目标碰面，谈了条件' },
    { stage: '合作', milestone: '一起做成一件事，各取所需' },
    { stage: '托底', milestone: '在对方遇险时出手，超出交易的范围' },
    { stage: '结盟', milestone: '明确结盟或立约，把后背交给对方' },
  ],
  其他: [
    { stage: '相识', milestone: '有过一次正面来往，知道对方和自己有关' },
    { stage: '亲近', milestone: '开始主动靠近或依赖对方，对方也回应了' },
    { stage: '交心', milestone: '让对方看到自己不轻易示人的一面，对方没有辜负' },
    { stage: '确立', milestone: '两人明确了彼此在对方生活里的位置，并为此付出代价或许下承诺' },
  ],
}

/** How many banked points make a pair ready for its next level (可升). */
export const PTS_PER_LEVEL = 3

/** The most points one chapter may move a pair, either way. */
export const MAX_RELATION_DELTA = 2

/**
 * What each per-chapter score means — the anchors 整理 scores against, so a
 * chapter's points read the same in chapter 3 and chapter 30. 0 (no real
 * exchange between the two) is never written. The full scoring standard lives
 * in docs/relation-criteria.md.
 */
export const RELATION_POINT_SCALE: readonly { readonly delta: number; readonly meaning: string }[] = [
  { delta: 2, meaning: '一次关键的交换：托付、救命、坦白、替对方扛事' },
  { delta: 1, meaning: '有正面来往：帮了一把、聊得来、站在对方一边' },
  { delta: -1, meaning: '有摩擦：争执、隐瞒被察觉、失望' },
  { delta: -2, meaning: '一次严重伤害：背叛、羞辱、出手伤人（还没到裂痕）' },
]

/** A relation type from untrusted input, or undefined. */
export function relationTypeOf(raw: unknown): RelationType | undefined {
  return RELATION_TYPES.find(type => type === raw)
}

/**
 * A relation card's stage read against its type: a level 1–4 when the text
 * names one of the type's stages (or is the bare number), a rift when it is
 * 裂痕/决裂, nothing when it is neither.
 */
export function readRelationStage(type: RelationType, raw: unknown): { readonly level?: number; readonly rift?: RelationRift } {
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : ''
  const rift = RELATION_RIFTS.find(candidate => candidate === text)
  if (rift !== undefined) return { rift }
  const index = RELATION_LADDERS[type].findIndex(step => step.stage === text)
  if (index >= 0) return { level: index + 1 }
  const n = Number(text)
  return Number.isInteger(n) && n >= 1 && n <= 4 ? { level: n } : {}
}

/** A level's stage name under a type (clamped to 1–4). */
export function stageNameOf(type: RelationType, level: number): string {
  const ladder = RELATION_LADDERS[type]
  return ladder[Math.min(ladder.length, Math.max(1, Math.round(level))) - 1]!.stage
}

/**
 * What a relation-journal stage event does: start (the card is made), up (a
 * level-up was adopted), crack / break (裂痕 / 决裂), fix (a rift healed),
 * type (the pair became another kind of pair), set (the stage was changed on
 * the card directly — by the person, or by the agent at the person's word).
 * Every one of them restarts the pair's progress at zero.
 */
export type RelationEvent = 'start' | 'up' | 'crack' | 'break' | 'fix' | 'type' | 'set'

const RELATION_EVENTS: readonly RelationEvent[] = ['start', 'up', 'crack', 'break', 'fix', 'type', 'set']

/** A relation event from untrusted input, or undefined. */
export function relationEventOf(raw: unknown): RelationEvent | undefined {
  return RELATION_EVENTS.find(event => event === raw)
}

/** One line of `relations.jsonl`: a chapter's points for one pair, or a stage event. */
export type RelationEntry =
  | {
    readonly relationId: string
    readonly chapter: number
    readonly kind: 'points'
    /** −{@link MAX_RELATION_DELTA}…+{@link MAX_RELATION_DELTA}, never 0. */
    readonly delta: number
    readonly evidence?: string
    readonly createdAt: string
  }
  | {
    readonly relationId: string
    readonly chapter: number
    readonly kind: 'stage'
    readonly event: RelationEvent
    /** The stage name the card moved to (a level's name, or 裂痕/决裂). */
    readonly stage: string
    /** The level the stage names (absent in a rift) — what a repair returns to. */
    readonly level?: number
    /** type events: the type before and after. */
    readonly fromType?: RelationType
    readonly toType?: RelationType
    readonly evidence?: string
    readonly createdAt: string
  }

/**
 * A pair's banked progress: the points since its last stage event, added in
 * journal order and held inside 0…{@link PTS_PER_LEVEL} at every step (a
 * full bar does not bank a surplus; a bad chapter cannot dig below empty).
 */
export function relationProgress(entries: readonly RelationEntry[]): number {
  let points = 0
  for (const entry of entries) {
    if (entry.kind === 'stage') points = 0
    else points = Math.min(PTS_PER_LEVEL, Math.max(0, points + entry.delta))
  }
  return points
}

/** A relation card, read: the pair, the type and stage, and the journal's progress. */
export interface RelationView {
  readonly cardId: string
  /** `r<n>`, or the card id before a number is allocated. */
  readonly ref: string
  /** The card's title (`赵启明 × 艾文`). */
  readonly name: string
  /** The two characters' card ids, as the card's 双方 holds them (may be fewer when the user left one out). */
  readonly pair: readonly string[]
  readonly type: RelationType
  /** The stage as written on the card. */
  readonly stage: string
  /** 1–4 when the stage names a level. */
  readonly level?: number
  /** Set when the pair stands in 裂痕 or 决裂. */
  readonly rift?: RelationRift
  /** 现状: one line on where the two stand now. */
  readonly now?: string
  /** 各自怎么看 (optional), one line per side. */
  readonly views: readonly string[]
  /** Points banked toward the next level (0…{@link PTS_PER_LEVEL}). */
  readonly progress: number
  /** Ready for the next level (可升): a full bar, a level below the top, no rift. */
  readonly ready: boolean
  readonly cardStatus: NovelCardStatus
}

/** The milestone that would carry a relation to its next level, or undefined at the top or in a rift. */
export function nextMilestoneOf(view: Pick<RelationView, 'type' | 'level' | 'rift'>): { readonly level: number; readonly stage: string; readonly milestone: string } | undefined {
  if (view.rift !== undefined || view.level === undefined || view.level >= 4) return undefined
  const step = RELATION_LADDERS[view.type][view.level]!
  return { level: view.level + 1, ...step }
}

/**
 * Where a pair stands on its bar, in one short run: 可升 → the next stage,
 * the banked points (`2/3`), 已到顶 at the top level, or the rift it is in.
 */
export function relationStanding(view: Pick<RelationView, 'type' | 'level' | 'rift' | 'progress' | 'ready'>): string {
  if (view.rift !== undefined) return view.rift
  const next = nextMilestoneOf(view)
  if (next === undefined) return '已到顶'
  return view.ready ? `可升 → ${next.stage}` : `${view.progress}/${PTS_PER_LEVEL}`
}

/**
 * Whether a type change keeps the pair's level. A pair moving into or out
 * of 对手 starts over at the first level — enemies are not friends at the
 * same depth — and may only move into it from a rift (同盟 → 裂痕/决裂 → 对手);
 * every other change (友情 → 爱情) keeps the level under the new name.
 */
export function typeChangeOf(from: RelationType, to: RelationType, rift: RelationRift | undefined): 'keep' | 'restart' | 'needs-rift' {
  if (to === '对手' && from !== '对手' && rift === undefined) return 'needs-rift'
  return to === '对手' || from === '对手' ? 'restart' : 'keep'
}

/** The level a pair stood at before its rift: the newest stage event that names one (1 when none does). */
function levelBeforeRift(view: Pick<RelationView, 'level'>, journal: readonly RelationEntry[]): number {
  if (view.level !== undefined) return view.level
  for (let i = journal.length - 1; i >= 0; i -= 1) {
    const entry = journal[i]!
    if (entry.kind === 'stage' && entry.level !== undefined) return entry.level
  }
  return 1
}

/**
 * Where one stage event takes a pair, or undefined when it does not apply
 * (a level-up at the top or in a rift, a repair with nothing to repair, a
 * move into 对手 that skipped the rift). A repair returns the pair to the
 * level it stood at before the rift; a type change keeps or restarts the
 * level per {@link typeChangeOf}.
 * @param view - the relation as it stands.
 * @param event - the event.
 * @param toType - type events: the new type.
 * @param journal - the pair's journal, oldest first.
 */
export function relationMove(
  view: Pick<RelationView, 'type' | 'level' | 'rift'>,
  event: RelationEvent,
  toType: RelationType | undefined,
  journal: readonly RelationEntry[],
): { readonly type: RelationType; readonly stage: string; readonly level?: number } | undefined {
  switch (event) {
    case 'up': {
      const next = nextMilestoneOf(view)
      return next === undefined ? undefined : { type: view.type, stage: next.stage, level: next.level }
    }
    case 'crack':
      return view.rift === undefined ? { type: view.type, stage: '裂痕' } : undefined
    case 'break':
      return view.rift === '决裂' ? undefined : { type: view.type, stage: '决裂' }
    case 'fix': {
      if (view.rift === undefined) return undefined
      const level = levelBeforeRift(view, journal)
      return { type: view.type, stage: stageNameOf(view.type, level), level }
    }
    case 'type': {
      if (toType === undefined || toType === view.type) return undefined
      const change = typeChangeOf(view.type, toType, view.rift)
      if (change === 'needs-rift') return undefined
      const level = change === 'restart' ? 1 : levelBeforeRift(view, journal)
      return { type: toType, stage: stageNameOf(toType, level), level }
    }
    default:
      return undefined
  }
}

/** Tolerant read of one relation journal line. */
export function normalizeRelationEntry(raw: unknown): RelationEntry | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  const relationId = cleanText(record['relationId'], 40)
  const chapter = typeof record['chapter'] === 'number' && Number.isFinite(record['chapter']) ? record['chapter'] : undefined
  if (relationId === undefined || chapter === undefined) return undefined
  const evidence = cleanText(record['evidence'], 60)
  const createdAt = cleanText(record['createdAt'], 40) ?? ''
  const shared = { relationId, chapter, ...(evidence === undefined ? {} : { evidence }), createdAt }
  if (record['kind'] === 'points') {
    const delta = record['delta']
    if (typeof delta !== 'number' || !Number.isInteger(delta) || delta === 0 || Math.abs(delta) > MAX_RELATION_DELTA) return undefined
    return { ...shared, kind: 'points', delta }
  }
  const event = relationEventOf(record['event'])
  const stage = cleanText(record['stage'], 20)
  if (record['kind'] !== 'stage' || stage === undefined || event === undefined) return undefined
  const level = record['level']
  const fromType = relationTypeOf(record['fromType'])
  const toType = relationTypeOf(record['toType'])
  return {
    ...shared, kind: 'stage', event, stage,
    ...(typeof level === 'number' && Number.isInteger(level) && level >= 1 && level <= 4 ? { level } : {}),
    ...(fromType === undefined ? {} : { fromType }),
    ...(toType === undefined ? {} : { toType }),
  }
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

/** How far along each live state is (已放弃 stands outside the order). */
const STATE_RANK: Readonly<Record<Exclude<ForeshadowState, '已放弃'>, number>> = { 未埋: 0, 已埋: 1, 推进中: 2, 已揭晓: 3 }

/**
 * A foreshadow's state, derived from what the text did to it (the mention
 * journal): 揭晓 → 已揭晓, 推进/暗示 → 推进中, 埋下 → 已埋. 已放弃 is the
 * one state the user sets by hand on the card. Without any mention, a 埋于
 * chapter means 已埋; otherwise the card's own 未埋 holds (a question set up
 * but not written yet), and anything else reads 已埋 — a card on the board
 * is a planted question. A hand-typed 推进中/已揭晓 never stands alone.
 * @param field - the card's status field.
 * @param plantedAt - the card's 埋于 chapter.
 * @param kinds - the kinds of every reconciled mention of the card.
 */
export function deriveForeshadowState(field: unknown, plantedAt: number | undefined, kinds: Iterable<MentionEntry['kind']>): ForeshadowState {
  if (field === '已放弃') return '已放弃'
  let state: ForeshadowState = plantedAt === undefined && field === '未埋' ? '未埋' : '已埋'
  for (const kind of kinds) state = laterForeshadowState(state, MENTION_TO_STATE[kind])
  return state
}

/** The further along of two states; 已放弃 wins (only the user lifts it). */
export function laterForeshadowState(a: ForeshadowState, b: ForeshadowState): ForeshadowState {
  if (a === '已放弃' || b === '已放弃') return '已放弃'
  return STATE_RANK[a] >= STATE_RANK[b] ? a : b
}

/* --------------------------------------------------------------- pending */

/**
 * What a pending item proposes. Proposed entries (a new rule, foreshadow or
 * character) are not pending items — they land as live cards on the board,
 * edited or archived there; the queue holds only the journal lines that wait for a
 * person. A relation's level-up, rift, repair or new type is one too: the
 * text earned it, but the person decides the pair moved.
 */
export type PendingKind = 'mention' | 'experience' | 'plan-missed' | 'info-gap' | 'relation'

const PENDING_KINDS: readonly PendingKind[] = ['mention', 'experience', 'plan-missed', 'info-gap', 'relation']

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
  /** experience / info-gap: the character card id. */
  readonly characterId?: string
  /** info-gap: what the character learned. */
  readonly fact?: string
  readonly entry?: string
  /** plan-missed: the planned op, and the foreshadow card id or 新埋 question. */
  readonly op?: string
  readonly id?: string
  readonly question?: string
  /** relation: the relation card id, the stage event, the stage it would move to, and the new type (type events). */
  readonly relationId?: string
  readonly event?: string
  readonly stage?: string
  readonly toType?: string
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
  for (const key of ['foreshadowId', 'kind', 'note', 'answer', 'question', 'characterId', 'fact', 'entry', 'op', 'id', 'relationId', 'event', 'stage', 'toType'] as const) {
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
export type NovelError = 'invalid-name' | 'missing' | 'io' | 'stale' | 'denied' | 'not-reviewed' | 'not-extracted' | 'no-workspace' | 'duplicate' | 'plan-unconfirmed' | 'unknown-foreshadow'

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

/** The subagent's row for one planned 信息差 the manuscript closed. */
export interface ExtractInfoGapInput {
  /** 1-based, as the pack numbers the 信息差. */
  readonly gap?: number
  readonly evidence_in_text?: string
}

/** One relation's points for this chapter (−2…+2, evidence-gated). */
export interface ExtractRelationPointsInput {
  readonly relation_id?: string | number
  readonly delta?: number | string
  readonly evidence_in_text?: string
}

/** A ready (可升) relation whose next milestone happened in this chapter. */
export interface ExtractRelationMilestoneInput {
  readonly relation_id?: string | number
  readonly evidence_in_text?: string
}

/** A rift, a break, a repair or a new type, as the text shows it. */
export interface ExtractRelationChangeInput {
  readonly relation_id?: string | number
  readonly change?: string
  readonly to_type?: string
  readonly evidence_in_text?: string
}

/** A pair of carded characters whose relation is new and worth a card. */
export interface ExtractNewRelationInput {
  readonly a?: string
  readonly b?: string
  readonly type?: string
  readonly now?: string
  readonly evidence_in_text?: string
}

/** The subagent's strict JSON, as `novel_extract` import receives it (tolerant reads throughout). */
export interface ExtractPayload {
  readonly beats_delivered?: readonly ExtractBeatInput[]
  readonly info_gaps_closed?: readonly ExtractInfoGapInput[]
  readonly memories?: readonly ExtractMemoryInput[]
  readonly foreshadow_mentions?: readonly ExtractMentionInput[]
  readonly new_foreshadows?: readonly ExtractNewForeshadowInput[]
  readonly new_characters?: readonly ExtractNewCharacterInput[]
  readonly experiences?: readonly ExtractExperienceInput[]
  readonly current_states?: readonly ExtractCurrentStateInput[]
  readonly relation_points?: readonly ExtractRelationPointsInput[]
  readonly relation_milestones?: readonly ExtractRelationMilestoneInput[]
  readonly relation_changes?: readonly ExtractRelationChangeInput[]
  readonly new_relations?: readonly ExtractNewRelationInput[]
  readonly recap?: string
}

/** One dropped import item and why (the anti-fabrication log). */
export interface ImportDrop {
  readonly kind: string
  readonly reason: 'evidence-not-found' | 'id-not-in-ledger' | 'character-not-in-roster' | 'card-refused' | 'duplicate' | 'stage-mismatch'
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

/** The ledger answer (伏笔沉睡榜 + 健康度, and where each kept relation stands). */
export interface LedgerResult {
  readonly ok: boolean
  readonly error?: NovelError
  readonly active: readonly ForeshadowView[]
  readonly resolved: readonly ForeshadowView[]
  readonly counts: { readonly active: number; readonly overdue: number; readonly resolved: number; readonly abandoned: number }
  /** The kept relation cards, 可升 ones first. */
  readonly relations: readonly RelationView[]
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

/** One chapter column of the story log. */
export interface StoryChapter {
  readonly n: number
  readonly title: string
  readonly phase: EffectiveChapterPhase
}

/** A foreshadow row of the story log: the view plus its chapter track (the mention journal, oldest first). */
export interface StoryForeshadow extends ForeshadowView {
  readonly marks: readonly Pick<MentionEntry, 'chapter' | 'kind' | 'planned' | 'note'>[]
}

/** A relation row of the story log: the view, the two names, and its journal (oldest first). */
export interface StoryRelation extends RelationView {
  /** The two characters' names, as the roster knows them (the card id when it does not). */
  readonly names: readonly string[]
  readonly journal: readonly RelationEntry[]
}

/** One chapter a character is in: the chapter plan's cast and POV, or the experience journal. */
export interface StoryAppearance {
  readonly chapter: number
  readonly pov: boolean
  /** Only the plan has them there (the chapter is not reconciled yet). */
  readonly planned: boolean
  /** The plan's line for them (`劝阻`). */
  readonly role?: string
  /** What the reconciled text left them with (the experience journal). */
  readonly experiences: readonly string[]
}

/**
 * A character or world row of the story log: the card's plot fields as they
 * stand ({@link plotOf}), and its change history — the person's canvas edits
 * the engine has not synced yet included, as 你改的 at the current chapter.
 */
export interface StoryCard {
  readonly cardId: string
  readonly ref: string
  readonly name: string
  readonly plot: Readonly<Record<string, string>>
  readonly history: readonly HistoryEntry[]
}

/** A character row: the card plus the chapters they are in. */
export interface StoryCharacter extends StoryCard {
  readonly appearances: readonly StoryAppearance[]
}

/** The story-log page's read: the chapter columns and the four bands, kept cards only. */
export interface StoryLogResult {
  readonly ok: boolean
  readonly error?: NovelError
  readonly chapters: readonly StoryChapter[]
  readonly foreshadows: readonly StoryForeshadow[]
  readonly relations: readonly StoryRelation[]
  readonly characters: readonly StoryCharacter[]
  readonly world: readonly StoryCard[]
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

/** One card of a work (the card page's sections). */
export interface NovelCardRequest extends NovelWorkRequest {
  readonly cardId: string
}

/** What the card page's sections show beyond the card's own fields. */
export interface NovelCardResult {
  readonly ok: boolean
  readonly error?: NovelError
  readonly role?: EntryRole
  /** Foreshadows: the user's star, and how many of the work's foreshadows carry one. */
  readonly starred?: boolean
  readonly starredCount?: number
  /** Characters: 此刻 as of the last 对账 or the user's own edit. */
  readonly currentState?: CurrentState
  /** Characters: the 关系 lines read off the relation cards naming them. */
  readonly relations?: readonly string[]
  /** Relations: the card as the engine reads it (stage, level, bar). */
  readonly relation?: RelationView
}

/** The person's ★ on a foreshadow. */
export interface NovelStarRequest extends NovelCardRequest {
  readonly starred: boolean
}

/** The person's edit of a character's 此刻 (the whole state; empty parts clear). */
export interface NovelStateRequest extends NovelCardRequest {
  readonly state: CurrentState
}
