/**
 * On-device translation for the article body, through the browser's own
 * Translator API (Chrome 138+ / Edge 148+, desktop only).
 *
 * Everything here is the BROWSER half, on purpose. The model runs inside the
 * user's browser: the article text never reaches the host, is never written to
 * `state.json`, and costs no tokens. That is also why this module has no
 * Remote verb and no host counterpart — its only dependency is a global the
 * page may or may not have, and {@link detectTranslator} is the whole
 * degradation story (no API → no button, not a broken one).
 *
 * The unit of translation is a SENTENCE inside one text node — never a node,
 * never a paragraph. Two reasons the granularity matters:
 *
 * - The reader wants ONE sentence's original while reading the translation. A
 *   paragraph-level unit cannot answer that after the fact: the model merges
 *   and splits sentences, so re-aligning the two sides later is a guess, and a
 *   wrong guess shows the wrong original. Segmenting first makes the pairing
 *   true by construction.
 * - Inline markup survives because we only ever touch text nodes: a link
 *   inside a sentence stays a link, its href untouched. A sentence that
 *   CROSSES an inline element becomes two units (the text on each side) — what
 *   Chrome's own page translation does — and each side still reveals exactly
 *   its own original.
 *
 * Batches go out as one string with a separator between units, and the answer
 * is only accepted when it comes back with the same number of parts. A mangled
 * separator costs that batch its granularity — it is re-sent one unit at a
 * time — never its correctness.
 *
 * @module @khorsheed/dsh-reader/client/translate
 */

/** The three views the reader picks between (the globe's menu). */
export type TranslationView = 'trans' | 'both' | 'orig'

/** What the browser reports for a language pair. */
export type TranslationAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable'

/**
 * The target tags to try, in order.
 *
 * Chrome's documented list spells Chinese `zh` (Simplified) and `zh-Hant`
 * (Traditional), and `zh` is what works on the machines this was built on — but
 * `Translator.create()` has been observed rejecting a pair that
 * `availability()` had just blessed (`NotSupportedError`, "Unable to create
 * translator for the given source and target language", macOS builds included).
 * Trying the next spelling costs one rejected call and turns a dead button into
 * a working one where a build prefers the other tag.
 */
export const TARGET_CANDIDATES: readonly string[] = ['zh', 'zh-Hans']

/** The unit separator inside a batch. Rare, short, and verified on the way back. */
export const UNIT_SEPARATOR = '⟦|⟧'

/** Stop packing a batch once it holds this many characters (or units). */
const BATCH_MAX_CHARS = 1200
const BATCH_MAX_UNITS = 12

/** How many remembered sentences the translation memory keeps before evicting. */
const MEMORY_MAX_ENTRIES = 4000

/** `NodeFilter.SHOW_TEXT`, spelled numerically so no global is required. */
const SHOW_TEXT = 4

/** Tokens that end in a period without ending a sentence. */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'e.g', 'i.e', 'fig', 'no',
  'inc', 'ltd', 'co', 'corp', 'dept', 'univ', 'approx', 'cf', 'ed', 'eds', 'est', 'vol',
  'ch', 'sec', 'pp', 'u.s', 'u.k', 'u.n', 'al', 'eq', 'ref',
])

/** The structural slice of the Translator API this module actually uses. */
export interface TranslatorLike {
  availability(request: { sourceLanguage: string; targetLanguage: string }): Promise<string>
  create(request: {
    sourceLanguage: string
    targetLanguage: string
    monitor?: (monitor: DownloadMonitorLike) => void
  }): Promise<TranslatorSessionLike>
}

/** The `monitor` object `create()` hands back; only progress is read. */
export interface DownloadMonitorLike {
  addEventListener(type: 'downloadprogress', listener: (event: { loaded: number }) => void): void
}

/** One created translator. */
export interface TranslatorSessionLike {
  readonly inputQuota: number
  measureInputUsage(text: string): Promise<number>
  translate(text: string): Promise<string>
}

/** Read the page's Translator API, or null when this browser has none. */
export function detectTranslator(scope: unknown = globalThis): TranslatorLike | null {
  const candidate = (scope as { Translator?: unknown }).Translator
  if (candidate === undefined || candidate === null) return null
  const api = candidate as Partial<TranslatorLike>
  if (typeof api.availability !== 'function' || typeof api.create !== 'function') return null
  return candidate as TranslatorLike
}

