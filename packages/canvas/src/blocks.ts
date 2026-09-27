/**
 * A card's body as a flow of blocks — words, drawings, images — and back.
 *
 * The card stays ONE markdown string (the agent reads it, the source pane
 * edits it, the board summarizes it). What makes the flow is a line that holds
 * nothing but a pointer: `![](draw://<id>)` places one of the card's drawings
 * there, and — for the editor — a line holding only an `attachment://` image
 * is that image's block. Everything else is words. A pointer inside a code
 * fence is code, not a block, so the scan tracks fences.
 *
 * A drawing the text does not place (a card from before drawings could sit
 * between paragraphs, or an agent rewrite that dropped the line) is still the
 * card's: it flows at the end, where the single drawing always was.
 *
 * Runtime-agnostic: no DOM, no node.
 *
 * @module @khorsheed/dsh-canvas
 */
import { isImageSrc } from './image-token.ts'
import { isDrawingId, LEGACY_DRAWING_ID, type CanvasStroke } from './types.ts'

/** The scheme a drawing's pointer carries. */
export const DRAW_SCHEME = 'draw://'

/** One block of a card's flow. `line` is the image's markdown, exactly as written. */
export type CardBlock =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'draw'; readonly id: string }
  | { readonly kind: 'image'; readonly line: string; readonly src: string }

/** A line that is one image and nothing else: `![alt](dest)`. */
const LONE_IMAGE = /^\s*!\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?\s*\)\s*$/

/** A code fence's opener or closer: three or more backticks or tildes. */
const FENCE = /^\s{0,3}(`{3,}|~{3,})/

/**
 * The line that places one drawing.
 * @param id - the drawing's id on the card.
 * @returns the markdown line.
 */
export function drawLineOf(id: string): string {
  return `![](${DRAW_SCHEME}${id})`
}

/**
 * Which drawing a destination names, if it is a drawing pointer at all.
 * @param src - an image destination.
 * @returns the drawing id, or undefined.
 */
export function drawIdOf(src: string): string | undefined {
  if (!src.startsWith(DRAW_SCHEME)) return undefined
  const id = src.slice(DRAW_SCHEME.length)
  return isDrawingId(id) ? id : undefined
}

/**
 * Split a card's text into its flow.
 * @param text - the card's markdown.
 * @param options - `images`: lift lone image lines into image blocks (the
 * editor wants them; the reader lets the markdown renderer draw them inline).
 * @returns the blocks in order; adjacent words are one text block, trimmed of
 * the blank lines at its edges, and a block of only blank lines is dropped.
 */
export function blocksOf(text: string, options: { readonly images?: boolean } = {}): CardBlock[] {
  const blocks: CardBlock[] = []
  let words: string[] = []
  let fence: string | undefined
  const flush = (): void => {
    const joined = words.join('\n').replace(/^\s*\n/, '').replace(/\n\s*$/, '')
    if (joined.trim().length > 0) blocks.push({ kind: 'text', text: joined })
    words = []
  }
  for (const line of text.split('\n')) {
    const opener = FENCE.exec(line)?.[1]
    if (fence !== undefined) {
      if (opener !== undefined && opener[0] === fence[0] && opener.length >= fence.length) fence = undefined
      words.push(line)
      continue
    }
    if (opener !== undefined) {
      fence = opener
      words.push(line)
      continue
    }
    const src = LONE_IMAGE.exec(line)?.[1]
    const drawId = src === undefined ? undefined : drawIdOf(src)
    if (drawId !== undefined) {
      flush()
      blocks.push({ kind: 'draw', id: drawId })
      continue
    }
    if (src !== undefined && options.images === true && isImageSrc(src)) {
      flush()
      blocks.push({ kind: 'image', line: line.trim(), src })
      continue
    }
    words.push(line)
  }
  flush()
  return blocks
}

/**
 * A card's whole flow: the text's blocks, plus every drawing the text does
 * not place, at the end (the legacy drawing first — it was always last).
 * A pointer to a drawing the card does not have drops out.
 * @param text - the card's markdown.
 * @param drawings - the card's drawings by id.
 * @param options - as {@link blocksOf}.
 * @returns the blocks in reading order, each drawing exactly once.
 */
export function cardBlocksOf(
  text: string,
  drawings: Readonly<Record<string, readonly CanvasStroke[]>> | undefined,
  options: { readonly images?: boolean } = {},
): CardBlock[] {
  const held = drawings ?? {}
  const placed = new Set<string>()
  const blocks = blocksOf(text, options).filter(block => {
    if (block.kind !== 'draw') return true
    if (held[block.id] === undefined || placed.has(block.id)) return false
    placed.add(block.id)
    return true
  })
  const rest = Object.keys(held)
    .filter(id => !placed.has(id))
    .sort((a, b) => Number(b === LEGACY_DRAWING_ID) - Number(a === LEGACY_DRAWING_ID))
  return [...blocks, ...rest.map(id => ({ kind: 'draw' as const, id }))]
}

/**
 * The text a flow saves as: blocks separated by one blank line, each drawing
 * placed by its pointer line.
 * @param blocks - the flow, in order.
 * @returns the card's markdown (empty text blocks drop out).
 */
export function textOfBlocks(blocks: readonly CardBlock[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    if (block.kind === 'text') {
      const trimmed = block.text.replace(/^\s*\n/, '').replace(/\s+$/, '')
      if (trimmed.trim().length > 0) parts.push(trimmed)
    } else if (block.kind === 'draw') {
      parts.push(drawLineOf(block.id))
    } else {
      parts.push(block.line)
    }
  }
  return parts.join('\n\n')
}

/**
 * A fresh drawing id, unused on this card.
 * @param taken - the ids the card already holds.
 * @returns `d1`, `d2`, … — the first free one.
 */
export function freshDrawingId(taken: Iterable<string>): string {
  const used = new Set(taken)
  let n = 1
  while (used.has(`d${n}`)) n += 1
  return `d${n}`
}

/**
 * The text with its drawing lines taken out — for readers that cannot draw
 * them (the board's summary, a quote into the conversation, a manuscript).
 * Fenced code is left alone.
 * @param text - the card's markdown.
 * @param mark - what stands in for one drawing; '' drops the line.
 * @returns the text without pointer lines.
 */
export function withoutDrawLines(text: string, mark = ''): string {
  let fence: string | undefined
  const kept: string[] = []
  for (const line of text.split('\n')) {
    const opener = FENCE.exec(line)?.[1]
    if (fence !== undefined) {
      if (opener !== undefined && opener[0] === fence[0] && opener.length >= fence.length) fence = undefined
      kept.push(line)
      continue
    }
    if (opener !== undefined) fence = opener
    const src = fence === undefined ? LONE_IMAGE.exec(line)?.[1] : undefined
    if (src !== undefined && drawIdOf(src) !== undefined) {
      if (mark !== '') kept.push(mark)
      continue
    }
    kept.push(line)
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * The drawing a card shows first — its thumbnail on the board and the link map.
 * @param text - the card's markdown.
 * @param drawings - the card's drawings by id.
 * @returns the strokes of the first drawing in reading order, or [] with none.
 */
export function firstDrawingOf(
  text: string,
  drawings: Readonly<Record<string, readonly CanvasStroke[]>> | undefined,
): readonly CanvasStroke[] {
  if (drawings === undefined) return []
  const first = cardBlocksOf(text, drawings).find(block => block.kind === 'draw')
  return first?.kind === 'draw' ? drawings[first.id] ?? [] : []
}
