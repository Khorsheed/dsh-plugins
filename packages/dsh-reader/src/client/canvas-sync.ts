/**
 * 「同步到画布」: a note (or a discussion note) becomes a kept card on a canvas
 * the reader picks.
 *
 * The canvas is another package. Its client provides `ctx.canvasInbox`
 * (`@khorsheed/dsh-canvas/client/inbox.ts`); this module mirrors that shape
 * structurally instead of importing it, and the pane hides the gesture when
 * the probe answers nothing. One direction only: the reader writes to the
 * canvas, the canvas never reaches back.
 *
 * The card carries its provenance as text (the article, the ¶, a link to the
 * original) because the canvas does not render a card's `source` field; the
 * structured `source` rides along for the model.
 *
 * @module @khorsheed/dsh-reader/client/canvas-sync
 */
import type { ReaderDiscussion, ReaderNote } from '../notes-types.ts'

/** One canvas a card can go to (the inbox's list row). */
export interface SyncCanvas {
  readonly id: string
  readonly title: string
  readonly cardCount: number
}

/** One category a card can be filed under. */
export interface SyncKind {
  readonly id: string
  readonly label: string
}

/** What putting a card answers. */
export type SyncOutcome =
  | { readonly ok: true; readonly cardId: string }
  | { readonly ok: false; readonly error: 'needs-kind'; readonly kinds: readonly SyncKind[] }
  | { readonly ok: false; readonly error: string }

/** The card source the canvas stores (its BoardCardSource). */
export interface SyncSource {
  readonly type: 'url' | 'paste'
  readonly ref: string
  readonly title?: string
}

/** The canvas inbox, as this package sees it. */
export interface CanvasInboxLike {
  current(): string | null
  listCanvases(): Promise<SyncCanvas[]>
  addCard(sessionId: string, request: { canvasId: string; text: string; kind?: string; source?: SyncSource }): Promise<SyncOutcome>
  openCard(canvasId: string, cardId: string): void
}

/** The article a card comes from. */
export interface SyncArticle {
  readonly title: string
  readonly url?: string
}

/** The localized words a card needs. */
export interface SyncWords {
  readonly conclusion: string
  readonly original: string
  readonly kindCheck: string
  readonly kindDiscussion: string
}

/** Where the last sync went, remembered per browser (a convenience only). */
const LAST_CANVAS_KEY = 'dsh-reader.lastCanvas'

/** The canvas the reader synced to last, when the browser remembers one. */
export function lastCanvas(): string | null {
  try {
    return globalThis.localStorage?.getItem(LAST_CANVAS_KEY) ?? null
  } catch {
    return null
  }
}

/** Remember the canvas the reader just synced to. */
export function rememberCanvas(canvasId: string): void {
  try {
    globalThis.localStorage?.setItem(LAST_CANVAS_KEY, canvasId)
  } catch {
    // A private window or blocked storage: the picker just preselects the first canvas.
  }
}

/** The provenance line every synced card ends with. */
function provenance(article: SyncArticle, words: SyncWords, para?: number): string {
  const where = `— 《${article.title}》${para === undefined ? '' : ` ¶${String(para)}`}`
  return article.url === undefined ? where : `${where} · [${words.original}](${article.url})`
}

/** The structured source the canvas keeps (the model reads it). */
export function sourceOf(article: SyncArticle): SyncSource {
  return article.url === undefined
    ? { type: 'paste', ref: article.title }
    : { type: 'url', ref: article.url, title: article.title }
}

/**
 * One note as card text: the excerpt (and its translation), the comment, the
 * conclusions under it when asked for, and where it came from.
 */
export function noteCardText(note: ReaderNote, article: SyncArticle, words: SyncWords, withReplies: boolean): string {
  const lines = note.anchor.quote.split('\n').map(line => `> ${line}`)
  if (note.anchor.translated !== undefined) lines.push(`> （${note.anchor.translated}）`)
  if (note.comment !== undefined) lines.push('', note.comment)
  if (withReplies) {
    for (const reply of note.replies ?? []) lines.push('', `${reply.by === 'agent' ? words.conclusion : ''}${reply.text}`)
  }
  lines.push('', provenance(article, words, note.anchor.block + 1))
  return lines.join('\n')
}

/** One discussion note as card text: its points (with ¶), the aside, where it came from. */
export function discussionCardText(discussion: ReaderDiscussion, article: SyncArticle, words: SyncWords): string {
  const head = `${discussion.kind === 'check' ? words.kindCheck : words.kindDiscussion}${discussion.title === '' ? '' : ` · ${discussion.title}`}`
  const lines = [head, '']
  for (const point of discussion.points) lines.push(`- ${point.text}${point.para === undefined ? '' : `（¶${String(point.para)}）`}`)
  if (discussion.aside !== undefined) lines.push('', discussion.aside)
  lines.push('', provenance(article, words))
  return lines.join('\n')
}
