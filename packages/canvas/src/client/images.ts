/**
 * The image read leg (§10.3): a card holds an `attachment://` pointer, the
 * pixels live in the host's attachment store, and this is the one client
 * object that turns a pointer into something an `<img>` can load.
 *
 * A read is asynchronous while the host's markdown renderer resolves image
 * destinations SYNCHRONOUSLY, so the object is a cache with a small feed:
 * `resolve` answers from what it holds and starts a read for what it does not,
 * and when a read lands the feed's number moves. The tab reads that feed once
 * (`useImageRev`) and hands a fresh-identity `pathImages` down, which is what
 * re-runs the memoized markdown render and rebuilds an HTML card's document.
 *
 * The displayable form is a `data:` URL built from the base64 the Remote
 * returned — deliberately not a blob object URL. An object URL is a lifecycle
 * this package would have to own (revoke on eviction, never leak one per
 * render), while the base64 string is already in hand: eviction is a plain map
 * delete, and both renderers take the scheme (the card CSP allows
 * `img-src data:`).
 *
 * @module @khorsheed/dsh-canvas/client
 */
import type { MarkdownPathImages } from '@deepseek-ai/dsh-client-ui-primitives'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { isCanvasImageMediaType } from '../types.ts'
import type {
  BoardImageBytesOutcome, CanvasImageMediaType, CanvasImageRef,
} from '../types.ts'
import { imageRefOf, isImageSrc } from '../image-token.ts'

/** Pointers held before the oldest is dropped (each entry is one image's base64). */
export const MAX_CACHED_IMAGES = 24

/** One image file on the clipboard with the media type the store is told about. */
export interface CanvasImageFile {
  readonly file: File
  readonly mediaType: CanvasImageMediaType
}

/** What the cache reads through: the Remote's read leg, unwrapped. */
export type CanvasImageReader = (ref: CanvasImageRef) => Promise<RemoteResult<BoardImageBytesOutcome>>

/** The read-landed feed (`useImageRev`): a bump means one more pointer has bytes. */
export type CanvasImageRevSource = SnapshotStore<number>

/**
 * The clipboard files this arm can store, in clipboard order. The media type is
 * the DECLARATION — the host re-derives the real one from the decoded bytes and
 * refuses a mismatch, so an unknown type is dropped here rather than sent.
 * @param files - a paste event's file list (undefined with a bare text paste).
 * @returns the admitted pairs; empty when nothing here is an image.
 */
export function imageFilesOf(files: ArrayLike<File> | undefined): CanvasImageFile[] {
  const admitted: CanvasImageFile[] = []
  if (files === undefined) return admitted
  for (const file of Array.from(files)) {
    if (isCanvasImageMediaType(file.type)) admitted.push({ file, mediaType: file.type })
  }
  return admitted
}

/**
 * Read one file's bytes as canonical base64 — the wire form the host decodes
 * before it stores anything. A data URL is the browser's own base64 reader;
 * only its prefix is discarded.
 * @param file - the clipboard file.
 * @returns base64 without the `data:…;base64,` prefix ('' when the read fails).
 */
export function base64Of(file: Blob): Promise<string> {
  return new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : ''
      const comma = url.indexOf(',')
      resolve(comma < 0 ? '' : url.slice(comma + 1))
    }
    // A failed read is an empty payload: the host refuses zero bytes as
    // "not an image", which is the same news the user would get.
    reader.onerror = () => { resolve('') }
    reader.readAsDataURL(file)
  })
}

/**
 * One HTML `<img>` source attribute: its opening boundary, the name, the gap
 * before `=`, and the value in any of the three quotings. `=` is legal inside
 * an unquoted value (and a pointer's query shape is full of them), so only the
 * characters HTML itself forbids there end one.
 */
