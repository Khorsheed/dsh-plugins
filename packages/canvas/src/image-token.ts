/**
 * The one line a pasted image leaves in a card: a markdown image whose
 * destination is the durable pointer to the host's attachment store. Pixels
 * never enter card text (§10.3) — what is stored is the five fields the host
 * compares when it reads the object back, spelled so a person reading the
 * source pane recognizes the gesture.
 *
 * This module is the ONLY place that string is built or parsed, in either
 * face: an unparseable pointer renders as alt text and touches no network,
 * which is the whole of the safety story on the read side (risk ⑬ — the
 * attachment scheme is the single allowed destination, so no pasted
 * markdown ever becomes a request for a local file).
 *
 * Runtime-agnostic on purpose: no DOM, no node. Every helper here is pure
 * and unit-tested.
 *
 * @module @khorsheed/dsh-canvas
 */
import type { CanvasImageRef } from './types.ts'
import { isCanvasImageMediaType } from './types.ts'

/** The scheme one card-held image pointer carries. */
export const IMAGE_SCHEME = 'attachment://'

/** Longest accepted pointer, in code units — a hand-pasted wall of digits is refused, not parsed. */
export const MAX_IMAGE_SRC_LENGTH = 512

/** Longest alt text kept for one pasted image, in code units. */
export const MAX_IMAGE_ALT_LENGTH = 120

const ATTACHMENT_ID = /^sha256:([0-9a-f]{64})$/
const POSITIVE_INTEGER = /^[1-9][0-9]*$/
const FIELDS = ['mediaType', 'bytes', 'width', 'height'] as const

/** Parse one decimal field the host can compare, or refuse it. */
function integerOf(value: string | undefined): number | undefined {
  if (value === undefined || !POSITIVE_INTEGER.test(value) || value.length > 15) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

/**
 * Whether a markdown image destination is one of our pointers (the resolver's
 * first question, before any parsing).
 * @param src - the destination as the renderer read it.
 * @returns true when the `attachment://` scheme opens it.
 */
export function isImageSrc(src: string): boolean {
  return src.startsWith(IMAGE_SCHEME)
}

/**
 * Spell one stored image's pointer as a markdown destination: the id, then
 * the four fields the read leg re-derives, in canonical order.
 * @param ref - the reference the host returned when it stored the image.
 * @returns the destination string.
 */
export function imageSrcOf(ref: CanvasImageRef): string {
  return `${IMAGE_SCHEME}${ref.attachmentId}?mediaType=${ref.mediaType}`
    + `&bytes=${ref.bytes}&width=${ref.width}&height=${ref.height}`
}

/**
 * Read a markdown destination back into the reference the host validates, or
 * refuse it. Strict by construction: only the `attachment://` scheme, an id of
 * exactly the digest shape, and precisely the four fields (any order, no
 * duplicates, nothing extra, no fragment) parse. Everything else is
 * `undefined`, which leaves the image as alt text — a pointer from another
 * deployment, a hand-mangled one, and a hostile one are all the same case.
 * @param src - the destination as the renderer read it.
 * @returns the reference to fetch bytes for, or undefined.
 */
export function imageRefOf(src: string): CanvasImageRef | undefined {
  if (!isImageSrc(src) || src.length > MAX_IMAGE_SRC_LENGTH) return undefined
  const body = src.slice(IMAGE_SCHEME.length)
  const parts = body.split('?')
  if (parts.length !== 2) return undefined
  const [id, query] = [parts[0]!, parts[1]!]
  if (!ATTACHMENT_ID.test(id)) return undefined
  const fields = new Map<string, string>()
  for (const pair of query.split('&')) {
    const at = pair.indexOf('=')
    if (at <= 0 || fields.has(pair.slice(0, at))) return undefined
    fields.set(pair.slice(0, at), pair.slice(at + 1))
  }
  for (const field of FIELDS) {
    if (!fields.has(field)) return undefined
  }
  if (fields.size !== FIELDS.length) return undefined
  const mediaType = fields.get('mediaType')!
  if (!isCanvasImageMediaType(mediaType)) return undefined
  const bytes = integerOf(fields.get('bytes'))
  const width = integerOf(fields.get('width'))
  const height = integerOf(fields.get('height'))
  if (bytes === undefined || width === undefined || height === undefined) return undefined
  return { attachmentId: id, mediaType, bytes, width, height }
}

/**
 * The markdown line a pasted image adds to a card. The name is display-only
 * alt text: brackets and newlines would end the line early, so they go, and
 * it is capped.
 * @param ref - the pointer the host issued for the stored bytes.
 * @param name - the browser's display name for the file (may be '').
 * @returns the line to insert.
 */
export function imageMarkdownOf(ref: CanvasImageRef, name: string): string {
  const alt = name.replace(/[\r\n[\]]/g, ' ').trim().slice(0, MAX_IMAGE_ALT_LENGTH)
  return `![${alt}](${imageSrcOf(ref)})`
}

/**
 * The line a pasted image adds to an HTML card: the same pointer, spelled as
 * the tag that page's renderer understands. The `src` keeps the raw `&` the
 * markdown form uses — an attribute's ambiguous ampersand survives parsing
 * literally, and the read leg accepts either spelling.
 * @param ref - the pointer the host issued for the stored bytes.
 * @param name - the browser's display name for the file (may be '').
 * @returns the tag to insert.
 */
export function imageHtmlOf(ref: CanvasImageRef, name: string): string {
  const alt = name.replace(/[\r\n<>"&]/g, ' ').trim().slice(0, MAX_IMAGE_ALT_LENGTH)
  return `<img src="${imageSrcOf(ref)}" alt="${alt}">`
}
