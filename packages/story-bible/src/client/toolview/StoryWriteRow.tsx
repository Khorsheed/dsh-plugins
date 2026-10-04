/**
 * The row that replaces the generic `story_write` tool row in the
 * conversation: a chapter registration renders as a compact plan card with
 * one door — 去确认 → — to the reader tab where the person confirms it;
 * every other story_write answer renders as its compact first line. The row
 * decides nothing itself (the canvas propose-row precedent).
 *
 * @module @khorsheed/dsh-story-bible/client
 */
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from '../locales.ts'
import { storyWriteRowModel, type StoryToolBlock } from '../rows.ts'
import css from '../toolview.module.css'

/** What the row reaches outside its own block. */
export interface StoryWriteRowFace {
  /** Show the reader tab at one chapter. */
  openReaderAt: (n: number) => void
}

/** The props the keyed tool slot composes for this row. */
export interface StoryWriteRowProps extends StoryWriteRowFace {
  readonly block: StoryToolBlock
  readonly phase?: string
  readonly t: TranslateNS<'story'>
}

/** Render one `story_write` call. */
export function StoryWriteRow({ block, phase, t, openReaderAt }: StoryWriteRowProps): ReactNode {
  const row = storyWriteRowModel(block, phase)
  return (
    <div className={css.row} data-tool="story_write" data-state={row.state}>
      {row.state === 'chapter-plan' && (
        <>
          <span className={css.kind}>{t('toolview.plan')}</span>
          <span className={css.summary}>
            {t('toolview.planReady', { n: String(row.n ?? '?'), title: row.title ?? '' })}
          </span>
          <button type="button" className={css.open} onClick={() => { if (row.n !== null) openReaderAt(row.n) }}>
            {t('toolview.openPlan')}
          </button>
        </>
      )}
      {row.state === 'plain' && row.n !== null && (
        <>
          <span className={css.kind}>{t('toolview.plan')}</span>
          <span className={css.summary}>{t('toolview.chapterOnly', { n: String(row.n), title: row.title ?? '' })}</span>
          <button type="button" className={css.open} onClick={() => { openReaderAt(row.n!) }}>
            {t('toolview.openPlan')}
          </button>
        </>
      )}
      {row.state === 'plain' && row.n === null && (
        <span className={css.note}>{t('toolview.plain', { text: row.text })}</span>
      )}
      {row.state === 'running' && <span className={css.note}>{t('toolview.running')}</span>}
      {row.state === 'failed' && <span className={css.warn} title={row.text}>{row.text || t('toolview.failed')}</span>}
    </div>
  )
}
