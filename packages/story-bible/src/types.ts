/**
 * The story-bible's data vocabulary (proposal 2026-10-04-story-bible §2):
 * the work registry (`index.json`), the per-work documents (`work.json`,
 * `memories.json`, `characters.json`, `chapters.json`, `pending.json`) and
 * the two append-only journals (`experiences.jsonl`, `mentions.jsonl`), plus
 * the tolerant normalizers every read applies — a hand-edited or older file
 * reads as the closest valid document, and a document too broken to read is
 * refused by the store rather than rewritten blind (the canvas store rule).
 *
 * Id vocabulary: works are `work-<base36>`; memories `m<n>`, characters
 * `c<n>`, pending items `p<n>` — all allocated per work as max+1 over the
 * file that owns them, so id allocation is atomic with the write that needs
 * it and `work.json` carries no counters. Display refs add a sigil: canon
 * rules render `[w<n>]`, foreshadows `[#<n>]`, and a plan's foreshadow op
 * accepts any of `m12` / `#12` / `12` (normalized by {@link foreshadowIdOf}).
 * Chapter files are named by the store alone: `第{n}章.md`.
 *
 * @module @khorsheed/dsh-story-bible
 */
import { randomBytes } from 'node:crypto'

/* ------------------------------------------------------------------ works */

/** One row of the deployment's work registry (`index.json`, a top-level array). */
export interface WorkIndexEntry {
  readonly id: string
  readonly title: string
  /** Absolute path of the mounted workspace that holds this work's manuscript directory. */
  readonly workspace: string
  readonly createdAt: string
}

/** `work.json`: the work's own metadata. Counters are deliberately absent — ids derive max+1. */
export interface WorkMeta {
  readonly id: string
  readonly title: string
  readonly workspace: string
  readonly createdAt: string
  readonly updatedAt: string
}

/** Work ids: `work-` plus lowercase base36 (a directory name, so no path separators). */
export const WORK_ID_RE = /^work-[a-z0-9]{6,24}$/

/** Lowercase base36 randomness for one id (time already orders the prefix). */
function randomSuffix(): string {
  return randomBytes(8).readBigUInt64BE().toString(36).slice(0, 10).padStart(10, '0')
}

/** Mint one work id. */
export function makeWorkId(): string {
  return `work-${Date.now().toString(36)}${randomSuffix().slice(0, 6)}`
}

/** A title usable as a directory name: trimmed, no separators or control characters. */
export function sanitizeWorkTitle(title: string): string | undefined {
  const clean = title.replace(/[/\\\u0000-\u001f]/g, '').trim().slice(0, 80)
  return clean.length === 0 ? undefined : clean
}

/** A work id from untrusted input, or undefined. */
export function normalizeWorkId(id: unknown): string | undefined {
  return typeof id === 'string' && WORK_ID_RE.test(id) ? id : undefined
}

/* --------------------------------------------------------------- memories */

/** The catmem type axis, transplanted per proposal §2. */
export type MemoryType = 'episodic' | 'semantic' | 'source' | 'prospective' | 'emotional' | 'procedural' | 'implicit'
/** canon = settled constraint; intent = inspiration still awaiting the user's ✓. */
export type MemoryLayer = 'canon' | 'intent'
/** The ghost card's filing route (proposal §4.1: kind IS the archive route). */
export type MemoryKind = '世界' | '人物' | '章节' | '伏笔点子' | '原则'
export type Confidence = 'high' | 'medium' | 'low'
export type IntentStatus = 'draft' | 'active' | 'retired'

/** A foreshadow's lifecycle (埋/提/推/揭/弃), stored under `specifics` of a `prospective` memory. */
export type ForeshadowStatus = 'planted' | 'advanced' | 'hinted' | 'resolved' | 'abandoned'

/** The `prospective` memory's ledger fields (proposal §2: 伏笔 = question/status/tension/planted_at…). */
export interface ForeshadowSpecifics {
  readonly question?: string
  readonly status?: ForeshadowStatus
  /** Narrative tension 1–5 (the ledger's 势). */
  readonly tension?: number
  /** Chapter the foreshadow was planted in. */
  readonly plantedAt?: number
  /** The reveal, once resolved (the plan brief prints it so planning cannot contradict it). */
  readonly answer?: string
}

