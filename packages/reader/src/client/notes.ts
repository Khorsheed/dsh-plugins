/**
 * Notes in the browser: turning a selection into an excerpt, finding excerpts
 * again for the highlight, the article snapshot the model reads, and the draft
 * a discussion starts from.
 *
 * Everything here reads the DOM and never writes it. The article body is
 * `translate.ts`'s to decorate (it splits text nodes into sentence spans), so
 * a note highlight that wrapped text in `<mark>` would fight it on every view
 * switch. Highlights go through the CSS Custom Highlight API instead: ranges
 * over whatever text nodes are on screen, recomputed after each rebuild. A
 * browser without the API shows no highlight — the notes themselves still work.
 *
 * Blocks are the article's top-level children minus `translate.ts`'s reveals —
 * the reading position's unit (`articleBlocks` in the pane), so ¶n here, in the
 * snapshot, and in a note's anchor all mean the same paragraph.
 *
 * @module @khorsheed/dsh-reader/client/notes
 */
import type { ReaderNote, ReaderNoteAnchor } from '../notes-types.ts'
import type { BuiltArticle } from './translate.ts'
import { formatClock } from '../captions.ts'

type BuiltBlock = BuiltArticle['blocks'][number]
type BuiltSegment = BuiltBlock['segments'][number]

/** The highlight registry names (the pane's stylesheet paints them). */
export const NOTE_HIGHLIGHT = 'reader-note'
export const NOTE_FLASH_HIGHLIGHT = 'reader-note-flash'

/** Collapse whitespace the way stored excerpts are collapsed. */
export function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** True for a node `translate.ts` inserted (a reveal of original sentences). */
function isReveal(element: Element): boolean {
  return element.getAttribute('data-reader-reveal') === '1'
}

/** The article's blocks: top-level children, reveals excluded. */
export function blockElements(article: Element): HTMLElement[] {
  return [...article.children].filter(child => !isReveal(child)) as HTMLElement[]
}

/**
 * The block a node sits in, as an index into {@link blockElements}.
 *
 * A node inside a sibling-placed reveal belongs to the block the reveal
 * follows; one inside an inside-placed reveal is already inside its block.
 */
export function blockIndexOf(article: Element, node: Node): number {
  let current: Node | null = node
  while (current !== null && current.parentNode !== article) current = current.parentNode
  if (current === null || !(current instanceof Element)) return 0
  let block: Element | null = current
  while (block !== null && isReveal(block)) block = block.previousElementSibling
  if (block === null) return 0
  const index = blockElements(article).indexOf(block as HTMLElement)
  return index < 0 ? 0 : index
}

/** What a selection becomes before the reader adds a comment. */
export interface NoteSelection {
  readonly block: number
  readonly start?: number
  readonly quote: string
  readonly translated?: string
  /** A transcript paragraph's start (seconds), when the article is a transcript. */
  readonly time?: number
}

/** A transcript paragraph's start (`data-t`), when the block is one. */
function timeOf(element: Element | undefined): number | undefined {
  const value = element?.getAttribute('data-t')
  if (value === null || value === undefined) return undefined
  const seconds = Number(value)
  return Number.isFinite(seconds) ? seconds : undefined
}

/** The segments a range touches whose span shows a TRANSLATION right now. */
function translatedSegmentsIn(built: BuiltArticle, range: Range): BuiltSegment[] {
  if (built.view === 'orig') return []
  const touched: BuiltSegment[] = []
  for (const block of built.blocks) {
    for (const segment of block.segments) {
      if (segment.translated === null) continue
      if (segment.span.closest('[data-reader-reveal="1"]') !== null) continue
      if (range.intersectsNode(segment.span)) touched.push(segment)
    }
  }
  return touched
}

/**
 * Read the current selection as an excerpt of this article.
 *
 * Selected in the translated view, the excerpt is the ORIGINAL of every
 * sentence the selection touched, and the selected translation rides along —
 * the stored quote is always original text (decision D8). Selected in the
 * original (or in a reveal's original lines), the selection is the quote.
 *
 * @param article - the rendered article root.
 * @param built - the translation segmentation, when there is one.
 * @param selection - the selection to read (defaults to the window's).
 * @returns the excerpt, or `null` when nothing in this article is selected.
 */
export function captureSelection(
  article: Element,
  built: BuiltArticle | null,
  selection: Selection | null = typeof window === 'undefined' ? null : window.getSelection(),
): NoteSelection | null {
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  if (!article.contains(range.commonAncestorContainer)) return null
  const shown = normalizeText(selection.toString())
  if (shown.length === 0) return null
  const block = blockIndexOf(article, range.startContainer)
  const element = blockElements(article)[block]
  const time = timeOf(element)
  const timed = time === undefined ? {} : { time }
  if (built !== null) {
    const segments = translatedSegmentsIn(built, range)
    if (segments.length > 0) {
      return { block, quote: normalizeText(segments.map(segment => segment.original).join(' ')), translated: shown, ...timed }
    }
  }
  let start: number | undefined
  if (element !== undefined && element.contains(range.startContainer)) {
    const before = element.ownerDocument.createRange()
    before.setStart(element, 0)
    before.setEnd(range.startContainer, range.startOffset)
    start = normalizeText(before.toString()).length
  }
  return { block, ...(start === undefined ? {} : { start }), quote: shown, ...timed }
}

