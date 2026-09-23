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

/**
 * Longest accepted card text, in code units. Cards are small by design — but
 * "paste a whole document in to read it" is a core scene, and a silent 8000
 * cut was data loss (a pasted HTML document lost its tail). 256KB per card
 * keeps canvas.json's whole-board reads/writes in the milliseconds even with
 * dozens of big cards; the real `assets/` pointer-out is M4's.
 */
export const MAX_CARD_TEXT_LENGTH = 256_000

/** Longest accepted comment text, in code units. */
export const MAX_COMMENT_TEXT_LENGTH = 4000

/** Whether a value is one of the five content card kinds. */
export function isBoardCardKind(value: unknown): value is BoardCardKind {
  return typeof value === 'string' && (BOARD_CARD_KINDS as readonly string[]).includes(value)
}

/* --------------------------------------------------------------- categories */

/**
 * One card's category. Since stage ⑤ a canvas owns its catalog, so this is a
 * category id rather than the closed five: `fragment`…`document` are always in
 * it, a custom id is `cat_…`. Behavior that only the built-ins get (the
 * question lifecycle, the document heading) still switches on `BoardCardKind`,
 * never on this.
 */
export type CardCategoryId = string

/** Longest accepted category label, in code units (a chip's worth of words). */
export const MAX_CATEGORY_LABEL_LENGTH = 24

/** The prefix every custom category id carries, so none can shadow a built-in. */
export const CUSTOM_CATEGORY_ID_PREFIX = 'cat_'

/** Whether a value is a usable category id: one of the built-ins, or a custom one. */
export function isCardCategoryId(value: unknown): value is CardCategoryId {
  if (typeof value !== 'string') return false
  return isBoardCardKind(value)
    || new RegExp(`^${CUSTOM_CATEGORY_ID_PREFIX}[a-z0-9]{9,32}$`).test(value)
}

/** One row of a canvas's category catalog. */
export interface BoardCategory {
  readonly id: CardCategoryId
  /**
   * The label as the operator typed it. Empty means "show the built-in's
   * localized name" — only built-ins can be empty, so switching the host
   * language still renames 「灵感」→"Fragment" until the user overwrites it.
   */
  label: string
  /** Sort key for the chip strip; gaps are fine, the read re-sorts by it. */
  order: number
  /**
   * False hides the chip and refuses new cards, but never hides the cards
   * already filed under it — that is what makes retiring a category a
   * reversible act (the alternative was dropping a card's whole row).
   */
  enabled: boolean
}

/** The catalog a canvas starts with: the five built-ins, unrenamed, all on. */
export function defaultCategories(): BoardCategory[] {
  return BOARD_CARD_KINDS.map((kind, index) => ({
    id: kind,
    label: '',
    order: (index + 1) * 10,
    enabled: true,
  }))
}

/**
 * Turn operator input into a usable category label, or undefined when nothing
 * usable is left. A label is display text on a chip, not a file name.
 * @param raw - whatever the operator typed.
 * @returns the sanitized label, or undefined when it is empty.
 */
export function sanitizeCategoryLabel(raw: string): string | undefined {
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (cleaned.length === 0) return undefined
  return cleaned.slice(0, MAX_CATEGORY_LABEL_LENGTH)
}

/**
 * Read an untrusted `categories[]` into a catalog. Tolerant like every other
 * board read, with two guarantees: the five built-ins are always present (a
 * card whose kind was hand-deleted must still load), and every row is unique
 * by id and sorted by `order`.
 * @param raw - the parsed `categories` field.
 * @returns the catalog, built-ins first when the file carried none of them.
 */
