import { useEffect, useRef, useState } from 'react'
  import type { CatalogJsonValue, CatalogToolRow } from '@khorsheed/dsh-capability-catalog/types'
  import type { CapabilityCatalogKey } from './locales.ts'
  import { ModalShell } from './ModalShell.tsx'
  import { MetadataRow } from './MetadataRow.tsx'
  import { SchemaView } from './SchemaView.tsx'
  import { toolOrigin, toolTag } from './ToolCards.tsx'
  import css from './CapabilityCatalogCard.module.css'

/** Tool detail modal: description (clamped when it overflows, expandable) +
 * channel/origin + parameter schema tree. Also serves MCP tools opened from the
 * server manage modal — one detail view for every tool. No footer button — the
 * ×, Esc, and mask-click close it (ModalShell). */
export function ToolDetailModal({ tool, onClose, t }: { tool: CatalogToolRow; onClose: () => void; t: (key: CapabilityCatalogKey) => string }) {
  const [descExpanded, setDescExpanded] = useState(false)
  // Show the expand toggle only when the description actually overflows the clamp.
  const descRef = useRef<HTMLParagraphElement>(null)
  const [descOverflow, setDescOverflow] = useState(false)
  useEffect(() => {
    const el = descRef.current
    if (el === null) { setDescOverflow(false); return }
    setDescOverflow(el.scrollHeight > el.clientHeight + 1)
  }, [tool.description])
  return (
    <ModalShell title={tool.name} onClose={onClose} t={t}>
      <MetadataRow items={[
        { label: t('source'), value: toolTag(tool, t) },
        { label: t('provider'), value: toolOrigin(tool, t) },
      ]} />
      <div className={css.toolDetailDesc}>
        <p ref={descRef} className={`${css.toolDesc} ${descExpanded ? css.toolDescExpanded : css.toolDescClamp}`}>{tool.description}</p>
        {descOverflow ? (
          <button type="button" className={css.toolDescToggle} onClick={() => setDescExpanded(e => !e)}>
            {descExpanded ? t('toolCollapse') : t('toolExpand')}
          </button>
        ) : null}
      </div>
      <SchemaView parameters={tool.parameters as CatalogJsonValue | undefined} title={t('toolParams')} t={t} />
    </ModalShell>
  )
}