/** The structural slice of the Language Detector API, when the page has one. */
export interface LanguageDetectorLike {
  availability(): Promise<string>
  create(options?: { monitor?: (monitor: DownloadMonitorLike) => void }): Promise<{
    detect(text: string): Promise<readonly { detectedLanguage: string; confidence: number }[]>
    destroy?(): void
  }>
}

/** Read the page's Language Detector, or null when this browser has none. */
export function detectLanguageDetector(scope: unknown = globalThis): LanguageDetectorLike | null {
  const candidate = (scope as { LanguageDetector?: unknown }).LanguageDetector
  if (candidate === undefined || candidate === null) return null
  const api = candidate as Partial<LanguageDetectorLike>
  if (typeof api.availability !== 'function' || typeof api.create !== 'function') return null
  return candidate as LanguageDetectorLike
}

/**
 * The body's source language: the browser's detector when it has one, else the
 * caller's script guess.
 *
 * The probe is only worth it because a WRONG source is fatal in a way the
 * reader cannot see: `create()` rejects for a pair the device does not have, and
 * the error says "given source and target language" without naming either. The
 * heuristic that decides this in the pane (`isCjk`) is a script test, not a
 * language test — it cannot tell German from English.
 *
 * @param text - the body's leading text (a sample is enough).
 * @param fallback - the caller's guess, used when detection is unavailable or unsure.
 * @returns the BCP-47 tag to ask the translator for.
 */
export async function detectSourceLanguage(text: string, fallback: string): Promise<string> {
  const detector = detectLanguageDetector()
  if (detector === null) return fallback
  const sample = text.slice(0, 600).trim()
  if (sample.length < 20) return fallback
  try {
    const state = await detector.availability()
    if (state === 'unavailable') return fallback
    const session = await detector.create()
    const results = await session.detect(sample)
    session.destroy?.()
    const best = results[0]
    if (best !== undefined && best.confidence >= 0.5 && typeof best.detectedLanguage === 'string') {
      return best.detectedLanguage
    }
  } catch {
    // Degrade to the caller's guess: a failed detection must never block a
    // translation that would otherwise work.
  }
  return fallback
}

/** One attempted language pair and why it did not produce a translator. */
export interface SessionAttempt {
  readonly sourceLanguage: string
  readonly targetLanguage: string
  readonly reason: string
}

/** The outcome of asking the browser for a translator, across candidate pairs. */
export type SessionOutcome =
  | { readonly ok: true; readonly session: TranslatorSessionLike; readonly sourceLanguage: string; readonly targetLanguage: string }
  | { readonly ok: false; readonly attempts: readonly SessionAttempt[]; readonly unsupported: boolean }

/** True when the browser says this pair is not something it can ever build. */
export function isUnsupported(error: unknown): boolean {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'NotSupportedError') return true
  const message = error instanceof Error ? error.message : String(error)
  return /given source and target|not supported|unsupported language/i.test(message)
}

/**
 * Create a translator, trying every candidate pair in order.
 *
 * `availability()` is a hint, not a promise: this browser has been observed
 * blessing a pair and then rejecting `create()` for it. So the pairs are tried
 * for real, the failures are collected (the reader gets to see which pair was
 * asked for), and `unsupported` says whether the browser rejected EVERY attempt
 * as an unsupported language pair — which is a permanent condition, unlike a
 * download or a quota failure.
 *
 * @param api - the page's Translator API.
 * @param request - the source candidates, the target candidates, and the monitor.
 * @returns the first working session, or the collected attempts.
 */