export function normalizeCategories(raw: unknown): BoardCategory[] {
  const rows = Array.isArray(raw) ? raw : []
  const byId = new Map<CardCategoryId, BoardCategory>()
  let slot = 0
  for (const entry of rows) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    if (!isCardCategoryId(record['id'])) continue
    if (byId.has(record['id'])) continue
    const label = typeof record['label'] === 'string' ? record['label'] : ''
    byId.set(record['id'], {
      id: record['id'],
      // A custom row with no label is unusable on screen; fall back to its id.
      label: label === '' && !isBoardCardKind(record['id']) ? record['id'] : label.slice(0, MAX_CATEGORY_LABEL_LENGTH),
      order: typeof record['order'] === 'number' && Number.isFinite(record['order'])
        ? Math.floor(record['order'])
        : (slot += 1) * 10,
      enabled: record['enabled'] !== false,
    })
  }
  for (const kind of BOARD_CARD_KINDS) {
    if (byId.has(kind)) continue
    // The built-in's own default slot, not 0: a legacy file with no
    // `categories` at all must come back in the chip order the board was
    // designed with (灵感 问题 共识 来源 文档), not alphabetically.
    byId.set(kind, { id: kind, label: '', order: (BOARD_CARD_KINDS.indexOf(kind) + 1) * 10, enabled: true })
  }
  const merged = [...byId.values()]
  merged.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  return merged
}

/**
 * File the cards that outlived their catalog. A custom category row can go
 * missing from a hand-edited file while cards still carry its id — dropping
 * those cards is data loss, so the row comes back instead, last in the strip,
 * named after its own id and free to rename or retire from there.
 * @param categories - the catalog as read.
 * @param kinds - every kind the cards on this board carry.
 * @returns the same array when nothing was missing, otherwise a new one.
 */
export function reconcileCategories(
  categories: readonly BoardCategory[],
  kinds: Iterable<CardCategoryId>,
): BoardCategory[] {
  const known = new Set(categories.map(category => category.id))
  let last = categories.reduce((max, category) => Math.max(max, category.order), 0)
  const extra: BoardCategory[] = []
  for (const kind of kinds) {
    if (known.has(kind) || !isCardCategoryId(kind)) continue
    known.add(kind)
    last += 10
    extra.push({ id: kind, label: isBoardCardKind(kind) ? '' : kind, order: last, enabled: true })
  }
  return extra.length === 0 ? [...categories] : [...categories, ...extra]
}

