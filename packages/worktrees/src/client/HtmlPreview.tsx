/**
 * Inline sandboxed HTML preview for the worktrees surfaces: the host's raw
 * HTML file wrapped into a static (sandbox="") iframe via buildHtmlSrcDoc, so
 * CSS and images render while scripts, forms, popups, and network are blocked.
 * Mirrors ui-file-preview's Tier0 render — the local browser and repo file
 * list never run a page's own scripts (dsh file-preview trust model).
 */
import { useMemo, type ReactNode } from 'react'
import { buildHtmlSrcDoc } from './html-src-doc.ts'
import css from './HtmlPreview.module.css'

/** Props of the inline HTML preview. */
export interface HtmlPreviewProps {
  /** The selected file path (html extension). */
  path: string
  /** The raw HTML source read from disk. */
  content: string
}

/** The inline sandboxed HTML preview. */
export function HtmlPreview({ path, content }: HtmlPreviewProps): ReactNode {
  const srcDoc = useMemo(() => buildHtmlSrcDoc(content), [content])
  return (
    <div className={css.wrap}>
      {/* Empty sandbox: no scripts, no forms, no popups; CSS/images render. */}
      <iframe
        className={css.frame}
        sandbox=""
        srcDoc={srcDoc}
        title={path}
      />
    </div>
  )
}