/**
 * The article's original prose, one string per block, for the host snapshot.
 *
 * Parsed from the stored markup rather than read off the screen: the screen may
 * be showing a translation, and the model must read what the author wrote.
 *
 * @param html - the article markup the pane renders.
 * @returns the blocks' text (a bare-text body is one block).
 */
export function paragraphsOf(html: string, speakerLabel?: (speaker: number) => string): string[] {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const root = doc.body.firstElementChild
  if (root === null) return []
  const children = [...root.children]
  if (children.length === 0) return [normalizeText(root.textContent ?? '')]
  // A transcript paragraph says when it is, and who spoke it: the model reads
  // ¶3 [24:05] 嘉宾：… — so a discussion never puts a view in the wrong mouth.
  return children.map(child => {
    const time = timeOf(child)
    const spk = child.getAttribute('data-spk')
    const text = normalizeText(child.textContent ?? '')
    const who = spk === null || speakerLabel === undefined ? '' : `${speakerLabel(Number(spk))}：`
    return time === undefined || text === '' ? text : `[${formatClock(time)}] ${who}${text}`
  })
}

/** One text position, for mapping a normalized offset back into the DOM. */
interface TextPoint {
  readonly node: Text
  readonly offset: number
}

/**
 * Find a normalized string inside an element's text, as a DOM Range.
 *
 * The text is flattened with whitespace collapsed (the stored quote's form),
 * keeping a map from each flattened character back to its node and offset.
 *
 * @param root - where to search.
 * @param needle - the normalized text to find.
 * @param skip - elements whose text does not count.
 * @returns the range, or `null`.
 */
export function findText(root: Element, needle: string, skip: (element: Element) => boolean = () => false): Range | null {
  if (needle.length === 0) return null
  const doc = root.ownerDocument
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */)
  let flat = ''
  const points: TextPoint[] = []
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const parent = node.parentElement
    if (parent !== null && parent !== root && skipped(parent, root, skip)) continue
    const value = node.nodeValue ?? ''
    for (let offset = 0; offset < value.length; offset++) {
      const ch = value[offset]!
      if (/\s/.test(ch)) {
        if (flat.length === 0 || flat.endsWith(' ')) continue
        flat += ' '
      } else {
        flat += ch
      }
      points.push({ node: node as Text, offset })
    }
  }
  const at = flat.indexOf(needle)
  if (at < 0) return null
  const first = points[at]
  const last = points[at + needle.length - 1]
  if (first === undefined || last === undefined) return null
  const range = doc.createRange()
  range.setStart(first.node, first.offset)
  range.setEnd(last.node, last.offset + 1)
  return range
}

/** True when an element (or an ancestor below root) is skipped. */
function skipped(element: Element, root: Element, skip: (element: Element) => boolean): boolean {
  for (let current: Element | null = element; current !== null && current !== root; current = current.parentElement) {
    if (skip(current)) return true
  }
  return false
}

/** True when two texts share content: one holds the other, or one runs into the other. */
export function overlaps(left: string, right: string, edge = 6): boolean {
  const a = normalizeText(left)
  const b = normalizeText(right)
  if (a.length === 0 || b.length === 0) return false
  if (a.includes(b) || b.includes(a)) return true
  const max = Math.min(a.length, b.length)
  for (let size = max; size >= edge; size--) {
    if (a.endsWith(b.slice(0, size)) || b.endsWith(a.slice(0, size))) return true
  }
  return false
}

/** The built block that renders one top-level block element. */
function builtBlockFor(built: BuiltArticle, element: Element): BuiltBlock[] {
  return built.blocks.filter(block => block.element === element || element.contains(block.element))
}

/** Ranges for one note inside one block element, in the view on screen. */
function rangesInBlock(element: HTMLElement, built: BuiltArticle | null, anchor: ReaderNoteAnchor): Range[] {
  const translated = built !== null && built.view !== 'orig'
    && built.blocks.some(block => block.segments.some(segment => segment.translated !== null))
  if (!translated || built === null) {
    const range = findText(element, anchor.quote, isReveal)
    return range === null ? [] : [range]
  }
  const ranges: Range[] = []
  for (const block of builtBlockFor(built, element)) {
    // The translated sentences: highlighted whole (the sentence is the unit
    // the translation is aligned on).
    for (const segment of block.segments) {
      if (segment.translated === null || !overlaps(segment.original, anchor.quote)) continue
      const range = element.ownerDocument.createRange()
      range.selectNodeContents(segment.span)
      ranges.push(range)
    }
    // The originals shown beside them (side-by-side view, or an opened sentence).
    if (block.reveal !== null) {
      const range = findText(block.reveal, anchor.quote)
      if (range !== null) ranges.push(range)
    }
  }
  return ranges
}