export async function createSession(api: TranslatorLike, request: {
  readonly sources: readonly string[]
  readonly targets: readonly string[]
  readonly monitor?: (monitor: DownloadMonitorLike) => void
}): Promise<SessionOutcome> {
  const attempts: SessionAttempt[] = []
  let unsupported = true
  let tried = 0
  for (const sourceLanguage of request.sources) {
    for (const targetLanguage of request.targets) {
      tried += 1
      try {
        const state = await api.availability({ sourceLanguage, targetLanguage })
        if (state === 'unavailable') {
          attempts.push({ sourceLanguage, targetLanguage, reason: 'unavailable' })
          continue
        }
      } catch (error) {
        attempts.push({ sourceLanguage, targetLanguage, reason: error instanceof Error ? error.message : String(error) })
        unsupported = false
        continue
      }
      try {
        const session = await api.create({ sourceLanguage, targetLanguage, ...(request.monitor === undefined ? {} : { monitor: request.monitor }) })
        return { ok: true, session, sourceLanguage, targetLanguage }
      } catch (error) {
        const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
        if (!isUnsupported(error)) unsupported = false
        attempts.push({ sourceLanguage, targetLanguage, reason })
      }
    }
  }
  return { ok: false, attempts, unsupported: unsupported && tried > 0 }
}

/** One sentence inside a text run, with the whitespace that follows it. */
export interface SentencePiece {
  /** The sentence plus its trailing spacing — pieces concatenate back to the run. */
  readonly text: string
  /** The translatable part (`text` without the trailing spacing). */
  readonly core: string
}

/**
 * Split one run of text into sentence pieces.
 *
 * Conservative by construction: a split needs a terminator followed by
 * whitespace (or the end), a token that is neither a known abbreviation nor a
 * single initial, and a next character that does not continue a number. When
 * any rule is unsure it does NOT split — one oversized unit only costs
 * granularity, while a wrong split hands the model two broken half-sentences.
 *
 * @param text - the run's core text (already trimmed at both ends).
 * @returns the pieces in order; a run with no terminator comes back as one.
 */
export function splitSentences(text: string): SentencePiece[] {
  if (text.length === 0) return []
  const pieces: SentencePiece[] = []
  let start = 0
  let i = 0
  while (i < text.length) {
    const ch = text[i]!
    if (!'.!?。！？…'.includes(ch)) { i += 1; continue }
    // A run of terminators ("?!", "…") ends at its last character.
    let end = i
    while (end + 1 < text.length && '.!?。！？…'.includes(text[end + 1]!)) end += 1
    const next = text[end + 1]
    // Latin terminators need a following break, plus the abbreviation and
    // decimal checks below. CJK terminators are unambiguous and are written
    // without a following space, so they stand on their own.
    if ('.!?…'.includes(ch)) {
      if (next !== undefined && !/\s/.test(next)) { i = end + 1; continue }
      const lastWord = /([A-Za-z][A-Za-z.]*)$/.exec(text.slice(start, end + 1))?.[1] ?? ''
      const bare = lastWord.replace(/\.$/, '').toLowerCase()
      if (ABBREVIATIONS.has(bare) || /^[a-z]$/.test(bare)) { i = end + 1; continue }
      const after = text.slice(end + 1).trimStart()[0]
      if (/\d$/.test(text[end]!) && after !== undefined && /\d/.test(after)) { i = end + 1; continue }
    }
    // The piece keeps the whitespace that follows the terminator, so joining the
    // pieces reproduces the run byte for byte.
    let cut = end + 1
    while (cut < text.length && /\s/.test(text[cut]!)) cut += 1
    pieces.push({ text: text.slice(start, cut), core: text.slice(start, end + 1).trim() })
    start = cut
    i = cut
  }
  if (start < text.length) {
    const tail = text.slice(start)
    pieces.push({ text: tail, core: tail.trim() })
  }
  return pieces.filter(piece => piece.core.length > 0)
}

/* ------------------------------------------------------------------ the DOM */

/** The class names the article markup is decorated with (hashed by the caller). */
export interface TranslateClasses {
  readonly unit: string
  readonly reveal: string
  readonly line: string
}

/** One translated sentence, as it lives in the article DOM. */
interface BuiltSegment {
  readonly span: HTMLElement
  /** The source sentence, trimmed: what the reveal shows and what we translate. */
  readonly original: string
  /**
   * The whitespace that PRECEDED this unit inside its run. It stays in the
   * original text node (so the DOM is unchanged), but the flattened block text
   * needs it: without it two runs join as "See thebest-studied domains".
   */
  readonly lead: string
  /** The whitespace that followed it INSIDE the span (between sentences). */
  readonly tail: string
  /**
   * The run's own trailing whitespace, which stays in the DOM as a text node
   * after the last span. It is not part of any span, but the flattened block
   * text needs it — this is where "See the " + "best-studied domains" keeps its
   * space.
   */
  readonly gap: string
  translated: string | null
  open: boolean
}

