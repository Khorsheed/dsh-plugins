/**
 * The row that replaces the generic `story_extract` tool row: the prepare
 * phase reads as a pack-ready note; the import phase renders the
 * reconciliation summary card (命中/落空/自动入库/待确认) with one door —
 * 去处理 → — to the pending queue; the review gate's refusal renders as a
 * warning (不满意的正文不进记忆).
 *
 * @module @khorsheed/dsh-story-bible/client
 */
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from '../locales.ts'
import { storyExtractRowModel, type StoryToolBlock } from '../rows.ts'
import css from '../toolview.module.css'

/** What the row reaches outside its own block. */
export interface StoryExtractRowFace {
  /** Show the fragments tab's pending queue. */
  openPending: () => void
}

/** The props the keyed tool slot composes for this row. */
export interface StoryExtractRowProps extends StoryExtractRowFace {
  readonly block: StoryToolBlock
  readonly phase?: string
  readonly t: TranslateNS<'story'>
}

/** Render one `story_extract` call. */
export function StoryExtractRow({ block, phase, t, openPending }: StoryExtractRowProps): ReactNode {
  const row = storyExtractRowModel(block, phase)
  return (
    <div className={css.row} data-tool="story_extract" data-state={row.state}>
      {row.state === 'imported' && (
        <>
          <span className={css.kind}>{t('toolview.reconcile')}</span>
          <span className={css.summary}>
            {t('toolview.reconcileSummary', {
              verified: String(row.verified), missed: String(row.missed), auto: String(row.auto), pending: String(row.pending),
            })}
          </span>
          <button type="button" className={css.open} onClick={openPending}>
            {t('toolview.openPending')}
          </button>
        </>
      )}
      {row.state === 'prepared' && (
        <>
          <span className={css.kind}>{t('toolview.reconcile')}</span>
          <span className={css.note}>{t('toolview.prepareReady', { n: String(row.n ?? '?') })}</span>
        </>
      )}
      {row.state === 'refused' && <span className={css.warn} title={row.text}>{t('toolview.refused', { text: row.text })}</span>}
      {row.state === 'running' && <span className={css.note}>{t('toolview.running')}</span>}
      {row.state === 'failed' && <span className={css.warn} title={row.text}>{row.text || t('toolview.failed')}</span>}
    </div>
  )
}