/** One memory record (canon and intent share the table, per proposal §2). */
export interface MemoryRecord {
  readonly id: string
  /** 'creator' or a character id — creators and characters share the schema. */
  readonly owner: string
  readonly type: MemoryType
  readonly layer: MemoryLayer
  readonly content: string
  readonly specifics?: ForeshadowSpecifics
  /** intent layer only: draft awaits the user's ✓, active entered the brief, retired left it. */
  readonly intentStatus?: IntentStatus
  readonly kind?: MemoryKind
  readonly status: 'active' | 'archived'
  readonly reviewed: boolean
  readonly confidence: Confidence
  readonly extractedBy: 'llm' | 'user'
  /** ≤50 characters quoted verbatim from the chapter (the import gate greps for it). */
  readonly evidenceInText?: string
  /** The extract import's high-confidence automatic write — 自动·可撤销. */
  readonly autoImported?: boolean
  readonly links?: { readonly derivesFrom?: readonly string[]; readonly resolvedBy?: string }
  readonly firstChapter?: number
  readonly lastActiveChapter?: number
  readonly createdAt: string
  readonly updatedAt: string
}

/** `memories.json` as one document. */
export interface MemoryTable {
  readonly version: 1
  readonly memories: MemoryRecord[]
}

const MEMORY_TYPES: readonly MemoryType[] = ['episodic', 'semantic', 'source', 'prospective', 'emotional', 'procedural', 'implicit']
const MEMORY_LAYERS: readonly MemoryLayer[] = ['canon', 'intent']
const MEMORY_KINDS: readonly MemoryKind[] = ['世界', '人物', '章节', '伏笔点子', '原则']
const CONFIDENCES: readonly Confidence[] = ['high', 'medium', 'low']
const INTENT_STATUSES: readonly IntentStatus[] = ['draft', 'active', 'retired']
const FORESHADOW_STATUSES: readonly ForeshadowStatus[] = ['planted', 'advanced', 'hinted', 'resolved', 'abandoned']

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
function cleanNumber(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : undefined
}

/** The memory id's numeric part (`m12` → 12), for max+1 allocation; 0 when the shape is foreign. */
export function memoryNumberOf(id: string): number {
  const match = /^m(\d+)$/.exec(id)
  return match === null ? 0 : Number(match[1])
}

/** The canon rule's display ref (`m12` → `w12`, the brief's `[w12]`). */
export function canonRefOf(id: string): string {
  return `w${memoryNumberOf(id)}`
}

/** The foreshadow's display ref (`m12` → `#12`, the ledger's `[#12]`). */
export function foreshadowRefOf(id: string): string {
  return `#${memoryNumberOf(id)}`
}

/**
 * A foreshadow memory id from any spelling the model may send (`m12`, `#12`,
 * `12`), or undefined when nothing numeric is there. Only the numeric part is
 * read — the store then checks the id against the work's actual ledger.
 */
export function foreshadowIdOf(raw: unknown): string | undefined {
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined
  const match = /^#?m?(\d+)$/.exec(String(raw).trim())
  return match === null ? undefined : `m${match[1]}`
}

/** Tolerant read of the foreshadow specifics block. */
function normalizeSpecifics(raw: unknown): ForeshadowSpecifics | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  const out: { question?: string; status?: ForeshadowStatus; tension?: number; plantedAt?: number; answer?: string } = {}
  const question = cleanText(record['question'], 200)
  if (question !== undefined) out.question = question
  const status = pick(record['status'], FORESHADOW_STATUSES)
  if (status !== undefined) out.status = status
  const tension = cleanNumber(record['tension'])
  if (tension !== undefined) out.tension = Math.min(5, Math.max(1, Math.round(tension)))
  const plantedAt = cleanNumber(record['plantedAt'] ?? record['planted_at'])
  if (plantedAt !== undefined) out.plantedAt = plantedAt
  const answer = cleanText(record['answer'], 500)
  if (answer !== undefined) out.answer = answer
  return Object.keys(out).length === 0 ? undefined : out
}