/** Where a block's reveal container belongs. */
type RevealPlacement = 'sibling' | 'inside' | 'inline'

/** One block (paragraph, list item, heading…) and the segments inside it. */
interface BuiltBlock {
  readonly element: Element
  readonly placement: RevealPlacement
  readonly segments: BuiltSegment[]
  /** The block's original prose flattened across its units. */
  flat: string
  /** Sentence ranges inside `flat`, in order — the reveal's real granularity. */
  sentences: { readonly start: number; readonly end: number }[]
  reveal: HTMLElement | null
}

/** What one original text node needs to be put back exactly as it was. */
interface RestoreRecord {
  readonly node: Text
  readonly lead: string
  readonly core: string
  readonly tail: string
  readonly tailNode: Text
  readonly spans: readonly HTMLElement[]
}

/** The live segmentation of one rendered article. */
export interface BuiltArticle {
  readonly root: Element
  readonly blocks: BuiltBlock[]
  readonly restores: RestoreRecord[]
  view: TranslationView
}

/** The segmentation of each article root, so views can be re-applied cheaply. */
const BUILT = new WeakMap<Element, BuiltArticle>()

/** Translation memory: original sentence → translated sentence. */
const MEMORY = new Map<string, string>()

/** Blocks whose text is a code or data payload, never prose. */
const SKIP_ANCESTORS = 'pre, code, kbd, samp, [data-reader-no-translate]'

/** Elements that can host prose blocks. */
const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, dd, dt, figcaption, td, th'

/** True when a run carries prose worth translating. */
function translatable(core: string): boolean {
  if (core.length < 2) return false
  if (!/[A-Za-z\u00c0-\u024f\u0400-\u04ff]/.test(core)) return false
  if (/^(https?:\/\/|www\.)\S+$/i.test(core)) return false
  return true
}

/** The block a text node belongs to, and where its reveal should live. */
function blockFor(node: Text): { element: Element; placement: RevealPlacement } | null {
  const parent = node.parentElement
  if (parent === null) return null
  if (parent.closest(SKIP_ANCESTORS) !== null) return null
  const found = parent.closest(BLOCK_SELECTOR)
  if (found !== null) {
    // A `p` or a heading cannot legally contain a block, so its reveal is a
    // sibling; everything else (li, blockquote, td…) opens its own container.
    const tag = found.tagName
    return { element: found, placement: tag === 'P' || /^H[1-6]$/.test(tag) ? 'sibling' : 'inside' }
  }
  // NO block between this run and the article root. `extract-article` really
  // does emit a body as bare text (a one-line feed item), and skipping those
  // runs meant a whole article silently refused to translate. The run's own
  // parent is the block here, and the reveal follows the run's last sentence.
  return { element: parent, placement: 'inline' }
}

/**
 * Segment one rendered article into sentence spans.
 *
 * Idempotent: a second call for the same element returns the first result, so a
 * view switch never double-wraps. Mutates the DOM under `root` (each prose text
 * node is replaced by spans); {@link restoreArticle} undoes it completely.
 *
 * @param root - the container holding the normalized article markup.
 * @param classes - the hashed class names the spans and reveals carry.
 * @returns the segmentation, or null when there is nothing to translate.
 */
