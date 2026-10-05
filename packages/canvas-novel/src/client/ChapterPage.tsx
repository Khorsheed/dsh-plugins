/**
 * The chapter page: the phase lamp (规划 → 写作 → 对账 → 审过), the chapter's
 * plan, the text as a reading column, this chapter's pending items in place,
 * and the person's 「✓ 审过本章」 — the one gesture that closes a chapter,
 * offered only once the text is reconciled and its pending items are handled
 * (otherwise the bar says what is still missing).
 *
 * @module @khorsheed/dsh-canvas-novel/client
 */
import { useState, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { NOVEL_GENRE_ID, type ChapterPlan, type EffectiveChapterPhase, type NovelChapterResult } from '../types.ts'
import type { NovelPageOwnerProps, NovelSurfaceProps } from './contract.ts'
import { PendingList } from './PendingStrip.tsx'
import { errorKey, useNovelRead } from './use-novel.ts'
import css from './novel.module.css'

const LAMP = ['lamp.plan', 'lamp.write', 'lamp.extract', 'lamp.review'] as const

/** How far along the lamp a phase is (the lit step). */
const LAMP_STEP: Readonly<Record<EffectiveChapterPhase, number>> = {
  planning: 0, writing: 1, fileMissing: 1, extracted: 2, reviewed: 4,
}

/** The `novel:chapter` page entry (param: the chapter number). */
export function ChapterPage(props: NovelSurfaceProps<NovelPageOwnerProps>): ReactNode {
  const { canvasId, board, rev, param, navigate, sessionId, remote, t } = props
  const api = remote()
  const n = Number(param)
  const read = useNovelRead(api, r => r.chapter({ canvasId, n }), `chapter:${canvasId}:${n}`, rev)
  const pending = useNovelRead(api, r => r.pending({ canvasId }), `pending:${canvasId}`, rev)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  if (board.genre?.id !== NOVEL_GENRE_ID || api === undefined) return null
  if (read.state === 'loading') return <div className={css.page}><div className={css.muted}>{t('state.loading')}</div></div>
  if (read.state === 'error') return <div className={css.page}><div className={css.warn}>{t('error.generic', { message: read.message })}</div></div>
  const view = read.value
  if (!view.ok || view.chapter === undefined) return <div className={css.page}><div className={css.warn}>{t(errorKey(view.error))}</div></div>
  const chapter = view.chapter
  const phase = view.phase ?? 'planning'
  const items = pending.state === 'ready' ? pending.value.items.filter(item => item.chapter === n) : []

  const gesture = async (call: 'reviewChapter' | 'confirmPlan'): Promise<void> => {
    if (sessionId === undefined) return
    setBusy(true)
    setFailure(null)
    try {
      const result = await api[call](sessionId, { canvasId, n })
      if (!result.ok) setFailure(t('error.generic', { message: result.error.message }))
      else if (!result.value.ok) setFailure(t(errorKey(result.value.error)))
      navigate.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`${css.page} ${css.chapterPage}`}>
      <header className={css.chapterHead}>
        <Lamp phase={phase} t={t} />
        {chapter.wordCount !== undefined && <span className={css.muted}>{t('chapter.words', { count: chapter.wordCount })}</span>}
      </header>
      <PlanBlock
        plan={chapter.plan}
        names={view.names}
        confirmed={chapter.planConfirmedAt !== undefined}
        canConfirm={sessionId !== undefined && phase === 'planning' && chapter.plan !== undefined && chapter.planConfirmedAt === undefined}
        busy={busy}
        onConfirm={() => { void gesture('confirmPlan') }}
        t={t}
      />
      {items.length > 0 && (
        <section className={css.section}>
          <h3 className={css.sectionHeading}>{t('chapter.pendingHeading')}</h3>
          <PendingList canvasId={canvasId} items={items} navigate={navigate} sessionId={sessionId} remote={api} t={t} />
        </section>
      )}
      <Prose view={view} phase={phase} t={t} />
      {view.file !== undefined && <div className={css.footer}><span className={css.path}>{view.file}</span></div>}
      <div className={css.reviewBar}>
        {failure !== null && <span className={css.warn}>{failure}</span>}
        {phase === 'reviewed' ? (
          <span className={css.reviewedMark}>✓ {t('chapter.reviewed')}</span>
        ) : (
          <>
            <span className={css.muted}>{gateText(phase, items.length, sessionId !== undefined, t)}</span>
            <button
              type="button"
              className={css.reviewButton}
              disabled={busy || sessionId === undefined || phase !== 'extracted' || items.length > 0}
              onClick={() => { void gesture('reviewChapter') }}
            >
              {t('chapter.review')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/** Why ✓ 审过 is not offered yet ('' when it is). */
function gateText(phase: EffectiveChapterPhase, pending: number, writable: boolean, t: TranslateNS<'novel'>): string {
  if (!writable) return t('chapter.gate.readOnly')
  if (phase === 'planning') return t('chapter.gate.planning')
  if (phase === 'writing') return t('chapter.gate.writing')
  if (phase === 'fileMissing') return t('chapter.gate.fileMissing')
  if (pending > 0) return t('chapter.gate.pending', { count: pending })
  return ''
}

/** The phase as a compact stepper: ✓ for passed steps, a ring on the current one. */
function Lamp({ phase, t }: { readonly phase: EffectiveChapterPhase; readonly t: TranslateNS<'novel'> }): ReactNode {
  const step = LAMP_STEP[phase]
  return (
    <ol className={css.stepper} aria-label={t(`phase.${phase}`)}>
      {LAMP.map((key, index) => (
        <li key={key} className={css.step} data-state={index < step ? 'done' : index === step ? 'current' : 'todo'} data-warn={phase === 'fileMissing' && index === step ? 'true' : undefined}>
          <span className={css.stepDot}>{index < step ? '✓' : ''}</span>
          {t(key)}
        </li>
      ))}
    </ol>
  )
}

function PlanBlock({ plan, names, confirmed, canConfirm, busy, onConfirm, t }: {
  readonly plan: ChapterPlan | undefined
  readonly names: NovelChapterResult['names']
  readonly confirmed: boolean
  readonly canConfirm: boolean
  readonly busy: boolean
  readonly onConfirm: () => void
  readonly t: TranslateNS<'novel'>
}): ReactNode {
  if (plan === undefined) return <div className={css.planEmpty}>{t('chapter.noPlan')}</div>
  const named = (id: string): string => names[id] ?? id
  const ops = plan.foreshadowOps.map(op => `${op.op} ${op.id === undefined ? op.question ?? '' : named(op.id)}`.trim())
  return (
    <section className={css.plan}>
      <div className={css.planHead}>
        <span className={css.sectionHeading}>{t('chapter.plan')}</span>
        {confirmed && <span className={css.done}>{t('chapter.planConfirmed')}</span>}
        {canConfirm && (
          <button type="button" className={css.button} disabled={busy} onClick={onConfirm}>{t('chapter.confirmPlan')}</button>
        )}
      </div>
      <div className={css.planGoal}>{plan.goal}</div>
      <div className={css.planMeta}>
        {plan.pov !== undefined && <span>{t('chapter.pov')}：{named(plan.pov)}</span>}
        {ops.length > 0 && <span>{t('chapter.foreshadows')}：{ops.join('、')}</span>}
        {plan.characters.length > 0 && <span>{t('chapter.characters')}：{plan.characters.map(named).join('、')}</span>}
      </div>
      {plan.hook !== undefined && <div className={css.planMeta}><span>{t('chapter.hook')}：{plan.hook}</span></div>}
    </section>
  )
}

/** The text as a reading column; markdown headings stay headings, the rest are paragraphs. */
function Prose({ view, phase, t }: { readonly view: NovelChapterResult; readonly phase: EffectiveChapterPhase; readonly t: TranslateNS<'novel'> }): ReactNode {
  const body = view.body ?? ''
  if (body.trim() === '') {
    return phase === 'fileMissing'
      ? <div className={css.warn}>{t('chapter.fileMissing', { file: view.file ?? '' })}</div>
      : <div className={css.planEmpty}>{t('chapter.noBody')}</div>
  }
  const lines = body.split('\n').map(line => line.trim()).filter(line => line !== '')
  return (
    <article className={css.prose}>
      {lines.map((line, index) => line.startsWith('#')
        ? <h4 key={index} className={css.proseHeading}>{line.replace(/^#+\s*/, '')}</h4>
        : <p key={index}>{line}</p>)}
    </article>
  )
}
