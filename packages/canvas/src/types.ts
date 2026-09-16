/**
 * Shared vocabulary of the inspiration canvas: the pad's on-disk layout, its
 * two item kinds, the tolerant index shape, and the canvas Remote's wire
 * payloads. Both faces import this module, so the layout is named exactly
 * once — the browser half builds no path of its own (the host resolves and
 * returns every absolute/relative spelling), which keeps platform separators
 * out of the client bundle.
 *
 * Runtime-agnostic on purpose: no `node:path`, no DOM. Every helper here is
 * pure and unit-tested.
 *
 * @module @khorsheed/dsh-canvas/types
 */

/** The pad directory created inside the workspace root (visible, Chinese). */
export const PAD_DIR_NAME = '灵感画布'

/** Sub-directory holding long-form articles. */
export const ARTICLE_DIR_NAME = '文章'

/** Sub-directory holding inspiration cards. */
export const CARD_DIR_NAME = '卡片'

/** Sidecar holding the display order and the archive set. */
export const INDEX_FILE_NAME = '.index.json'

/** Extension every item file carries. */
export const ITEM_EXTENSION = '.md'

/** The item kinds, in the order the new-item menu offers them. */
export const CANVAS_KINDS = ['article', 'card'] as const

/** One item kind. The directory it lives in IS the kind. */
export type CanvasKind = (typeof CANVAS_KINDS)[number]

/** Longest accepted item title, in code units — well under every filesystem limit. */
export const MAX_TITLE_LENGTH = 80

/** Whether a value is one of the two item kinds. */
export function isCanvasKind(value: unknown): value is CanvasKind {
  return value === 'article' || value === 'card'
}

/** The sub-directory an item kind lives in. */
export function kindDirectoryName(kind: CanvasKind): string {
  return kind === 'card' ? CARD_DIR_NAME : ARTICLE_DIR_NAME
}

/** The kind a sub-directory names, or undefined for a foreign directory. */
export function kindOfDirectoryName(directory: string): CanvasKind | undefined {
  if (directory === ARTICLE_DIR_NAME) return 'article'
  if (directory === CARD_DIR_NAME) return 'card'
  return undefined
}

/**
 * Tolerant index record: the display order and the archive set, exactly the
 * two facts the official workspace registry keeps for sessions (`workspaceIds`
 * order + `archivedSessionIds` set).
 */
export interface CanvasIndex {
  /** Pad-relative item names in display order. */
  readonly order: readonly string[]
  /** Pad-relative item names hidden from the list; the file is never touched. */
  readonly archivedIds: readonly string[]
}

/** The index used when none exists or it cannot be understood. */
export const EMPTY_INDEX: CanvasIndex = { order: [], archivedIds: [] }

/**
 * Read an untrusted JSON value into an index. Anything unrecognized degrades
 * to an empty list rather than throwing — a hand-edited or truncated sidecar
 * must never make the pad unopenable.
 * @param raw - parsed `.index.json` content (any shape).
 * @returns the normalized index.
 */
export function normalizeIndex(raw: unknown): CanvasIndex {
  if (typeof raw !== 'object' || raw === null) return EMPTY_INDEX
  const record = raw as { order?: unknown; archivedIds?: unknown }
  return {
    order: stringList(record.order),
    archivedIds: stringList(record.archivedIds),
  }
}

/** Deduplicated, entry-checked string list; a non-array reads as empty. */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry === 'string' && entry.length > 0) seen.add(entry)
  }
  return [...seen]
}