/**
 * Where each note is on screen right now.
 *
 * The anchored block is tried first; when the excerpt is not there (the
 * article was refetched and moved), every block is searched. A note found
 * nowhere maps to an empty list — the notes view says so.
 *
 * @param article - the rendered article root.
 * @param built - the translation segmentation, when there is one.
 * @param notes - the article's notes.
 */
export function noteRanges(article: Element, built: BuiltArticle | null, notes: readonly ReaderNote[]): Map<string, Range[]> {
  const blocks = blockElements(article)
  const found = new Map<string, Range[]>()
  for (const note of notes) {
    const hinted = blocks[note.anchor.block]
    let ranges = hinted === undefined ? [] : rangesInBlock(hinted, built, note.anchor)
    if (ranges.length === 0) {
      for (const block of blocks) {
        if (block === hinted) continue
        ranges = rangesInBlock(block, built, note.anchor)
        if (ranges.length > 0) break
      }
    }
    found.set(note.id, ranges)
  }
  return found
}

/** The highlight registry, when the browser has one. */
function registry(): { set(name: string, value: unknown): void; delete(name: string): void } | undefined {
  const highlights = (globalThis as { CSS?: { highlights?: unknown } }).CSS?.highlights
  const Highlight = (globalThis as { Highlight?: unknown }).Highlight
  if (highlights === undefined || typeof Highlight !== 'function') return undefined
  return highlights as { set(name: string, value: unknown): void; delete(name: string): void }
}

/**
 * Paint (or clear) one named highlight.
 *
 * @param name - the registry name.
 * @param ranges - the ranges to paint; empty clears it.
 */
export function paintHighlight(name: string, ranges: readonly Range[]): void {
  const highlights = registry()
  if (highlights === undefined) return
  if (ranges.length === 0) {
    highlights.delete(name)
    return
  }
  const Highlight = (globalThis as unknown as { Highlight: new (...ranges: Range[]) => unknown }).Highlight
  highlights.set(name, new Highlight(...ranges))
}

/** The article identity a discussion draft names. */
export interface NotesDraftSource {
  readonly entryId: string
  readonly title: string
  readonly source: string
  readonly link?: string
}

/** The localized words a draft needs. */
export interface NotesDraftWords {
  readonly heading: (count: number) => string
  readonly comment: string
  readonly hint: (entryId: string) => string
}

/**
 * The discussion draft: the article, then each note as a quote with its comment.
 *
 * Notes carry their ¶ and id so the model can match them to `reader_read`'s
 * output; the closing hint names the article id for the same reason.
 *
 * @param source - the article.
 * @param notes - the notes to bring, in article order.
 * @param words - the localized fragments.
 */
export function formatNotesDraft(source: NotesDraftSource, notes: readonly ReaderNote[], words: NotesDraftWords): string {
  const lines: string[] = [words.heading(notes.length), '']
  for (const note of notes) {
    lines.push(`> ${note.id} ¶${String(note.anchor.block + 1)}${note.anchor.time === undefined ? '' : ` [${formatClock(note.anchor.time)}]`}「${note.anchor.quote}」`)
    if (note.anchor.translated !== undefined) lines.push(`> （${note.anchor.translated}）`)
    if (note.comment !== undefined) {
      for (const [index, line] of note.comment.split('\n').entries()) {
        lines.push(index === 0 ? `> ${words.comment}${line}` : `> ${line}`)
      }
    }
    lines.push('')
  }
  const attribution = [`— 《${source.title}》`, source.source].filter(part => part.length > 0).join(' · ')
  lines.push(attribution)
  if (source.link !== undefined) lines.push(source.link)
  lines.push(words.hint(source.entryId))
  return lines.join('\n')
}

/**
 * Where a quote-menu「记笔记」lands.
 *
 * The quote menu lives in another package and hands its actions only the
 * selected text; the pane that owns the selected article is found here, by
 * asking each mounted pane whether the selection is inside its article.
 */
export interface NoteTarget {
  /** True when this pane's article holds the node. */
  readonly owns: (node: Node) => boolean
  /** Open the note sheet for the current selection. */
  readonly start: () => void
}

const TARGETS = new Set<NoteTarget>()

/** Register a pane as a note target; returns the disposer. */
export function registerNoteTarget(target: NoteTarget): () => void {
  TARGETS.add(target)
  return () => { TARGETS.delete(target) }
}

/** The pane whose article holds the current selection, when one does. */
export function noteTargetForSelection(selection: Selection | null = typeof window === 'undefined' ? null : window.getSelection()): NoteTarget | undefined {
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return undefined
  const node = selection.getRangeAt(0).commonAncestorContainer
  for (const target of TARGETS) {
    if (target.owns(node)) return target
  }
  return undefined
}