export function buildArticle(root: Element, classes: TranslateClasses): BuiltArticle | null {
  const existing = BUILT.get(root)
  if (existing !== undefined) return existing
  const walker = root.ownerDocument.createTreeWalker(root, SHOW_TEXT)
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) nodes.push(node as Text)
  const blocks: BuiltBlock[] = []
  const restores: RestoreRecord[] = []
  const blockIndex = new Map<Element, BuiltBlock>()
  for (const node of nodes) {
    const raw = node.nodeValue ?? ''
    const lead = /^\s*/.exec(raw)?.[0] ?? ''
    const tail = /\s*$/.exec(raw)?.[0] ?? ''
    const core = raw.slice(lead.length, raw.length - tail.length)
    if (!translatable(core)) continue
    const host = blockFor(node)
    if (host === null) continue
    const pieces = splitSentences(core)
    if (pieces.length === 0) continue
    const doc = root.ownerDocument
    const spans: HTMLElement[] = []
    const segments: BuiltSegment[] = []
    // The original node STAYS in the DOM (holding the leading whitespace) so the
    // restore path has something to write back to; the spans follow it.
    node.nodeValue = lead
    let anchor: ChildNode = node
    for (const piece of pieces) {
      const span = doc.createElement('span')
      span.className = classes.unit
      span.setAttribute('data-reader-unit', '1')
      span.textContent = piece.text
      anchor.after(span)
      anchor = span
      spans.push(span)
      const pieceTail = piece.text.slice(piece.core.length)
      segments.push({
        span,
        original: piece.core,
        lead: segments.length === 0 ? lead : '',
        tail: pieceTail,
        gap: segments.length === pieces.length - 1 ? tail : '',
        translated: null,
        open: false,
      })
    }
    const tailNode = doc.createTextNode(tail)
    anchor.after(tailNode)
    let block = blockIndex.get(host.element)
    if (block === undefined) {
      block = { element: host.element, placement: host.placement, segments: [], flat: '', sentences: [], reveal: null }
      blockIndex.set(host.element, block)
      blocks.push(block)
    }
    block.segments.push(...segments)
    restores.push({ node, lead, core, tail, tailNode, spans })
  }
  if (blocks.length === 0) return null
  // Flatten each block's ORIGINAL prose and re-cut it into sentences. Inline
  // markup (a link inside a sentence) split that sentence into several units;
  // the reveal must still show the WHOLE sentence, or the original reads as
  // fragments — the shape the reader reported as "sparse".
  for (const block of blocks) {
    let flat = ''
    for (const segment of block.segments) {
      flat += segment.lead
      flat += segment.original
      flat += segment.tail
      flat += segment.gap
    }
    const sentences: { start: number; end: number }[] = []
    let cursor = 0
    for (const piece of splitSentences(flat)) {
      const end = cursor + piece.text.length
      sentences.push({ start: cursor, end })
      cursor = end
    }
    if (sentences.length === 0) sentences.push({ start: 0, end: flat.length })
    block.flat = flat
    block.sentences = sentences
  }
  const built: BuiltArticle = { root, blocks, restores, view: 'trans' }
  BUILT.set(root, built)
  return built
}

/** Take the segmentation back out, restoring every original text node. */
export function restoreArticle(root: Element): void {
  const built = BUILT.get(root)
  if (built === undefined) return
  for (const record of built.restores) {
    for (const span of record.spans) span.remove()
    record.tailNode.remove()
    record.node.nodeValue = record.lead + record.core + record.tail
  }
  for (const block of built.blocks) block.reveal?.remove()
  BUILT.delete(root)
  root.removeAttribute('data-reader-translated')
}

/** The text one segment shows in a view, whitespace included. */
function segmentText(segment: BuiltSegment, view: TranslationView): string {
  if (view === 'orig') return segment.original + segment.tail
  return (segment.translated ?? segment.original) + segment.tail
}

/** Where one unit starts inside its block's flattened original text. */
function offsetOf(block: BuiltBlock, segment: BuiltSegment): number {
  let offset = 0
  for (const candidate of block.segments) {
    if (candidate === segment) return offset + candidate.lead.length
    offset += candidate.lead.length + candidate.original.length + candidate.tail.length + candidate.gap.length
  }
  return offset
}

/** The sentences of a block that a set of units belongs to, in order. */
function sentencesFor(block: BuiltBlock, segments: readonly BuiltSegment[]): number[] {
  const indexes = new Set<number>()
  for (const segment of segments) {
    const offset = offsetOf(block, segment)
    let index = block.sentences.findIndex(sentence => offset >= sentence.start && offset < sentence.end)
    if (index === -1) index = 0
    indexes.add(index)
  }
  return [...indexes].sort((left, right) => left - right)
}