/** Characters no item title may carry (path separators, control codes). */
const ILLEGAL_TITLE = /[\\/:*?"<>|\u0000-\u001f\u007f]/g

/**
 * Turn operator input into a usable item title, or undefined when nothing
 * usable is left. A trailing `.md` is dropped (the extension is ours to add),
 * illegal characters become `-`, leading dots are stripped so an item can
 * never land a dotfile in the pad, and the result is capped.
 * @param raw - whatever the operator typed.
 * @returns the sanitized title, or undefined when it is empty.
 */
export function sanitizeItemTitle(raw: string): string | undefined {
  const withoutExtension = raw.trim().replace(/\.md$/i, '')
  const cleaned = withoutExtension
    .replace(ILLEGAL_TITLE, '-')
    .replace(/^\.+/, '')
    .trim()
  if (cleaned.length === 0 || cleaned === '.' || cleaned === '..') return undefined
  return cleaned.slice(0, MAX_TITLE_LENGTH)
}

/** The pad-relative name of one item (`<kindDir>/<title>.md`). */
export function itemNameOf(kind: CanvasKind, title: string): string {
  return `${kindDirectoryName(kind)}/${title}${ITEM_EXTENSION}`
}

/** The basename of a pad-relative name. */
function basenameOf(name: string): string {
  const slash = name.lastIndexOf('/')
  return slash < 0 ? name : name.slice(slash + 1)
}

/**
 * The kind a pad-relative item name belongs to, or undefined when the name is
 * not one of ours (foreign directory, missing extension, traversal attempt).
 * @param name - pad-relative name, e.g. `文章/第一章 雨夜.md`.
 * @returns the kind, or undefined.
 */
export function kindOfItemName(name: string): CanvasKind | undefined {
  if (name.includes('\\')) return undefined
  const segments = name.split('/')
  if (segments.length !== 2) return undefined
  if (segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) return undefined
  const [directory, file] = segments
  const kind = kindOfDirectoryName(directory as string)
  if (kind === undefined) return undefined
  return file!.toLowerCase().endsWith(ITEM_EXTENSION) ? kind : undefined
}

/**
 * The display title of a pad-relative item name (basename without the
 * extension). Non-item names return their basename unchanged.
 * @param name - pad-relative name.
 * @returns the title shown in the list and the header.
 */
export function titleOfItemName(name: string): string {
  const base = basenameOf(name)
  return base.toLowerCase().endsWith(ITEM_EXTENSION)
    ? base.slice(0, -ITEM_EXTENSION.length)
    : base
}

/**
 * Order item names for display: names the index lists keep the index's order,
 * everything else follows in code-unit order (an externally created file is
 * appended after the known ones, deterministically). Note that `ctx.fs`
 * reports no mtime, so the index — not a timestamp — is what orders the pad.
 * @param names - every pad-relative name found on disk.
 * @param order - the index's recorded order.
 * @returns a new, ordered array.
 */
export function orderItemNames(names: readonly string[], order: readonly string[]): string[] {
  const rank = new Map<string, number>()
  for (const name of order) {
    if (!rank.has(name)) rank.set(name, rank.size)
  }
  return [...names].sort((a, b) => {
    const rankA = rank.get(a)
    const rankB = rank.get(b)
    if (rankA !== undefined && rankB !== undefined) return rankA - rankB
    if (rankA !== undefined) return -1
    if (rankB !== undefined) return 1
    return a < b ? -1 : a > b ? 1 : 0
  })
}

/** One item as the list surface needs it. */
export interface CanvasListItem {
  /** Pad-relative name (`文章/第一章 雨夜.md`) — the handle every call takes. */
  readonly name: string
  /** Display title (basename without `.md`). */
  readonly title: string
  /** Which kind this item is; the directory it lives in. */
  readonly kind: CanvasKind
  /** Whether the index hides it from the list (the file is untouched). */
  readonly archived: boolean
  /** Absolute host path — what the copy-path gesture puts on the clipboard. */
  readonly absolutePath: string
  /** Workspace-relative path — what the status bar shows. */
  readonly relativePath: string
  /** Byte size when the backend reports it. */
  readonly size: number | null
}

/** Failure vocabulary shared by every mutating call. */
export type CanvasError =
  /** The file changed since the caller read it; the write was refused. */
  | 'stale'
  /** A create named an item that already exists. */
  | 'exists'
  /** The item is not there (deleted or renamed outside the pad). */
  | 'missing'
  /** The name is not a legal item name (traversal, foreign directory, no extension). */
  | 'invalid-name'
  /** The deployment's sandbox refused the write. */
  | 'denied'
  /** Any other filesystem failure. */
  | 'io'

/** List one workspace's pad. */
export interface CanvasListRequest {
  /** Absolute workspace root (the host joins the pad directory onto it). */
  readonly dir: string
}

/** The pad's current items, displayed order first. */
export interface CanvasListResult {
  /** Active (non-archived) items in display order. */
  readonly items: readonly CanvasListItem[]
  /** Archived items in display order. */
  readonly archived: readonly CanvasListItem[]
}

/** Read one item's text. */
export interface CanvasReadRequest {
  readonly dir: string
  /** Pad-relative name. */
  readonly name: string
}

/** One item's text with the freshness token a later write must present. */
export interface CanvasReadResult {
  readonly content: string
  readonly version: string
  readonly absolutePath: string
  readonly relativePath: string
}

/** A read either returns the item or reports one code from the shared vocabulary. */
export type CanvasReadOutcome =
  | ({ readonly ok: true } & CanvasReadResult)
  | { readonly ok: false; readonly error: CanvasError }

/** Create a new item; the host refuses a title that already exists. */
export interface CanvasCreateRequest {
  readonly dir: string
  readonly kind: CanvasKind
  /** Display title; the host sanitizes it and appends `.md`. */
  readonly title: string
  /** Initial body. */
  readonly content: string
}

/** Overwrite an existing item, guarded by the version last read. */
export interface CanvasWriteRequest {
  readonly dir: string
  readonly name: string
  readonly content: string
  readonly version: string
}

/** The receipt of a successful create/write. */
export interface CanvasWriteValue {
  readonly name: string
  readonly title: string
  readonly version: string
  readonly absolutePath: string
  readonly relativePath: string
  readonly operation: 'create' | 'update'
}

/** A create/write either lands or reports one code from the shared vocabulary. */
export type CanvasWriteResult =
  | ({ readonly ok: true } & CanvasWriteValue)
  | { readonly ok: false; readonly error: CanvasError }

/** Move one item in or out of the archive set (the file is never touched). */
export interface CanvasArchiveRequest {
  readonly dir: string
  readonly name: string
  readonly archived: boolean
}

/** The archive gesture's receipt. */
export type CanvasArchiveResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: CanvasError }