/** Tolerant read of one memory record; undefined when id/content/layer cannot be trusted. */
export function normalizeMemory(raw: unknown): MemoryRecord | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  const id = cleanText(record['id'], 40)
  const content = cleanText(record['content'])
  const layer = pick(record['layer'], MEMORY_LAYERS)
  if (id === undefined || content === undefined || layer === undefined) return undefined
  const now = new Date().toISOString()
  const specifics = normalizeSpecifics(record['specifics'])
  const intentStatus = pick(record['intentStatus'], INTENT_STATUSES)
  const kind = pick(record['kind'], MEMORY_KINDS)
  const evidenceInText = cleanText(record['evidenceInText'] ?? record['evidence_in_text'], 60)
  const firstChapter = cleanNumber(record['firstChapter'] ?? record['first_chapter'])
  const lastActiveChapter = cleanNumber(record['lastActiveChapter'] ?? record['last_active_chapter'])
  const resolvedBy = cleanText(record['links'] !== null && typeof record['links'] === 'object'
    ? (record['links'] as Record<string, unknown>)['resolvedBy'] : undefined, 40)
  return {
    id,
    owner: cleanText(record['owner'], 40) ?? 'creator',
    type: pick(record['type'], MEMORY_TYPES) ?? 'semantic',
    layer,
    content,
    status: record['status'] === 'archived' ? 'archived' : 'active',
    reviewed: record['reviewed'] === true,
    confidence: pick(record['confidence'], CONFIDENCES) ?? 'medium',
    extractedBy: record['extractedBy'] === 'user' ? 'user' : 'llm',
    createdAt: cleanText(record['createdAt'], 40) ?? now,
    updatedAt: cleanText(record['updatedAt'], 40) ?? now,
    ...(specifics === undefined ? {} : { specifics }),
    ...(intentStatus === undefined ? {} : { intentStatus }),
    ...(kind === undefined ? {} : { kind }),
    ...(evidenceInText === undefined ? {} : { evidenceInText }),
    ...(record['autoImported'] === true ? { autoImported: true } : {}),
    ...(resolvedBy === undefined ? {} : { links: { resolvedBy } }),
    ...(firstChapter === undefined ? {} : { firstChapter }),
    ...(lastActiveChapter === undefined ? {} : { lastActiveChapter }),
  }
}

/* ------------------------------------------------------------- characters */

/** The character card's five blocks (proposal §4.3) — every field exists to keep the model from writing the person wrong. */
export interface CharacterRecord {
  readonly id: string
  readonly name: string
  /** 一句身份 — the roster line. */
  readonly identity: string
  /** 档案 (准静态): 外貌 / 口癖与说话方式. */
  readonly profile: { readonly appearance?: string; readonly voice?: string }
  /** 内核 (极慢变): 想要 / 缺失 / 伤口. */
  readonly core: { readonly want?: string; readonly lack?: string; readonly wound?: string }
  /** 知道的事 / 不知道的事 / 秘密 — the POV boundary. */
  readonly knowledge: {
    readonly knows: readonly string[]
    readonly unaware: readonly string[]
    readonly secrets: readonly string[]
  }
  /** 关系: one current description per target plus a change journal (▲第5章升温). */
  readonly relationships: readonly {
    readonly target: string
    readonly description: string
    readonly changes: readonly { readonly chapter: number; readonly note: string }[]
  }[]
  /** 当前态: 在哪 / 状态 / 牵挂 — derived from the latest chapter, user-editable. */
  readonly currentState: { readonly where?: string; readonly state?: string; readonly concern?: string }
  /** Reserved for the M3+ generated portrait (proposal §0 non-goal note). */
  readonly image?: string
  readonly status: 'active' | 'archived'
  readonly createdAt: string
  readonly updatedAt: string
}

/** `characters.json` as one document. */
export interface CharacterTable {
  readonly version: 1
  readonly characters: CharacterRecord[]
}

/** One line of `experiences.jsonl`: what this character did and how their state moved in one chapter. */
export interface ExperienceEntry {
  readonly characterId: string
  readonly chapter: number
  readonly entry: string
  readonly createdAt: string
}

/** A string list from untrusted input (knowledge blocks). */
function cleanStringList(raw: unknown, max = 20): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map(item => cleanText(item, 200)).filter((item): item is string => item !== undefined).slice(0, max)
}

