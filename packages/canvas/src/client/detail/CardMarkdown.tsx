/**
 * Markdown with whole HTML blocks rendered, not shown as source (2026-09-28
 * review). The host's `MarkdownText` keeps raw HTML literal by design, so the
 * blocks are split out first (`splitHtmlBlocks`) and each one renders in the
 * same sandbox as an HTML card: the strict card CSP, no network, scripts
 * confined to an opaque origin, the frame sized by the height its bridge
 * reports. A text with no block renders exactly as before, one `MarkdownText`.
 *
 * Authored blocks carry their own light colors. On the host's dark theme the
 * frame is inverted and hue-rotated back from outside (CSS only), so a white
 * diagram does not glare on a dark page and a theme switch needs no reload.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import { Fragment, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { MarkdownText, type MarkdownLabels, type MarkdownPathImages } from '@deepseek-ai/dsh-client-ui-primitives'
import { attachBridge } from '@khorsheed/dsh-inline-html-render/src/client/bridge.ts'
import { buildCardSrcDoc } from '@khorsheed/dsh-inline-html-render/src/client/srcdoc.ts'
import { splitHtmlBlocks } from '../../html-blocks.ts'
import css from './CardMarkdown.module.css'

/**
 * The frame's own base: no margin (the block's margins stay inside the reported
 * height, `flow-root`), a transparent ground, the host's type for a block that
 * sets none, and a `light` scheme matching the frame element's (`.frame`): a
 * scheme that differs from the embedding element's paints an opaque backdrop,
 * which the dark-theme inversion then shows as a grey band.
 */
const BLOCK_BASE = '<style>:root{color-scheme:light}html,body{margin:0;background:transparent}'
  + 'body{display:flow-root;color:#1f2329;font:14px/1.6 -apple-system,BlinkMacSystemFont,\'PingFang SC\',\'Microsoft YaHei\',sans-serif}</style>'

/** One HTML block, sandboxed. */
function HtmlBlock({ html }: { readonly html: string }): ReactNode {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  useEffect(() => {
    const frame = frameRef.current
    if (frame === null) return
    return attachBridge(frame)
  }, [])
  return (
    <iframe
      ref={frameRef}
      className={css.frame}
      sandbox="allow-scripts"
      srcDoc={buildCardSrcDoc(BLOCK_BASE + html)}
      title="HTML"
      data-html-block=""
    />
  )
}

/** A card's or a manuscript's words: markdown, with whole HTML blocks rendered. */
export function CardMarkdown({ text, labels, pathImages }: {
  readonly text: string
  readonly labels: MarkdownLabels
  readonly pathImages?: MarkdownPathImages | undefined
}): ReactNode {
  const segments = useMemo(() => splitHtmlBlocks(text), [text])
  if (segments.length === 1 && segments[0]!.kind === 'markdown') {
    return <MarkdownText text={text} labels={labels} pathImages={pathImages} />
  }
  return (
    <>
      {segments.map((segment, index) => (
        <Fragment key={index}>
          {segment.kind === 'html'
            ? <HtmlBlock html={segment.html} />
            : <MarkdownText text={segment.text} labels={labels} pathImages={pathImages} />}
        </Fragment>
      ))}
    </>
  )
}