/* ============================================================================
 * The v2 canvas space (主题画布空间): the deployment-level board vocabulary.
 * One canvas = one topic = one `canvas.json` under the deployment state dir
 * (`$DSH_HOME/state/canvas/<canvasId>/`). The card board is the primary
 * surface; every card is small, so the whole board lives in the one file and
 * every mutation is a version-guarded rewrite of it (the v1 fence pattern,
 * re-rooted at the state dir — see the package Agent Note).
 * ========================================================================= */

/** The canvas metadata file inside one canvas's state directory. */
export const CANVAS_FILE_NAME = 'canvas.json'

/** The state dir's own name under `$DSH_HOME/state/` (the datasets precedent). */
export const CANVAS_STATE_DIR_NAME = 'canvas'

/** The content card kinds, in the order the board's filter chips offer them. */
export const BOARD_CARD_KINDS = ['fragment', 'question', 'grounding', 'reference', 'document'] as const

/** One content card kind. */
export type BoardCardKind = (typeof BOARD_CARD_KINDS)[number]

/** The card statuses; `proposed` is the agent-contribution entrance (ghost). */
export const BOARD_CARD_STATUSES = ['proposed', 'kept', 'archived'] as const

/** One card status. Archiving never deletes (the v1 semantics, continued). */
export type BoardCardStatus = (typeof BOARD_CARD_STATUSES)[number]

/** The question card lifecycle states. */
export const QUESTION_STATES = ['open', 'exploring', 'answered'] as const

/** One question lifecycle state; `answered` is only ever user-settled. */
export type QuestionState = (typeof QUESTION_STATES)[number]

/** Longest accepted canvas title, in code units. */
export const MAX_CANVAS_TITLE_LENGTH = 80

/** Longest accepted card text, in code units — cards stay small by design. */
export const MAX_CARD_TEXT_LENGTH = 8000

/** Longest accepted comment text, in code units. */
export const MAX_COMMENT_TEXT_LENGTH = 4000

/** Whether a value is one of the five content card kinds. */
export function isBoardCardKind(value: unknown): value is BoardCardKind {
  return typeof value === 'string' && (BOARD_CARD_KINDS as readonly string[]).includes(value)
}

/** Whether a value is one of the three card statuses. */
export function isBoardCardStatus(value: unknown): value is BoardCardStatus {
  return typeof value === 'string' && (BOARD_CARD_STATUSES as readonly string[]).includes(value)
}