/** Render one block's reveal container for the sentences currently shown. */
function paintReveal(block: BuiltBlock, view: TranslationView, classes: TranslateClasses): void {
  const shown = view === 'both' ? block.sentences.map((_, index) => index) : sentencesFor(block, block.segments.filter(segment => segment.open))
  if (shown.length === 0 || view === 'orig') {
    block.reveal?.remove()
    block.reveal = null
    return
  }
  const doc = block.element.ownerDocument
  const reveal = block.reveal ?? doc.createElement('div')
  reveal.className = classes.reveal
  reveal.setAttribute('data-reader-reveal', '1')
  reveal.textContent = ''
  for (const index of shown) {
    const sentence = block.sentences[index]
    if (sentence === undefined) continue
    const line = doc.createElement('p')
    line.className = classes.line
    line.textContent = block.flat.slice(sentence.start, sentence.end).trim()
    line.setAttribute('data-reader-sentence', String(index))
    // The pairing mark: this line is the original of an OPENED translation, so
    // clicking a sentence lights both sides of the pair up.
    const opened = block.segments.some(segment =>
      segment.open && sentencesFor(block, [segment]).includes(index))
    if (opened) line.setAttribute('data-open', '1')
    reveal.append(line)
  }
  if (block.reveal === null) {
    block.reveal = reveal
    if (block.placement === 'sibling') block.element.after(reveal)
    else if (block.placement === 'inside') block.element.append(reveal)
    else block.segments[block.segments.length - 1]?.span.after(reveal)
  }
}

/** Paint the spans and the reveals for one view. */
export function setView(built: BuiltArticle, view: TranslationView, classes: TranslateClasses): void {
  built.view = view
  const anyTranslated = built.blocks.some(block => block.segments.some(segment => segment.translated !== null))
  for (const block of built.blocks) {
    for (const segment of block.segments) {
      const text = segmentText(segment, view)
      if (segment.span.textContent !== text) segment.span.textContent = text
      if (segment.open) segment.span.setAttribute('data-open', '1')
      else segment.span.removeAttribute('data-open')
    }
    paintReveal(block, view, classes)
  }
  // `pending` until the first unit lands: the translated typography (CJK
  // leading) must not be applied to text that is still English.
  built.root.setAttribute('data-reader-translated', anyTranslated ? view : 'pending')
}

/** The segment a click landed on, if any. */
export function segmentAt(built: BuiltArticle, target: EventTarget | null): BuiltSegment | null {
  if (!(target instanceof Element)) return null
  const span = target.closest('[data-reader-unit]')
  if (span === null) return null
  for (const block of built.blocks) {
    const found = block.segments.find(segment => segment.span === span)
    if (found !== undefined) return found
  }
  return null
}

/** The block sentence a click landed on inside a reveal, if any. */
export function sentenceAt(built: BuiltArticle, target: EventTarget | null): { block: BuiltBlock; index: number } | null {
  if (!(target instanceof Element)) return null
  const line = target.closest('[data-reader-sentence]')
  if (line === null) return null
  const index = Number(line.getAttribute('data-reader-sentence'))
  for (const block of built.blocks) {
    if (block.reveal !== null && block.reveal.contains(line)) return { block, index }
  }
  return null
}

/**
 * Toggle every unit of one block sentence (clicking its original line).
 *
 * The line is on screen because at least one of its units is open, so clicking
 * it CLOSES the whole sentence — a reader who sees the sentence's original and
 * clicks it means "hide that", not "open the parts you left open". Only when
 * nothing in the sentence is open (the side-by-side view) does it open them.
 */
export function toggleSentence(built: BuiltArticle, block: BuiltBlock, index: number, classes: TranslateClasses): void {
  const sentence = block.sentences[index]
  if (sentence === undefined) return
  const members = block.segments.filter(segment => {
    const offset = offsetOf(block, segment)
    return offset >= sentence.start && offset < sentence.end
  })
  const opening = !members.some(segment => segment.open)
  for (const segment of members) {
    segment.open = opening
    if (opening) segment.span.setAttribute('data-open', '1')
    else segment.span.removeAttribute('data-open')
  }
  paintReveal(block, built.view, classes)
}

