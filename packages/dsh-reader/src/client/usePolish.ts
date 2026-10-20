/**
 * The 润色 layer in the detail view: the agent's paragraph translations
 * (written back through `reader_translate`) shown in place of the browser's
 * machine translation.
 *
 * Each polished block gets, once: its own content wrapped in
 * `span[data-reader-orig-run]` (whatever the machine translation does inside
 * it), the 润色 text in `div[data-reader-polish]` with a 「✦ 润色」 tag, and
 * the original text in `div[data-reader-polish-orig]` — the article's
 * `data-polish-view` then decides which of them show:
 * - `trans`: the 润色 alone; `both`: the 润色 over the original;
 * - `orig` / none: the block as it was.
 * Without a machine translation running the 润色 shows side by side (both);
 * with one, the globe's view applies. 「看机翻」 hides the layer for this
 * visit only (not remembered — the 润色 is the default, 2026-10-20).
 *
 * @module @khorsheed/dsh-reader/client/usePolish
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import type { ReaderPolishView } from '../types.ts'
import type { ReaderPaneProps } from './contract.ts'
import { blockElements } from './notes.ts'

/** How often an article being polished is re-read (ms). */
const POLL_MS = 5000
/** After the reader sends the request, poll this long for the first batch (ms). */
const AWAIT_FIRST_MS = 20 * 60_000
/** A layer untouched this long, and not complete, has stalled (ms). */
const STALLED_MS = 3 * 60_000

/** Decorations that are not the paragraph's own content. */
const DECORATION = '[data-reader-ts],[data-reader-spk],[data-reader-polish],[data-reader-polish-orig],[data-reader-orig-run]'

export interface UsePolishInput {
  readonly entryId: string | undefined
  readonly articleHtml: string | null
  readonly articleRef: MutableRefObject<HTMLDivElement | null>
  /** The globe's state: the view applies only while a machine translation runs. */
  readonly translating: boolean
  readonly translateView: 'trans' | 'both' | 'orig'
  readonly remote: Pick<ReaderPaneProps, 'polish' | 'setPolishOff'>
  readonly tagLabel: string
  /** The tag's tooltip: clicking it puts this paragraph back to the machine translation. */
  readonly tagTitle: string
}

export interface PolishFace {
  readonly view: ReaderPolishView | undefined
  /** Polishing has stopped short (no write for a while): offer to continue. */
  readonly stalled: boolean
  /** The layer is hidden for this visit (「看机翻」). */
  readonly hidden: boolean
  readonly setHidden: (hidden: boolean) => void
  /** The reader sent the request: watch for the first batch. */
  readonly requested: () => void
  /** A request went into the draft and nothing has come back yet. */
  readonly awaiting: boolean
}

/** The original text of each top-level block of an article body. */
function originals(html: string): string[] {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const root = doc.body.firstElementChild
  return root === null ? [] : [...root.children].map(child => (child.textContent ?? '').replace(/\s+/g, ' ').trim())
}

