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