/** The catalog's enabled rows, in strip order. */
export function enabledCategories(categories: readonly BoardCategory[]): BoardCategory[] {
  return categories.filter(category => category.enabled)
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
 * @param prefix - `canvas`, `c` (card), `m` (comment), `cat` (category row) or
 * `lane` (a link-view container — only the client ever creates one, so it mints
 * the id the rename gesture later refers back to).
 * @param timeMs - milliseconds since the epoch.
 * @param random - lowercase base36 randomness (host supplies `node:crypto`).
 * @returns the id.
 */
export function makeBoardId(prefix: 'canvas' | 'c' | 'm' | 'cat' | 'lane', timeMs: number, random: string): string {
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

/* --------------------------------------------------- freehand drawing (§11.3) */

/**
 * The drawing's LOGICAL box: every stored point lives inside it, whatever the
 * pad's on-screen width. Device-independent units are the whole point — a
 * stroke drawn in a 378px sidebar must still land in the same place when the
 * panel is wide, so the pad maps pointer pixels into this box on the way in and
 * the renderer scales the box back out with one `viewBox` (§11.3's "存归一化
 * 坐标这条不变").
 */
export const DRAW_BOX = { width: 600, height: 400 } as const

/** Most strokes one card holds. A drawing is a note, not a sketchbook. */
export const MAX_DRAW_STROKES = 60

/** Most sampled points in one stroke (the pad samples by distance, not count). */
export const MAX_DRAW_POINTS = 120

/** Widest a pen half-width may be, in the logical box's units. */
export const MAX_DRAW_WIDTH = 14

/** One sampled point: box units, plus the pen's half-width at that instant. */
export interface CanvasDrawPoint {
  readonly x: number
  readonly y: number
  readonly w: number
}

/**
 * Which token a stroke inks with. Deliberately NOT a colour: a drawing must
 * follow the theme the way every other surface here does, so the renderer owns
 * the mapping and the card stores the intent.
 */
export type CanvasStrokeColor = 'ink' | 'faint'

/** One unbroken stroke: the sampled points, in the order they were drawn. */
export interface CanvasStroke {
  readonly pts: readonly CanvasDrawPoint[]
  readonly color: CanvasStrokeColor
}

/** Whether a value is a stroke colour the renderer knows how to ink. */
export function isCanvasStrokeColor(value: unknown): value is CanvasStrokeColor {
  return value === 'ink' || value === 'faint'
}

/** One finite number inside `[min, max]`, or undefined (never a rounded guess). */
function boxNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(max, Math.max(min, value))
}

/**
 * Read an untrusted drawing into the strokes this package can actually draw.
 * Per-entry problems drop that entry; the rest survive, because a hand-edited
 * `canvas.json` must never make a card unreadable (§11.3's per-field rule).
 * A stroke needs two points to be a line, and a point is kept only with a
 * finite coordinate pair and a positive width.
 * @param raw - a `draw` value from a file or a wire request.
 * @returns at most {@link MAX_DRAW_STROKES} well-formed strokes.
 */
export function normalizeDraw(raw: unknown): CanvasStroke[] {
  if (!Array.isArray(raw)) return []
  const strokes: CanvasStroke[] = []
  for (const entry of raw as unknown[]) {
    if (strokes.length >= MAX_DRAW_STROKES) break
    if (typeof entry !== 'object' || entry === null) continue
    const points = (entry as Record<string, unknown>)['pts']
    const color = (entry as Record<string, unknown>)['color']
    if (!Array.isArray(points)) continue
    const pts: CanvasDrawPoint[] = []
    for (const item of points as unknown[]) {
      if (pts.length >= MAX_DRAW_POINTS) break
      if (typeof item !== 'object' || item === null) continue
      const point = item as Record<string, unknown>
      const x = boxNumber(point['x'], 0, DRAW_BOX.width)
      const y = boxNumber(point['y'], 0, DRAW_BOX.height)
      const w = boxNumber(point['w'], 0.5, MAX_DRAW_WIDTH)
      if (x === undefined || y === undefined || w === undefined) continue
      pts.push({ x, y, w })
    }
    if (pts.length < 2) continue
    strokes.push({ pts, color: isCanvasStrokeColor(color) ? color : 'ink' })
  }
  return strokes
}

/* ------------------------------------------------------------- board layout (§11.3) */

/**
 * The unit a board lays itself out in — {@link DRAW_BOX} under its other name,
 * because the link view and the pen share one frame (§11.3). It is a UNIT and
 * not a viewport: the link view pans, so a card parked at `x: 900` is legal
 * even though it is past the frame's right edge. What must never happen is a
 * stored screen pixel, which would put every card in the wrong place the next
 * time the panel is a different width.
 */
export const LAYOUT_BOX = DRAW_BOX

/** Longest accepted lane title, in code units (a lane header's worth of words). */
export const MAX_LANE_LABEL_LENGTH = 24

/** Most lines one board holds. */
export const MAX_BOARD_LINKS = 400

/** Most lanes one board holds. */
export const MAX_BOARD_LANES = 40

/** Smallest lane a resize may leave, in layout units — below it the title stops fitting. */
export const MIN_LANE_SIZE = { width: 150, height: 80 } as const

/**
 * One line between two cards. There is no direction to store: the line reads
 * both ways on screen, and giving it one is a later stage's question, not this
 * field's.
 */
export interface BoardLink {
  readonly from: string
  readonly to: string
}

/** One lane: a titled box, and the cards parked inside it belong to it. */
export interface BoardLane {
  readonly id: string
  /** May be empty — the client then shows its own placeholder; words are not this layer's job. */
  readonly label: string
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** One card's place on the board, as a layout write carries it. */
export interface BoardCardPosition {
  readonly id: string
  readonly x: number
  readonly y: number
}

/**
 * One finite layout number as a whole unit (a drag's sub-pixel jitter is not
 * worth a decimal place, and the state file is meant to read like text), or
 * undefined. Deliberately NOT clamped into the frame — see {@link LAYOUT_BOX}.
 */
function layoutNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.round(Math.min(1_000_000, Math.max(-1_000_000, value)))
}

/** A lane title as display text: control codes and runs of space folded, then capped. */
function laneLabelOf(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_LANE_LABEL_LENGTH)
}

/** The key a line is deduplicated by: `{a,b}` and `{b,a}` are the same line. */
function linkKey(from: string, to: string): string {
  return from < to ? `${from} ${to}` : `${to} ${from}`
}