/** Tolerant read of one character record; undefined when id/name cannot be trusted. */
export function normalizeCharacter(raw: unknown): CharacterRecord | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  const id = cleanText(record['id'], 40)
  const name = cleanText(record['name'], 80)
  if (id === undefined || name === undefined) return undefined
  const now = new Date().toISOString()
  const obj = (key: string): Record<string, unknown> =>
    typeof record[key] === 'object' && record[key] !== null ? record[key] as Record<string, unknown> : {}
  const profile = obj('profile')
  const core = obj('core')
  const knowledge = obj('knowledge')
  const currentState = obj('currentState')
  const appearance = cleanText(profile['appearance'], 500)
  const voice = cleanText(profile['voice'], 500)
  const want = cleanText(core['want'], 300)
  const lack = cleanText(core['lack'], 300)
  const wound = cleanText(core['wound'], 300)
  const where = cleanText(currentState['where'], 200)
  const state = cleanText(currentState['state'], 200)
  const concern = cleanText(currentState['concern'], 200)
  const image = cleanText(record['image'], 300)
  const relationships = (Array.isArray(record['relationships']) ? record['relationships'] : [])
    .map((rel): CharacterRecord['relationships'][number] | undefined => {
      if (typeof rel !== 'object' || rel === null) return undefined
      const row = rel as Record<string, unknown>
      const target = cleanText(row['target'], 80)
      const description = cleanText(row['description'], 500)
      if (target === undefined || description === undefined) return undefined
      const changes = (Array.isArray(row['changes']) ? row['changes'] : [])
        .map((change): { chapter: number; note: string } | undefined => {
          if (typeof change !== 'object' || change === null) return undefined
          const line = change as Record<string, unknown>
          const chapter = cleanNumber(line['chapter'])
          const note = cleanText(line['note'], 300)
          return chapter === undefined || note === undefined ? undefined : { chapter, note }
        })
        .filter((change): change is { chapter: number; note: string } => change !== undefined)
      return { target, description, changes }
    })
    .filter((rel): rel is CharacterRecord['relationships'][number] => rel !== undefined)
  return {
    id,
    name,
    identity: cleanText(record['identity'], 200) ?? '',
    profile: { ...(appearance === undefined ? {} : { appearance }), ...(voice === undefined ? {} : { voice }) },
    core: { ...(want === undefined ? {} : { want }), ...(lack === undefined ? {} : { lack }), ...(wound === undefined ? {} : { wound }) },
    knowledge: {
      knows: cleanStringList(knowledge['knows']),
      unaware: cleanStringList(knowledge['unaware']),
      secrets: cleanStringList(knowledge['secrets']),
    },
    relationships,
    currentState: {
      ...(where === undefined ? {} : { where }),
      ...(state === undefined ? {} : { state }),
      ...(concern === undefined ? {} : { concern }),
    },
    ...(image === undefined ? {} : { image }),
    status: record['status'] === 'archived' ? 'archived' : 'active',
    createdAt: cleanText(record['createdAt'], 40) ?? now,
    updatedAt: cleanText(record['updatedAt'], 40) ?? now,
  }
}

/* -------------------------------------------------------------- chapters */

/**
 * The stored half of a chapter's phase (proposal §2: 阶段从事实派生). 写作中
 * is NOT stored — it derives from the manuscript file existing with content;
 * the store only records 规划中 → 已审过 (the user's gate) → 已抽取.
 */
export type ChapterPhase = 'planning' | 'reviewed' | 'extracted'

/** The phase the UI shows, given whether the manuscript has content. */
export type EffectiveChapterPhase = 'planning' | 'writing' | 'reviewed' | 'extracted'

/** One planned foreshadow operation (推进/暗示/新埋/揭晓), referencing the ledger by id, or a question for 新埋. */
export interface ForeshadowOp {
  readonly op: '推进' | '暗示' | '新埋' | '揭晓'
  /** The ledger memory id, in any spelling {@link foreshadowIdOf} accepts. */
  readonly id?: string
  /** 新埋 only: the question being planted. */
  readonly question?: string
}