const IMAGE_SRC_ATTR = /(^|[\s<(])(src)(\s*)=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`<>]+))/gi

/**
 * Rewrite the image sources a card can only reach through the attachment store
 * (§10.3's HTML arm; risk ⑬'s whitelist made literal). Everything the resolver
 * does not answer for stays byte-identical, so a page with its own remote or
 * relative images is passed through untouched — including a pointer from
 * another deployment, which never parses and so never becomes a request.
 * @param html - the card's HTML, as authored.
 * @param resolve - one authored destination → a displayable URL, or undefined.
 * @returns the same document with the resolvable `attachment://` sources inlined.
 */
export function rewriteImageSrcs(html: string, resolve: (src: string) => string | undefined): string {
  return html.replace(IMAGE_SRC_ATTR, (whole, before: string, name: string, gap: string, double?: string, single?: string, bare?: string) => {
    // An HTML author escapes the pointer's separators; the strict parser does not.
    const authored = (double ?? single ?? bare ?? '').replace(/&amp;/gi, '&')
    if (!isImageSrc(authored)) return whole
    const url = resolve(authored)
    return url === undefined ? whole : `${before}${name}${gap}="${url}"`
  })
}

/**
 * The pointer cache: `pathImages` for the markdown renderer, the HTML rewriter
 * for the sandboxed frame, and the feed that says a read has landed. Reads
 * that fail are remembered too, so a dead pointer is asked for once and then
 * left as alt text.
 */
export class CanvasImageSrcs {
  /** The published feed (the tab's face hands it to the slot runtime as `hooks.imageRev`). */
  readonly source: CanvasImageRevSource = createSnapshotStore<number>(0)

  /** src → displayable URL, `null` when its read failed; insertion order is the LRU order. */
  private readonly held = new Map<string, string | null>()

  /** srcs whose read is in flight (never a second one for the same pointer). */
  private readonly reading = new Set<string>()

  private readonly read: CanvasImageReader

  constructor(read: CanvasImageReader) {
    this.read = read
  }

  /**
   * Resolve one authored image destination (the renderer's synchronous question).
   * @param src - the destination exactly as the card holds it.
   * @returns the displayable URL, or undefined — no pointer, a failed read, or
   * a read that has not landed yet.
   */
  resolve(src: string): string | undefined {
    if (!isImageSrc(src)) return undefined
    const cached = this.held.get(src)
    if (cached === undefined) {
      // Never asked, or a read in flight (the renderer asks every paint): start
      // it exactly once and say nothing yet.
      if (!this.held.has(src) && !this.reading.has(src)) void this.start(src)
      return undefined
    }
    // A `null` marker is a read that failed: the pointer stays inert alt text,
    // and a failure is never promoted in the LRU order.
    if (cached === null) return undefined
    // A hit is the freshest pointer: re-insert to move it last.
    this.held.delete(src)
    this.held.set(src, cached)
    return cached
  }

  /**
   * The `pathImages` vocabulary for one render. A FRESH object every call: the
   * renderer memoizes over this prop's identity, so re-asking after a read
   * lands is what makes the image appear.
   * @returns the vocabulary bound to this cache.
   */
  vocabulary(): MarkdownPathImages {
    return { resolve: (src: string): string | undefined => this.resolve(src) }
  }

  /**
   * One HTML card's displayable form (the sandboxed frame's `srcDoc` input).
   * @param html - the card's HTML, as authored.
   * @returns it with every resolvable pointer inlined.
   */
  cardHtml(html: string): string {
    return rewriteImageSrcs(html, src => this.resolve(src))
  }

  /** Ask the host for one pointer's bytes, then remember and report. */
  private async start(src: string): Promise<void> {
    this.reading.add(src)
    let url: string | null = null
    const ref = imageRefOf(src)
    if (ref !== undefined) {
      try {
        const result = await this.read(ref)
        if (result.ok && result.value.ok) {
          url = `data:${result.value.mediaType};base64,${result.value.data}`
        }
      } catch {
        // A transport failure is the same news as a missing object: the pointer
        // stays inert, and the next render does not ask again.
      }
    }
    this.reading.delete(src)
    this.remember(src, url)
    if (url !== null) this.source.set(this.source.getSnapshot() + 1)
  }

  /** Keep one read's outcome, dropping the least recently used pointer. */
  private remember(src: string, url: string | null): void {
    this.held.delete(src)
    this.held.set(src, url)
    const oldest = this.held.keys().next().value
    if (this.held.size > MAX_CACHED_IMAGES && oldest !== undefined) this.held.delete(oldest)
  }
}