/**
 * Read an untrusted `lanes[]`. A row needs a usable id and finite geometry; the
 * rectangle's floor is {@link MIN_LANE_SIZE} because a lane whose title no
 * longer fits is not a lane. Junk rows drop out and the rest survive — the
 * board's per-field tolerance, so a hand-edited file never makes a canvas
 * unopenable.
 * @param raw - the parsed `lanes` field, or a request's desired lanes.
 * @returns at most {@link MAX_BOARD_LANES} well-formed, id-unique lanes.
 */
export function normalizeLanes(raw: unknown): BoardLane[] {
  if (!Array.isArray(raw)) return []
  const lanes: BoardLane[] = []
  const seen = new Set<string>()
  for (const entry of raw as unknown[]) {
    if (lanes.length >= MAX_BOARD_LANES) break
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const id = record['id']
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue
    const x = layoutNumber(record['x'])
    const y = layoutNumber(record['y'])
    const w = layoutNumber(record['w'])
    const h = layoutNumber(record['h'])
    if (x === undefined || y === undefined || w === undefined || h === undefined) continue
    seen.add(id)
    lanes.push({
      id,
      label: laneLabelOf(record['label']),
      x,
      y,
      w: Math.max(MIN_LANE_SIZE.width, w),
      h: Math.max(MIN_LANE_SIZE.height, h),
    })
  }
  return lanes
}

/**
 * Read an untrusted `links[]`. Both ends must name a card this board holds: a
 * line to a card that is not there would be drawn to nowhere, and dropping it
 * loses nothing but the line. One unordered pair is kept once — dragging the
 * same two cards together twice is one line, not two.
 * @param raw - the parsed `links` field, or a request's desired links.
 * @param cardIds - every card id the board has (archived ones count: hiding a
 * card is not deleting it, and its lines should come back when it is restored).
 * @returns at most {@link MAX_BOARD_LINKS} well-formed lines.
 */
export function normalizeLinks(raw: unknown, cardIds: Iterable<string>): BoardLink[] {
  if (!Array.isArray(raw)) return []
  const known = new Set(cardIds)
  const links: BoardLink[] = []
  const seen = new Set<string>()
  for (const entry of raw as unknown[]) {
    if (links.length >= MAX_BOARD_LINKS) break
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const from = record['from']
    const to = record['to']
    if (typeof from !== 'string' || typeof to !== 'string') continue
    if (from === to || !known.has(from) || !known.has(to)) continue
    const key = linkKey(from, to)
    if (seen.has(key)) continue
    seen.add(key)
    links.push({ from, to })
  }
  return links
}

/**
 * Read an untrusted `positions[]` — the drag payload of a layout write. A row
 * needs a card id and a complete, finite pair; one card is written once (first
 * row wins) so a caller cannot fight itself over the same card. Which ids the
 * board actually has is the store's question, not this read's.
 * @param raw - the request's `positions` field.
 * @returns the well-formed placements, deduplicated by card id.
 */
export function normalizePositions(raw: unknown): BoardCardPosition[] {
  if (!Array.isArray(raw)) return []
  const positions: BoardCardPosition[] = []
  const seen = new Set<string>()
  for (const entry of raw as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const id = record['id']
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue
    const x = layoutNumber(record['x'])
    const y = layoutNumber(record['y'])
    if (x === undefined || y === undefined) continue
    seen.add(id)
    positions.push({ id, x, y })
  }
  return positions
}

/** One board card. */
export interface BoardCard {
  readonly id: string
  /** The category this card is filed under (a catalog id, stage ⑤). */
  kind: CardCategoryId
  text: string
  source?: BoardCardSource
  status: BoardCardStatus
  /** Present only on question cards. */
  question?: { state: QuestionState }
  comments: BoardComment[]
  /** The card's drawing, absent when nothing was ever inked (§11.4's field). */
  draw?: CanvasStroke[]
  /**
   * Where the card sits in the link view ({@link LAYOUT_BOX} units). Absent
   * until it is placed: the 卡板 flows cards by document order, so a board
   * nobody has arranged yet carries no numbers here at all. Stored as a PAIR —
   * half a position is not a place, so the read drops one without the other.
   */
  x?: number
  y?: number
  readonly createdBy: 'user' | 'agent'
  readonly createdAt: string
  updatedAt: string
}

