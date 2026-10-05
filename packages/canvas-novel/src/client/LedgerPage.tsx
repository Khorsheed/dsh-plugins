/**
 * The 伏笔台账 page: the health line, then every open foreshadow longest-asleep
 * first — its ref and question, how long it has slept (overdue in the warning
 * colour), its tension, and its chapter track (one cell per chapter, marked
 * where the text planted/advanced/hinted/resolved it) — then the resolved
 * ones with their answers. A row opens its card.
 *
 * @module @khorsheed/dsh-canvas-novel/client
 */
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { NOVEL_GENRE_ID, type ForeshadowView, type LedgerMark } from '../types.ts'
import type { NovelNavigate, NovelPageOwnerProps, NovelSurfaceProps } from './contract.ts'
import { errorKey, useNovelRead } from './use-novel.ts'
import css from './novel.module.css'

/** Chapters a sleep may reach before the ledger calls it overdue (the engine's rule). */
const OVERDUE = 3

/** The `novel:ledger` page entry. */
export function LedgerPage(props: NovelSurfaceProps<NovelPageOwnerProps>): ReactNode {
  const { canvasId, board, rev, navigate, remote, t } = props
  const api = remote()
  const read = useNovelRead(api, r => r.ledger({ canvasId }), `ledger:${canvasId}`, rev)
  if (board.genre?.id !== NOVEL_GENRE_ID || api === undefined) return null
  if (read.state === 'loading') return <div className={css.page}><div className={css.muted}>{t('state.loading')}</div></div>
  if (read.state === 'error') return <div className={css.page}><div className={css.warn}>{t('error.generic', { message: read.message })}</div></div>
  const ledger = read.value
  if (!ledger.ok) return <div className={css.page}><div className={css.warn}>{t(errorKey(ledger.error))}</div></div>
  const { counts, currentChapter } = ledger
  return (
    <div className={css.page}>
      <div className={css.health}>
        <span>{t('ledger.active', { count: counts.active })}</span>
        <span className={counts.overdue > 0 ? css.warn : undefined}>{t('ledger.overdue', { count: counts.overdue })}</span>
        <span>{t('ledger.resolved', { count: counts.resolved })}</span>
        <span>{t('ledger.abandoned', { count: counts.abandoned })}</span>
        {currentChapter > 0 && <span className={css.muted}>{t('ledger.current', { n: currentChapter })}</span>}
      </div>
      <section className={css.section}>
        <h3 className={css.sectionHeading}>{t('ledger.liveSection')}</h3>
        {ledger.active.length === 0
          ? <div className={css.muted}>{t('ledger.empty')}</div>
          : ledger.active.map(view => (
            <LedgerRow key={view.cardId} view={view} marks={ledger.marks[view.cardId] ?? []} chapters={currentChapter} navigate={navigate} t={t} />
          ))}
        {ledger.active.length > 0 && <div className={css.legend}>{t('ledger.legend')}</div>}
      </section>
      {ledger.resolved.length > 0 && (
        <section className={css.section}>
          <h3 className={css.sectionHeading}>{t('ledger.resolvedSection')}</h3>
          {ledger.resolved.map(view => (
            <LedgerRow key={view.cardId} view={view} marks={ledger.marks[view.cardId] ?? []} chapters={currentChapter} navigate={navigate} t={t} />
          ))}
        </section>
      )}
    </div>
  )
}

function LedgerRow({ view, marks, chapters, navigate, t }: {
  readonly view: ForeshadowView
  readonly marks: readonly LedgerMark[]
  readonly chapters: number
  readonly navigate: NovelNavigate
  readonly t: TranslateNS<'novel'>
}): ReactNode {
  const heading = `${view.ref} ${view.question}`
  const resolved = view.state === '已揭晓'
  return (
    <button type="button" className={css.ledgerRow} onClick={() => { navigate.openCard(view.cardId, heading) }}>
      <div className={css.ledgerHead}>
        <span className={css.ref}>{view.ref}</span>
        <span className={css.question}>{view.question}</span>
        {!resolved && view.slept !== undefined && view.slept > 0 && (
          <span className={view.slept >= OVERDUE ? css.badgeWarn : css.badge}>{t('ledger.slept', { n: view.slept })}</span>
        )}
        {view.tension !== undefined && (
          <span className={css.tension} title={t('ledger.tension', { n: view.tension })}>
            {'●'.repeat(clampTension(view.tension))}<span className={css.tensionOff}>{'○'.repeat(5 - clampTension(view.tension))}</span>
          </span>
        )}
      </div>
      <div className={css.ledgerMeta}>
        <span>{view.state}</span>
        {view.plantedAt !== undefined && <span>{t('ledger.planted', { n: view.plantedAt })}</span>}
        {resolved && view.answer !== undefined && <span>{t('ledger.answer', { answer: view.answer })}</span>}
      </div>
      <Track marks={marks} chapters={chapters} t={t} />
    </button>
  )
}

/** One cell per chapter 1..current; a chapter with several marks shows the latest. */
function Track({ marks, chapters, t }: { readonly marks: readonly LedgerMark[]; readonly chapters: number; readonly t: TranslateNS<'novel'> }): ReactNode {
  const last = Math.max(chapters, ...marks.map(mark => mark.chapter))
  if (last <= 0 || marks.length === 0) return <div className={css.trackEmpty}>{t('ledger.noMarks')}</div>
  const byChapter = new Map<number, LedgerMark>()
  for (const mark of marks) {
    // A reconciled mark outranks a merely planned one for the same chapter.
    const seen = byChapter.get(mark.chapter)
    if (seen === undefined || (!seen.reconciled && mark.reconciled) || seen.reconciled === mark.reconciled) byChapter.set(mark.chapter, mark)
  }
  return (
    <div className={css.track}>
      {Array.from({ length: last }, (_, index) => index + 1).map((n) => {
        const mark = byChapter.get(n)
        return (
          <span
            key={n}
            className={css.trackCell}
            data-kind={mark?.kind}
            data-missed={mark !== undefined && !mark.reconciled ? 'true' : undefined}
            title={mark === undefined ? String(n) : t('ledger.markTitle', { n, kind: t(`pending.mention.${mark.kind}`) })}
          >
            {mark === undefined ? '' : t(`ledger.mark.${mark.kind}`)}
          </span>
        )
      })}
    </div>
  )
}

function clampTension(value: number): number {
  return Math.max(0, Math.min(5, Math.round(value)))
}