/** Whether a value is one of the three question lifecycle states. */
export function isQuestionState(value: unknown): value is QuestionState {
  return typeof value === 'string' && (QUESTION_STATES as readonly string[]).includes(value)
}

/**
 * The shape every canvas id must have. The id names a state directory, so it
 * is validated before any path is joined from it — anything else (traversal,
 * separators, a foreign prefix) is refused before the filesystem sees it.
 * @param value - the id a wire request carried.
 * @returns the id when usable, or undefined.
 */
export function normalizeCanvasId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return /^canvas_[a-z0-9]{8,40}$/.test(value) ? value : undefined
}

/**
 * Turn operator input into a usable canvas title, or undefined when nothing
 * usable is left. A canvas title is display text, not a file name (the id is
 * the directory), so only whitespace is normalized and the result capped.
 * @param raw - whatever the operator typed.
 * @returns the sanitized title, or undefined when it is empty.
 */
export function sanitizeCanvasTitle(raw: string): string | undefined {
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (cleaned.length === 0) return undefined
  return cleaned.slice(0, MAX_CANVAS_TITLE_LENGTH)
}

/**
 * Build one id. Ids are time-ordered base36 (a ULID-flavoured shape:
 * `canvas_01J…`), which keeps the state dir's lexical order chronological;
 * the caller supplies the time and the randomness so this module stays pure.
 * @param prefix - `canvas`, `c` (card) or `m` (comment).
 * @param timeMs - milliseconds since the epoch.
 * @param random - lowercase base36 randomness (host supplies `node:crypto`).
 * @returns the id.
 */
export function makeBoardId(prefix: 'canvas' | 'c' | 'm', timeMs: number, random: string): string {
  return `${prefix}_${timeMs.toString(36).padStart(9, '0')}${random.toLowerCase().replace(/[^a-z0-9]/g, '')}`
}

/** Where a card's content came from. */
export interface BoardCardSource {
  readonly type: 'url' | 'file' | 'paste'
  /** The url, the absolute file path, or a short paste note. */
  readonly ref: string
  /** Display title (a fetched page title, the item name). */
  readonly title?: string
}

/** One comment on a card. */
export interface BoardComment {
  readonly id: string
  readonly author: 'user' | 'agent'
  readonly text: string
  readonly createdAt: string
}

/** One board card. */
export interface BoardCard {
  readonly id: string
  readonly kind: BoardCardKind
  text: string
  source?: BoardCardSource
  status: BoardCardStatus
  /** Present only on question cards. */
  question?: { state: QuestionState }
  comments: BoardComment[]
  readonly createdBy: 'user' | 'agent'
  readonly createdAt: string
  updatedAt: string
}

/** The board's self-tuning counters (the rules that read them stay visible). */
export interface CanvasStats {
  proposed: { accepted: number; rejected: number }
  /** Non-archived card counts by kind (kept + proposed — what the board shows). */
  kindCounts: Partial<Record<BoardCardKind, number>>
  lastActiveAt: string
}

/** One canvas's `canvas.json`: metadata plus every card plus the counters. */
export interface CanvasBoard {
  readonly id: string
  title: string
  attachedWorkspaces: string[]
  /** The single agent session this canvas owns; null until M2 creates it. */
  chat: { sessionId: string | null }
  cards: BoardCard[]
  stats: CanvasStats
  /** Set when the canvas is archived from the list; the directory is never deleted. */
  archivedAt: string | null
  readonly createdAt: string
  updatedAt: string
}

/** Recompute the visible kind counts from the card set (status !== archived). */
export function computeKindCounts(cards: readonly BoardCard[]): Partial<Record<BoardCardKind, number>> {
  const counts: Partial<Record<BoardCardKind, number>> = {}
  for (const card of cards) {
    if (card.status === 'archived') continue
    counts[card.kind] = (counts[card.kind] ?? 0) + 1
  }
  return counts
}

/** One canvas as the space's list surface needs it. */
export interface CanvasSummary {
  readonly id: string
  readonly title: string
  /** Non-archived card count (kept + proposed). */
  readonly cardCount: number
  /** Non-archived question cards still open or exploring. */
  readonly openQuestions: number
  readonly archivedAt: string | null
  readonly lastActiveAt: string
}

