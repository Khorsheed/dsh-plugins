import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { CanvasDetailCrumbs } from '../contract.ts'
import type {} from '../locales.ts'
import { DetailCrumbs } from './DetailCrumbs.tsx'
import css from './CanvasDetailView.module.css'

/** The shared detail-page frame: navigation, one title line, actions and metadata. */
export function DetailHeader({ t, crumbs, here, cardId, trailing, title, actions, children, className }: {
  readonly t: TranslateNS<'canvas'>
  readonly crumbs?: CanvasDetailCrumbs | undefined
  readonly here: string
  readonly cardId: string | null
  readonly trailing?: ReactNode
  readonly title?: ReactNode
  readonly actions?: ReactNode
  readonly children?: ReactNode
  readonly className?: string | undefined
}): ReactNode {
  return (
    <div className={className === undefined ? css.header : `${css.header} ${className}`}>
      {crumbs !== undefined && (
        <DetailCrumbs t={t} crumbs={crumbs} here={here} cardId={cardId} trailing={trailing} />
      )}
      {(title !== undefined || actions !== undefined) && (
        <div className={css.titleRow}>
          <div className={css.titleContent}>{title}</div>
          {actions !== undefined && <div className={css.headerActions}>{actions}</div>}
        </div>
      )}
      {children !== undefined && <div className={css.meta}>{children}</div>}
    </div>
  )
}

/** One segmented view-mode control shared by card and manuscript detail pages. */
export function DetailModeSeg<Mode extends string>({ modes, mode, onMode, label }: {
  readonly modes: readonly { readonly id: Mode; readonly label: string }[]
  readonly mode: Mode
  readonly onMode: (mode: Mode) => void
  readonly label: string
}): ReactNode {
  return (
    <span className={css.seg} role="group" aria-label={label}>
      {modes.map(candidate => (
        <button
          key={candidate.id}
          type="button"
          aria-pressed={mode === candidate.id}
          onClick={() => { onMode(candidate.id) }}
        >
          {candidate.label}
        </button>
      ))}
    </span>
  )
}
