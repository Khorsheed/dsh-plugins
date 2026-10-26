/**
 * One rendered markdown document in the content pane: the official
 * MarkdownText over the media-rewritten text (markdown-media.ts), with the
 * document's local images and local links wired to the surface.
 *
 * - Local images: the renderer asks `pathImages.resolve(value)` for every
 *   image destination it cannot show unaided. The first ask for a path
 *   schedules the surface's `resolveImage` (outside render) and answers
 *   "not yet" — the image renders as its alt text, then as the image once the
 *   surface's read lands. Answers are cached per document read, so a reload
 *   re-reads the images and keystrokes in the editor's draft preview do not.
 * - Local links: `[English](README.en.md)` opens the resolved path through the
 *   surface's `onOpenFile`, via the official MarkdownDelegateProvider. A host
 *   whose ui-primitives predates the provider leaves such links as plain text
 *   (the platform module is the host's own copy, so the export is probed).
 *
 * @module @khorsheed/dsh-client-ui-content-preview
 */
import { useMemo, useRef, useState, type ReactNode } from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { MarkdownText, type MarkdownLabels, type MarkdownPathImages } from '@deepseek-ai/dsh-client-ui-primitives'
import { isRenderableImageUrl, resolveDocPath, rewriteHtmlMedia } from './markdown-media.ts'

/** The host's delegate provider, when its ui-primitives has one (added 2026-09). */
const DelegateProvider = (primitives as Partial<typeof primitives>).MarkdownDelegateProvider

const EMPTY: ReadonlyMap<string, string | null> = new Map()

/** Make a surface's image URL absolute: the renderer only shows absolute (or data:/blob:) sources. */
function absoluteUrl(url: string): string | undefined {
  try {
    return new URL(url, document.baseURI).href
  } catch {
    // An unparsable answer is a miss: the image keeps its alt text.
    return undefined
  }
}

/** Props of one rendered markdown document. */
export interface MarkdownDocumentProps {
  /** The markdown text to render (the file, or the editor's draft). */
  readonly text: string
  /** The document's path in the surface's own path space; destinations resolve against its directory. */
  readonly docPath: string
  readonly labels: MarkdownLabels
  /** Load one local image; resolves a displayable URL, or undefined when it cannot. */
  readonly resolveImage?: ((path: string) => Promise<string | undefined>) | undefined
  /** Open one local file named by a link. */
  readonly onOpenFile?: ((path: string, options?: { line?: number }) => void) | undefined
  /** The underlying read's own content (not the draft): a change drops the image cache, so a
   * reload that brought new text re-reads the images. A value, not a read object — surfaces
   * rebuild their read object every render. */
  readonly version: unknown
}

/**
 * Render one markdown document with its local media.
 * @param props - text, document path, labels, and the surface's media hooks.
 * @returns the rendered document.
 */
export function MarkdownDocument(props: MarkdownDocumentProps): ReactNode {
  const { text, docPath, labels, resolveImage, onOpenFile, version } = props
  const source = useMemo(() => rewriteHtmlMedia(text), [text])
  // Surfaces pass fresh closures every render: only their presence may key
  // memos and resets, the latest one is read through the ref when called.
  const resolveRef = useRef(resolveImage)
  resolveRef.current = resolveImage
  const openRef = useRef(onOpenFile)
  openRef.current = onOpenFile
  const canResolve = resolveImage !== undefined
  const canOpen = onOpenFile !== undefined

  // path -> displayable URL (null: the surface could not show it), for one
  // (document, read) key: a different key reads as an empty cache, so a
  // reload or a file switch re-reads without an effect racing the first load.
  const key = `${docPath}\u0000${String(version)}`
  const keyRef = useRef(key)
  keyRef.current = key
  const [cache, setCache] = useState<{ readonly key: string; readonly images: ReadonlyMap<string, string | null> }>(
    () => ({ key, images: new Map() }))
  const images = cache.key === key ? cache.images : EMPTY
  const requested = useRef<{ key: string; paths: Set<string> }>({ key, paths: new Set() })
  if (requested.current.key !== key) requested.current = { key, paths: new Set() }

  const pathImages = useMemo<MarkdownPathImages | undefined>(() => {
    if (!canResolve) return undefined
    return {
      resolve: (value: string): string | undefined => {
        if (isRenderableImageUrl(value)) return undefined
        const path = resolveDocPath(docPath, value)
        if (path === undefined) return undefined
        const hit = images.get(path)
        if (hit !== undefined) return hit ?? undefined
        if (!requested.current.paths.has(path)) {
          requested.current.paths.add(path)
          const at = key
          // Never set state during the renderer's own render pass.
          queueMicrotask(() => {
            const settle = (url: string | undefined): void => {
              if (keyRef.current !== at) return
              const shown = url === undefined ? null : (absoluteUrl(url) ?? null)
              setCache(previous => ({
                key: at,
                images: new Map(previous.key === at ? previous.images : EMPTY).set(path, shown),
              }))
            }
            const load = resolveRef.current
            if (load === undefined) { settle(undefined); return }
            load(path).then(settle, () => { settle(undefined) })
          })
        }
        return undefined
      },
    }
  }, [canResolve, docPath, images, key])

  const openFile = useMemo(() => {
    if (!canOpen) return undefined
    return (path: string, options?: { line?: number }): void => {
      const resolved = resolveDocPath(docPath, path)
      if (resolved !== undefined) openRef.current?.(resolved, options)
    }
  }, [canOpen, docPath])

  const body = <MarkdownText text={source} labels={labels} pathImages={pathImages} />
  return openFile !== undefined && DelegateProvider !== undefined
    ? <DelegateProvider openFile={openFile}>{body}</DelegateProvider>
    : body
}