/** Project one board into its list row. */
export function summarizeBoard(board: CanvasBoard): CanvasSummary {
  let cardCount = 0
  let openQuestions = 0
  for (const card of board.cards) {
    if (card.status === 'archived') continue
    cardCount += 1
    if (card.kind === 'question' && card.question !== undefined && card.question.state !== 'answered') {
      openQuestions += 1
    }
  }
  return {
    id: board.id,
    title: board.title,
    cardCount,
    openQuestions,
    archivedAt: board.archivedAt,
    lastActiveAt: board.stats.lastActiveAt,
  }
}

/** A fresh board's stats. */
export function emptyStats(now: string): CanvasStats {
  return { proposed: { accepted: 0, rejected: 0 }, kindCounts: {}, lastActiveAt: now }
}

/**
 * Read an untrusted card value into a well-formed card, or undefined when the
 * value is unusable (a hand-edited `canvas.json` must never make the board
 * unopenable — the bad card drops out, the rest load).
 * @param raw - one parsed `cards[]` entry.
 * @param now - timestamps for entries that lost theirs.
 * @returns the normalized card, or undefined.
 */
function normalizeCard(raw: unknown, now: string): BoardCard | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  if (typeof record['id'] !== 'string' || record['id'].length === 0) return undefined
  if (!isBoardCardKind(record['kind'])) return undefined
  if (typeof record['text'] !== 'string') return undefined
  const status = isBoardCardStatus(record['status']) ? record['status'] : 'kept'
  const card: BoardCard = {
    id: record['id'],
    kind: record['kind'],
    text: record['text'].slice(0, MAX_CARD_TEXT_LENGTH),
    status,
    comments: [],
    createdBy: record['createdBy'] === 'agent' ? 'agent' : 'user',
    createdAt: typeof record['createdAt'] === 'string' ? record['createdAt'] : now,
    updatedAt: typeof record['updatedAt'] === 'string' ? record['updatedAt'] : now,
  }
  if (typeof record['source'] === 'object' && record['source'] !== null) {
    const source = record['source'] as Record<string, unknown>
    const type = source['type']
    if ((type === 'url' || type === 'file' || type === 'paste') && typeof source['ref'] === 'string') {
      card.source = {
        type,
        ref: source['ref'],
        ...(typeof source['title'] === 'string' ? { title: source['title'] } : {}),
      }
    }
  }
  if (card.kind === 'question') {
    card.question = {
      state: typeof record['question'] === 'object' && record['question'] !== null &&
        isQuestionState((record['question'] as Record<string, unknown>)['state'])
        ? (record['question'] as { state: QuestionState }).state
        : 'open',
    }
  }
  if (Array.isArray(record['comments'])) {
    for (const entry of record['comments'] as unknown[]) {
      if (typeof entry !== 'object' || entry === null) continue
      const comment = entry as Record<string, unknown>
      if (typeof comment['id'] !== 'string' || typeof comment['text'] !== 'string') continue
      card.comments.push({
        id: comment['id'],
        author: comment['author'] === 'agent' ? 'agent' : 'user',
        text: comment['text'].slice(0, MAX_COMMENT_TEXT_LENGTH),
        createdAt: typeof comment['createdAt'] === 'string' ? comment['createdAt'] : now,
      })
    }
  }
  return card
}

/**
 * Read an untrusted `canvas.json` value into a board, or undefined when the
 * value is unusable at the top level (not an object, or missing the id/title
 * the directory claims). Per-field problems degrade to defaults instead —
 * a tolerant read, exactly the pad index's rule.
 * @param raw - the parsed file content.
 * @param expectedId - the directory's id; a mismatch refuses the file.
 * @param now - timestamps for fields that lost theirs.
 * @returns the normalized board, or undefined.
 */