/** The board's self-tuning counters (the rules that read them stay visible). */
export interface CanvasStats {
  proposed: { accepted: number; rejected: number }
  /** Non-archived card counts by category id (kept + proposed — what the board shows). */
  kindCounts: Record<CardCategoryId, number>
  lastActiveAt: string
}

/** One canvas's `canvas.json`: metadata plus every card plus the counters. */
export interface CanvasBoard {
  readonly id: string
  title: string
  attachedWorkspaces: string[]
  /** The single agent session this canvas owns; null until M2 creates it. */
  chat: { sessionId: string | null }
  /**
   * This canvas's category catalog (stage ⑤): the five built-ins plus whatever
   * the user added, in strip order. Read with defaults — a `canvas.json`
   * written before this field existed gets exactly the five.
   */
  categories: BoardCategory[]
  cards: BoardCard[]
  /**
   * The lines of the link view (stage ⑥). Read with defaults — a board written
   * before this field existed has no lines, which is exactly what the link view
   * shows: the cards, unconnected.
   */
  links: BoardLink[]
  /** This canvas's lanes (stage ⑥), same rule: absent in the file, empty here. */
  lanes: BoardLane[]
  stats: CanvasStats
  /** Set when the canvas is archived from the list; the directory is never deleted. */
  archivedAt: string | null
  readonly createdAt: string
  updatedAt: string
}