/** The chapter plan (POV / 目标 / 伏笔操作 / 出场角色 / 章末钩子). */
export interface ChapterPlan {
  readonly pov?: string
  readonly goal: string
  readonly foreshadowOps: readonly ForeshadowOp[]
  /** Character ids or names (the roster resolves them at render time). */
  readonly characters: readonly string[]
  readonly hook?: string
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

/** The stored phase plus the manuscript fact → the phase the UI shows. */
export function effectiveChapterPhase(chapter: ChapterRecord, hasBody: boolean): EffectiveChapterPhase {
  if (chapter.phase === 'planning' && hasBody) return 'writing'
  return chapter.phase
}

/** One line of `mentions.jsonl`: a foreshadow touch in one chapter, with the plan-reconciliation flags. */
export interface MentionEntry {
  readonly foreshadowId: string
  readonly chapter: number
  readonly kind: 'planted' | 'advanced' | 'hinted' | 'resolved'
  /** The chapter plan listed this operation. */
  readonly planned: boolean
  /** The extract import saw it in the text. */
  readonly reconciled: boolean
  readonly note?: string
  readonly createdAt: string
}

const FORESHADOW_OPS: readonly ForeshadowOp['op'][] = ['推进', '暗示', '新埋', '揭晓']

/** Tolerant read of one chapter plan; undefined when no goal is there to plan around. */
export function normalizePlan(raw: unknown): ChapterPlan | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  const goal = cleanText(record['goal'], 300)
  if (goal === undefined) return undefined
  const pov = cleanText(record['pov'], 80)
  const hook = cleanText(record['hook'], 300)
  const foreshadowOps = (Array.isArray(record['foreshadowOps']) ? record['foreshadowOps'] : [])
    .map((op): ForeshadowOp | undefined => {
      if (typeof op !== 'object' || op === null) return undefined
      const row = op as Record<string, unknown>
      const verb = pick(row['op'], FORESHADOW_OPS)
      if (verb === undefined) return undefined
      const id = cleanText(row['id'], 40)
      const question = cleanText(row['question'], 200)
      return { op: verb, ...(id === undefined ? {} : { id }), ...(question === undefined ? {} : { question }) }
    })
    .filter((op): op is ForeshadowOp => op !== undefined)
  return {
    goal,
    foreshadowOps,
    characters: cleanStringList(record['characters'], 12),
    ...(pov === undefined ? {} : { pov }),
    ...(hook === undefined ? {} : { hook }),
  }
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
  return {
    n,
    seq: cleanNumber(record['seq']) ?? n,
    title,
    file,
    phase: record['phase'] === 'reviewed' || record['phase'] === 'extracted' ? record['phase'] : 'planning',
    ...(plan === undefined ? {} : { plan }),
    ...(recap === undefined ? {} : { recap }),
    ...(wordCount === undefined ? {} : { wordCount }),
    sessionIds: cleanStringList(record['sessionIds'], 40),
    createdAt: cleanText(record['createdAt'], 40) ?? now,
    updatedAt: cleanText(record['updatedAt'], 40) ?? now,
  }
}

/* --------------------------------------------------------------- pending */

/** What a pending item proposes (proposal §5 gates 3–5). */
export type PendingKind = 'memory' | 'mention' | 'new-character' | 'new-foreshadow' | 'experience' | 'plan-missed'

const PENDING_KINDS: readonly PendingKind[] = ['memory', 'mention', 'new-character', 'new-foreshadow', 'experience', 'plan-missed']

/**
 * A pending item's proposed record, flattened to JSON-safe scalars (the wire
 * carries it, so no nested unknowns). Which keys matter follows `kind`.
 */
export interface PendingPayload {
  readonly content?: string
  readonly type?: string
  readonly owner?: string
  readonly confidence?: string
  readonly foreshadowId?: string
  readonly kind?: string
  readonly note?: string
  readonly answer?: string
  readonly question?: string
  readonly tension?: number
  readonly name?: string
  readonly identity?: string
  readonly characterId?: string
  readonly entry?: string
  readonly op?: string
  readonly id?: string
}