export function usePolish(input: UsePolishInput): PolishFace {
  const { entryId, articleHtml, articleRef, translating, translateView, remote, tagLabel, tagTitle } = input
  const [viewOf, setViewOf] = useState<{ entryId: string; view: ReaderPolishView | undefined } | undefined>(undefined)
  const view = viewOf !== undefined && viewOf.entryId === entryId ? viewOf.view : undefined
  const [hiddenFor, setHiddenFor] = useState<string | null>(null)
  const hidden = hiddenFor !== null && hiddenFor === entryId
  const [awaitingSince, setAwaitingSince] = useState<number | null>(null)
  const remoteRef = useRef(remote)
  remoteRef.current = remote

  const read = useCallback((id: string) => {
    void remoteRef.current.polish({ entryId: id }).then(answer => {
      if (answer.ok) setViewOf({ entryId: id, view: answer.value ?? undefined })
    })
  }, [])

  useEffect(() => {
    setAwaitingSince(null)
    if (entryId !== undefined && articleHtml !== null && articleHtml !== '') read(entryId)
  }, [entryId, articleHtml, read])

  // Poll while the agent is (or may soon be) writing.
  const now = Date.now()
  const fresh = view !== undefined && !view.complete && now - Date.parse(view.updatedAt) < STALLED_MS
  const awaiting = awaitingSince !== null && now - awaitingSince < AWAIT_FIRST_MS && (view === undefined || !view.complete)
  useEffect(() => {
    if (entryId === undefined || (!fresh && !awaiting)) return undefined
    const timer = setInterval(() => { read(entryId) }, POLL_MS)
    return () => { clearInterval(timer) }
  }, [entryId, fresh, awaiting, read])

  const sources = useMemo(() => (articleHtml === null ? [] : originals(articleHtml)), [articleHtml])

  // Decorate polished blocks; undecorate ones that are no longer.
  useEffect(() => {
    const article = articleRef.current
    if (article === null) return
    const blocks = blockElements(article)
    const off = new Set(view?.off ?? [])
    blocks.forEach((block, index) => {
      const text = view?.paragraphs[String(index + 1)]
      const polishedHere = text !== undefined && !off.has(index + 1)
      let polish = block.querySelector<HTMLElement>(':scope > [data-reader-polish]')
      if (!polishedHere) {
        if (polish !== null) {
          block.querySelector(':scope > [data-reader-polish-orig]')?.remove()
          polish.remove()
          block.removeAttribute('data-polished')
        }
        return
      }
      const doc = block.ownerDocument
      // The block's own content, wrapped once so CSS can hide it.
      if (block.querySelector(':scope > [data-reader-orig-run]') === null) {
        const run = doc.createElement('span')
        run.setAttribute('data-reader-orig-run', '1')
        for (const node of [...block.childNodes]) {
          if (node instanceof Element && node.matches(DECORATION)) continue
          run.append(node)
        }
        block.append(run)
      }
      if (polish === null) {
        polish = doc.createElement('div')
        polish.setAttribute('data-reader-polish', '1')
        polish.setAttribute('data-reader-no-translate', '1')
        const orig = doc.createElement('div')
        orig.setAttribute('data-reader-polish-orig', '1')
        orig.setAttribute('data-reader-no-translate', '1')
        block.append(polish, orig)
      }
      const body = text.replace(/^\[\d+(?::\d+){1,2}\]\s*/, '')
      if (polish.getAttribute('data-text') !== body) {
        polish.setAttribute('data-text', body)
        polish.textContent = body
        const tag = doc.createElement('button')
        tag.type = 'button'
        tag.setAttribute('data-reader-polish-tag', String(index + 1))
        tag.setAttribute('data-label', tagLabel)
        tag.title = tagTitle
        polish.append(tag)
      }
      const orig = block.querySelector(':scope > [data-reader-polish-orig]')
      if (orig !== null) orig.textContent = (sources[index] ?? '').replace(/^\d+:\d+(?::\d+)?\s*/, '')
      block.setAttribute('data-polished', '1')
    })
  }, [view, articleHtml, articleRef, sources, tagLabel, tagTitle])

  // Which layer the article shows.
  useEffect(() => {
    const article = articleRef.current
    if (article === null) return
    const mode = view === undefined || hidden ? null : translating ? translateView : 'both'
    if (mode === null || mode === 'orig') article.removeAttribute('data-polish-view')
    else article.setAttribute('data-polish-view', mode)
  }, [view, hidden, translating, translateView, articleRef, articleHtml])

  // The 「✦ 润色」 tag: this paragraph back to the machine translation.
  useEffect(() => {
    const article = articleRef.current
    if (article === null || entryId === undefined) return undefined
    const onClick = (event: MouseEvent): void => {
      const tag = (event.target as Element | null)?.closest?.('[data-reader-polish-tag]')
      if (tag === null || tag === undefined) return
      event.preventDefault()
      event.stopPropagation()
      const paragraph = Number(tag.getAttribute('data-reader-polish-tag'))
      void remoteRef.current.setPolishOff({ entryId, paragraph, off: true }).then(answer => {
        if (answer.ok) setViewOf({ entryId, view: answer.value ?? undefined })
      })
    }
    article.addEventListener('click', onClick, true)
    return () => { article.removeEventListener('click', onClick, true) }
  }, [entryId, articleRef])

  return {
    view,
    stalled: view !== undefined && !view.complete && !fresh,
    hidden,
    setHidden: (value: boolean) => { setHiddenFor(value && entryId !== undefined ? entryId : null) },
    requested: () => { setAwaitingSince(Date.now()) },
    awaiting: awaiting && view === undefined,
  }
}