/** Recompute the visible kind counts from the card set (status !== archived). */
export function computeKindCounts(cards: readonly BoardCard[]): Record<CardCategoryId, number> {
  const counts: Record<CardCategoryId, number> = {}
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
  if (!isCardCategoryId(record['kind'])) return undefined
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
  const draw = normalizeDraw(record['draw'])
  if (draw.length > 0) card.draw = draw
  const x = layoutNumber(record['x'])
  const y = layoutNumber(record['y'])
  if (x !== undefined && y !== undefined) {
    card.x = x
    card.y = y
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
  const categories = reconcileCategories(
    normalizeCategories(record['categories']),
    cards.map(card => card.kind),
  )
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
    categories,
    links: normalizeLinks(record['links'], cards.map(card => card.id)),
    lanes: normalizeLanes(record['lanes']),
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

/**
 * Add one user card (createdBy user, straight to kept — the board's CRUD).
 * `text` may be empty only when the card carries a drawing: a picture is
 * content, not a missing caption (§11.4).
 */
export interface BoardPutCardRequest {
  readonly canvasId: string
  /** A category id from this canvas's catalog, enabled or the write is refused. */
  readonly kind: CardCategoryId
  readonly text: string
  readonly source?: BoardCardSource
  readonly draw?: readonly CanvasStroke[]
}

/**
 * Edit one card: text, its drawing, a status transition, or a question-state
 * transition. A `draw` of `[]` clears the drawing (absent leaves it alone) —
 * the two must stay distinguishable, or 「清空」 could never be saved.
 */
export interface BoardPatchCardRequest {
  readonly canvasId: string
  readonly cardId: string
  /** Refiles the card under another category (the batch bar's 「改分类」). */
  readonly kind?: CardCategoryId
  readonly text?: string
  readonly status?: BoardCardStatus
  readonly question?: { state: QuestionState }
  readonly draw?: readonly CanvasStroke[]
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

/**
 * Write this canvas's category catalog (stage ⑤): the whole desired list, in
 * strip order — rename, add and retire are all "here is the new catalog",
 * which keeps the verb as version-guarded as every other board write.
 * `archiveCardIds` rides along so retiring a category and filing away the
 * cards under it land in ONE rewrite; as two calls they could leave a retired
 * chip with live cards under it when the second one lost the version race.
 */
export interface BoardSetCategoriesRequest {
  readonly canvasId: string
  readonly categories: readonly BoardCategory[]
  readonly archiveCardIds?: readonly string[]
}

/**
 * Write the board's layout (stage ⑥): the places the caller dragged, the lanes
 * as they should read, the lines as they should be. Every field is optional and
 * **absent ≠ empty** — an omitted list is left alone, an empty one clears it —
 * the same discipline that makes a drawing's 「清空」 savable at all (§11.4).
 * One verb for the whole gesture because moving a lane moves the cards inside
 * it: as separate writes, a later one could lose the version race and leave a
 * lane with cards still parked at its old place.
 */
export interface BoardSetLayoutRequest {
  readonly canvasId: string
  readonly positions?: readonly BoardCardPosition[]
  readonly lanes?: readonly BoardLane[]
  readonly links?: readonly BoardLink[]
}

/** A mutation either lands (with the fresh board and its new token) or reports a code. */
export type BoardMutationResult =
  | ({ readonly ok: true } & BoardReadResult)
  | { readonly ok: false; readonly error: CanvasError }

/* ------------------------------------------------------------------ images (§10.3) */

/** The raster media types the host's attachment store admits. */
export const CANVAS_IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

/** One admitted media type. */
export type CanvasImageMediaType = (typeof CANVAS_IMAGE_MEDIA_TYPES)[number]

/** Whether a value is one of the four. */
export function isCanvasImageMediaType(value: unknown): value is CanvasImageMediaType {
  return typeof value === 'string' && (CANVAS_IMAGE_MEDIA_TYPES as readonly string[]).includes(value)
}

/**
 * The durable pointer to one stored image: exactly the five fields the host
 * re-derives and compares when it reads the object back, which is why a card
 * carries all five (§10.3's display arm) and never just an id.
 */
export interface CanvasImageRef {
  readonly attachmentId: string
  readonly mediaType: CanvasImageMediaType
  readonly bytes: number
  readonly width: number
  readonly height: number
}

/**
 * What the image arm can report, in the four shapes the user can act on. The
 * host's longer admission vocabulary folds into these at the store's boundary
 * — the client never sees a raw `AttachmentError` code.
 */
export type CanvasImageError =
  /** No attachment store is mounted (the whole arm degrades; text pastes still work). */
  | 'unavailable'
  /** The bytes are not one of the four raster types, or do not decode at all. */
  | 'not-image'
  /** Over the host's byte or pixel gates. */
  | 'too-large'
  /** The stored object is gone, or fails the digest check on read. */
  | 'unreadable'

/** Commit one pasted image to the host's attachment store. */
export interface BoardAttachImageRequest {
  /** Canonical base64 of the image bytes — they ride THIS request, never card text. */
  readonly data: string
  readonly mediaType: CanvasImageMediaType
  /** Browser display name; the host strips any path out of it. */
  readonly name?: string
}

/** An attach either returns the pointer to store in the card, or one image code. */
export type BoardAttachImageOutcome =
  | { readonly ok: true; readonly ref: CanvasImageRef }
  | { readonly ok: false; readonly error: CanvasImageError }

/** Fetch one stored image's bytes back for display (the resolver's read leg). */
export interface BoardImageBytesRequest {
  readonly ref: CanvasImageRef
}

/** A read either returns canonical base64, or one image code. */
export type BoardImageBytesOutcome =
  | { readonly ok: true; readonly data: string; readonly mediaType: CanvasImageMediaType }
  | { readonly ok: false; readonly error: CanvasImageError }


/* ------------------------------------------------------- summary heuristics */

/** A card summary is clamped at about this many lines (the CSS enforces it). */
export const SUMMARY_CLAMP_LINES = 6

/** A text longer than this always wears the long-card affordances (fade + count). */
export const SUMMARY_CLAMP_CHARS = 240

/** Longest derived document-card title, in code units. */
export const MAX_DOCUMENT_TITLE_LENGTH = 60

/**
 * Whether a card text is long enough that the summary clamp will actually
 * cut it — the driver for the fade and the word count (the board never
 * measures layout; the estimate is deliberately textual).
 * @param text - the card's full text.
 * @returns true when the clamp hides something.
 */
export function isLongCardText(text: string): boolean {
  if (text.length > SUMMARY_CLAMP_CHARS) return true
  let lines = 1
  for (const char of text) {
    if (char === '\n') lines += 1
    if (lines > SUMMARY_CLAMP_LINES) return true
  }
  return false
}

/** A document card's derived heading: the display title and the body that remains. */
export interface DocumentHeading {
  /** The first markdown heading's text, or the first non-empty line as-is. */
  readonly title: string
  /**
   * The text with the heading line removed (the summary does not repeat the
   * title); the whole text when the title came from the first line.
   */
  readonly body: string
}

/**
 * Derive a document card's display title: the first markdown heading when one
 * exists, otherwise the first non-empty line — never the raw document from
 * its `#` opener (the M1.5 acceptance complaint). When the title came from a
 * heading, that line leaves the body so the summary does not show it twice.
 * @param text - the document card's full text.
 * @returns the heading and the remaining body, or undefined for an empty text.
 */
export function documentHeadingOf(text: string): DocumentHeading | undefined {
  const lines = text.split('\n')
  let firstLine: string | undefined
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index]!.trim()
    if (trimmed.length === 0) continue
    if (firstLine === undefined) firstLine = trimmed
    const heading = /^#{1,6}\s+(\S.*)$/.exec(trimmed)
    if (heading !== null) {
      return {
        title: heading[1]!.trim().slice(0, MAX_DOCUMENT_TITLE_LENGTH),
        body: [...lines.slice(0, index), ...lines.slice(index + 1)].join('\n'),
      }
    }
  }
  if (firstLine === undefined) return undefined
  return { title: firstLine.slice(0, MAX_DOCUMENT_TITLE_LENGTH), body: text }
}

/* ============================================================================
 * The M2 chat integration (经 side-chat 插件): the lens vocabulary, the
 * askAgent / chatStatus wire payloads, and the agent-entrance card proposal.
 * The side-chat plugin itself is NEVER imported — the seam is a probed
 * service (`ctx.get('sideChat')`) plus this package's own wire.
 * ========================================================================= */

/** The lenses, in the order the lens bar offers them (§5's 预置 prompt 模板). */
export const CANVAS_LENS_IDS = [
  'challenge', 'counterexample', 'evidence', 'why', 'perspective', 'abstract', 'exemplify', 'ask',
] as const

/** One lens id; `ask` is the free-question lens (prime-only, no template send). */
export type CanvasLensId = (typeof CANVAS_LENS_IDS)[number]

/** Whether a value is one of the lens ids. */
export function isCanvasLensId(value: unknown): value is CanvasLensId {
  return typeof value === 'string' && (CANVAS_LENS_IDS as readonly string[]).includes(value)
}

/** One opaque ref chunk handed to the chat context (the side-chat ref protocol). */
export interface BoardRef {
  readonly label: string
  readonly text: string
}

/** Ask the canvas's agent (prime the chat context, and send when there is a text to send). */
export interface BoardAskAgentRequest {
  readonly canvasId: string
  /** The lens the gesture came through; absent for a free question. */
  readonly lens?: CanvasLensId
  /** Selected cards, folded into the context as opaque refs. */
  readonly cardIds?: readonly string[]
  /** Free text to send (a comment follow-up); present means an actual send. */
  readonly text?: string
  /** Extra opaque refs (the detail reader's text selection). */
  readonly refs?: readonly BoardRef[]
}

/** The chat seam's availability probe (the client hides every chat entry when absent). */
export interface BoardChatStatusResult {
  /** Whether a `sideChat`-shaped service answered the host's probe. */
  readonly available: boolean
}

/** The askAgent outcome: the context it primed and whether a message was sent. */
export type BoardAskAgentOutcome =
  | { readonly ok: true; readonly contextKey: string; readonly sent: boolean }
  | { readonly ok: false; readonly error: CanvasError | 'unavailable' }

/** The agent's card entrance (`canvas_propose_card`): proposed, awaiting the user's ✓/✗. */
export interface BoardProposeCardRequest {
  readonly canvasId: string
  /** A category id from this canvas's catalog (the tool's dynamic enum). */
  readonly kind: CardCategoryId
  readonly text: string
  readonly source?: BoardCardSource
  /** The proposal's rationale, hung on the card as an agent comment. */
  readonly comment?: string
}

/* --------------------------------------------------------------- focus */

/** Mark the canvas the session's tab has open (the main-session tools' target). */
export interface BoardFocusRequest {
  readonly canvasId: string
}

/** The focus gesture's receipt. */
export type BoardFocusResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: CanvasError }