/** One row of `pending.json` (the review queue's snapshot — a derived cache that can be rebuilt). */
export interface PendingItem {
  readonly id: string
  readonly kind: PendingKind
  readonly confidence: 'medium' | 'low'
  readonly chapter?: number
  /** One line on why this waits for a person (新角色必审 / 置信度 medium / 计划落空…). */
  readonly reason: string
  readonly evidenceInText?: string
  /** The proposed record, shaped per kind (memory input, mention, character draft, experience, plan op). */
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
  for (const key of ['content', 'type', 'owner', 'confidence', 'foreshadowId', 'kind', 'note', 'answer', 'question', 'name', 'identity', 'characterId', 'entry', 'op', 'id'] as const) {
    const value = cleanText(record[key], 500)
    if (value !== undefined) out[key] = value
  }
  const tension = cleanNumber(record['tension'])
  if (tension !== undefined) out.tension = tension
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
  return {
    id,
    kind,
    confidence: record['confidence'] === 'low' ? 'low' : 'medium',
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

/** The store's failure codes (the canvas vocabulary, plus the review gate's). */
export type StoryError = 'invalid-name' | 'missing' | 'io' | 'stale' | 'denied' | 'not-reviewed' | 'already-exists'

/** One mutation's receipt: the fresh document on success, the code on failure. */
export interface StoryOutcome {
  readonly ok: boolean
  readonly error?: StoryError
}

/* ---------------------------------------------- wire-boundary contracts */

/** The review verb's actions (proposal §3: 采纳/丢弃/归档/撤销 — UI 与 agent 同一动词). */
export type ReviewAction = 'accept' | 'discard' | 'archive' | 'retract'

/** A new memory as the write verb takes it. */
export interface WriteMemoryRequest {
  readonly workId: string
  readonly content: string
  readonly type?: MemoryRecord['type']
  readonly layer?: MemoryRecord['layer']
  readonly kind?: MemoryRecord['kind']
  readonly owner?: string
  readonly confidence?: Confidence
  readonly evidenceInText?: string
  readonly specifics?: MemoryRecord['specifics']
  readonly chapter?: number
}

/** A character create (no id) or patch (id present); provided blocks replace. */
export interface WriteCharacterRequest {
  readonly workId: string
  readonly id?: string
  readonly name: string
  readonly identity?: string
  readonly profile?: CharacterRecord['profile']
  readonly core?: CharacterRecord['core']
  readonly knowledge?: CharacterRecord['knowledge']
  readonly currentState?: CharacterRecord['currentState']
}

/** A chapter create (no n) or plan/title update (n present). */
export interface WriteChapterRequest {
  readonly workId: string
  readonly n?: number
  readonly title: string
  readonly plan?: unknown
  /** Insert position (defaults to n — 插章 gives an explicit seq, proposal §2). */
  readonly seq?: number
}

/** The subagent's memory row (strict JSON, tolerant reads). */
export interface ExtractMemoryInput {
  readonly type?: string
  readonly owner?: string
  readonly content?: string
  readonly confidence?: string
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
  readonly tension?: number
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

/** The subagent's strict JSON, as `story_extract` import receives it (tolerant reads throughout). */
export interface ExtractPayload {
  readonly memories?: readonly ExtractMemoryInput[]
  readonly foreshadow_mentions?: readonly ExtractMentionInput[]
  readonly new_foreshadows?: readonly ExtractNewForeshadowInput[]
  readonly new_characters?: readonly ExtractNewCharacterInput[]
  readonly experiences?: readonly ExtractExperienceInput[]
  readonly current_states?: readonly ExtractCurrentStateInput[]
  readonly recap?: string
  readonly word_count?: number
}

/** One dropped import item and why (the anti-fabrication log). */
export interface ImportDrop {
  readonly kind: string
  readonly reason: 'evidence-not-found' | 'id-not-in-ledger' | 'character-not-in-roster'
  readonly ref: string
}

/** The import's reconciliation report (the model's 汇报格式 rides on these numbers). */
export interface ImportReport {
  readonly ok: boolean
  readonly error?: StoryError
  readonly verified: number
  readonly missed: number
  readonly autoImported: number
  readonly pending: number
  readonly dropped: readonly ImportDrop[]
  readonly pendingItems: readonly { readonly id: string; readonly kind: PendingKind; readonly reason: string }[]
}

/** The ledger answer (伏笔沉睡榜 + 健康度). */
export interface LedgerResult {
  readonly ok: boolean
  readonly error?: StoryError
  readonly active: readonly MemoryRecord[]
  readonly resolved: readonly MemoryRecord[]
  readonly counts: { readonly active: number; readonly overdue: number; readonly resolved: number; readonly abandoned: number }
  /** The newest chapter number — the sleeping baseline. */
  readonly currentChapter: number
}

/** A work's information page (counts 现算, proposal §6 信息 view). */
export interface WorkInfo {
  readonly meta: WorkMeta
  readonly counts: {
    readonly memories: number
    readonly intentDrafts: number
    readonly characters: number
    readonly chapters: number
    readonly pending: number
  }
  readonly stateDir: string
}

/** One chapter row for the wire: the record plus its effective (derived) phase. */
export interface ChapterRow {
  readonly chapter: ChapterRecord
  readonly phase: EffectiveChapterPhase
}