/** Flip one sentence's original open / closed (the click gesture). */
export function toggleSegment(built: BuiltArticle, segment: BuiltSegment, classes: TranslateClasses): void {
  segment.open = !segment.open
  if (segment.open) segment.span.setAttribute('data-open', '1')
  else segment.span.removeAttribute('data-open')
  for (const block of built.blocks) {
    if (block.segments.includes(segment)) { paintReveal(block, built.view, classes); return }
  }
}

/** Record a translated unit: in the DOM, and in the translation memory. */
export function applyTranslation(built: BuiltArticle, segment: BuiltSegment, translated: string): void {
  segment.translated = translated
  if (built.view !== 'orig') segment.span.textContent = translated + segment.tail
  const key = segment.original
  if (key.length > 0 && !MEMORY.has(key)) {
    MEMORY.set(key, translated)
    if (MEMORY.size > MEMORY_MAX_ENTRIES) {
      const oldest = MEMORY.keys().next().value
      if (oldest !== undefined) MEMORY.delete(oldest)
    }
  }
}

/** A remembered translation for this sentence, when one exists. */
export function remembered(text: string): string | undefined {
  return MEMORY.get(text)
}

/** Drop the translation memory (the specs call this between cases). */
export function clearMemory(): void {
  MEMORY.clear()
}

/* --------------------------------------------------------------- the driver */

/** What the driver needs; everything is injected so the specs can fake it. */
export interface RunTranslationOptions {
  readonly built: BuiltArticle
  readonly session: TranslatorSessionLike
  /** Flipped by the Cancel gesture; checked between batches. */
  readonly cancelled: () => boolean
  readonly onProgress?: (done: number, total: number) => void
}

/** Every segment of a built article, in reading order. */
export function segmentsOf(built: BuiltArticle): BuiltSegment[] {
  return built.blocks.flatMap(block => block.segments)
}

/**
 * Translate every segment of a built article, best effort.
 *
 * Remembered units paint immediately; the rest go out in batches of whole
 * sentences. A batch whose separator comes back altered is re-sent one unit at
 * a time — the fallback gives up granularity for that batch, never correctness.
 *
 * @param options - the built article, a created session, and the cancel flag.
 * @returns how many units were translated, how many failed, and the total.
 */
export async function runTranslation(options: RunTranslationOptions): Promise<{ done: number; failed: number; total: number }> {
  const { built, session, cancelled, onProgress } = options
  const segments = segmentsOf(built)
  const total = segments.length
  let done = 0
  let failed = 0
  const report = (): void => { onProgress?.(done, total) }
  const pending: BuiltSegment[] = []
  for (const segment of segments) {
    const hit = remembered(segment.original)
    if (hit !== undefined) {
      applyTranslation(built, segment, hit)
      done += 1
    } else {
      pending.push(segment)
    }
  }
  report()
  let batch: BuiltSegment[] = []
  let chars = 0
  const flush = async (): Promise<void> => {
    if (batch.length === 0) return
    const current = batch
    batch = []
    chars = 0
    if (cancelled()) return
    const payload = current.map(segment => segment.original).join(UNIT_SEPARATOR)
    let parts: string[] | null = null
    try {
      parts = (await session.translate(payload)).split(UNIT_SEPARATOR)
    } catch {
      parts = null
    }
    if (parts !== null && parts.length === current.length) {
      current.forEach((segment, index) => {
        applyTranslation(built, segment, parts![index]!.trim())
        done += 1
      })
      report()
      return
    }
    // The separator did not survive (or the call failed): fall back to one unit
    // per request, which cannot be mis-aligned.
    for (const segment of current) {
      if (cancelled()) return
      try {
        const translated = await session.translate(segment.original)
        applyTranslation(built, segment, translated.trim())
        done += 1
      } catch {
        failed += 1
      }
      report()
    }
  }
  for (const segment of pending) {
    if (cancelled()) break
    const size = segment.original.length
    if (batch.length > 0 && (chars + size > BATCH_MAX_CHARS || batch.length >= BATCH_MAX_UNITS)) await flush()
    if (cancelled()) break
    batch.push(segment)
    chars += size
  }
  await flush()
  return { done, failed, total }
}