export function normalizeBoard(raw: unknown, expectedId: string, now: string): CanvasBoard | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  if (record['id'] !== expectedId) return undefined
  if (typeof record['title'] !== 'string' || record['title'].length === 0) return undefined
  const cards: BoardCard[] = []
  if (Array.isArray(record['cards'])) {
    for (const entry of record['cards'] as unknown[]) {
      const card = normalizeCard(entry, now)
      if (card !== undefined) cards.push(card)
    }
  }
  const statsRaw = typeof record['stats'] === 'object' && record['stats'] !== null
    ? record['stats'] as Record<string, unknown>
    : undefined
  const proposedRaw = typeof statsRaw?.['proposed'] === 'object' && statsRaw['proposed'] !== null
    ? statsRaw['proposed'] as Record<string, unknown>
    : undefined
  const count = (value: unknown): number => typeof value === 'number' && value >= 0 ? Math.floor(value) : 0
  return {
    id: expectedId,
    title: record['title'].slice(0, MAX_CANVAS_TITLE_LENGTH),
    attachedWorkspaces: Array.isArray(record['attachedWorkspaces'])
      ? (record['attachedWorkspaces'] as unknown[]).filter((w): w is string => typeof w === 'string')
      : [],
    chat: {
      sessionId: typeof (record['chat'] as Record<string, unknown> | undefined)?.['sessionId'] === 'string'
        ? (record['chat'] as { sessionId: string }).sessionId
        : null,
    },
    cards,
    stats: {
      proposed: {
        accepted: count(proposedRaw?.['accepted']),
        rejected: count(proposedRaw?.['rejected']),
      },
      kindCounts: computeKindCounts(cards),
      lastActiveAt: typeof statsRaw?.['lastActiveAt'] === 'string' ? statsRaw['lastActiveAt'] : now,
    },
    archivedAt: typeof record['archivedAt'] === 'string' ? record['archivedAt'] : null,
    createdAt: typeof record['createdAt'] === 'string' ? record['createdAt'] : now,
    updatedAt: typeof record['updatedAt'] === 'string' ? record['updatedAt'] : now,
  }
}

/* ---------------------------------------------------- board wire payloads */

/** Every canvas the deployment holds, as list rows. */
export interface BoardListResult {
  readonly items: readonly CanvasSummary[]
}

/** Create a canvas (a topic, optionally with workspaces attached). */
export interface BoardCreateRequest {
  readonly title: string
  readonly attachedWorkspaces?: readonly string[]
}

/** Read one board with the freshness token a later mutation must present. */
export interface BoardReadRequest {
  readonly canvasId: string
}

/** A board and the freshness token its file carried. */
export interface BoardReadResult {
  readonly board: CanvasBoard
  readonly version: string
}

/** A board read either returns the board or reports one shared error code. */
export type BoardReadOutcome =
  | ({ readonly ok: true } & BoardReadResult)
  | { readonly ok: false; readonly error: CanvasError }

/** Add one user card (createdBy user, straight to kept — the board's CRUD). */
export interface BoardPutCardRequest {
  readonly canvasId: string
  readonly kind: BoardCardKind
  readonly text: string
  readonly source?: BoardCardSource
}

/** Edit one card: text, a status transition, or a question-state transition. */
export interface BoardPatchCardRequest {
  readonly canvasId: string
  readonly cardId: string
  readonly text?: string
  readonly status?: BoardCardStatus
  readonly question?: { state: QuestionState }
}

/** Comment on one card. */
export interface BoardAddCommentRequest {
  readonly canvasId: string
  readonly cardId: string
  readonly text: string
  /** Defaults to `user`; the host-side agent path (M3) passes `agent`. */
  readonly author?: 'user' | 'agent'
}

/** Archive a canvas from the space list, or restore it (never a delete). */
export interface BoardArchiveRequest {
  readonly canvasId: string
  readonly archived: boolean
}

/** Import one workspace's v1 pad (`<workspace>/灵感画布/`) as a new canvas. */
export interface BoardImportV1Request {
  /** Absolute workspace root whose v1 pad is read (read-only — never modified). */
  readonly dir: string
  /** Canvas title; defaults to `导入：<workspace directory name>`. */
  readonly title?: string
}

/** A mutation either lands (with the fresh board and its new token) or reports a code. */
export type BoardMutationResult =
  | ({ readonly ok: true } & BoardReadResult)
  | { readonly ok: false; readonly error: CanvasError }

/** The import gesture's receipt: the new canvas plus how many items came over. */
export type BoardImportResult =
  | ({ readonly ok: true } & BoardReadResult & { readonly imported: number })
  | { readonly ok: false; readonly error: CanvasError }
