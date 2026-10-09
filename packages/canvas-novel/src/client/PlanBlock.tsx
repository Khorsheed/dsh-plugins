/**
 * One chapter's plan as the reader meets it. It changes role with the
 * chapter: while planning it is the lead (open, with 「✓ 确认计划」); once
 * there is text it folds to one line so the text leads; after extraction that
 * line says how much of the plan the text carried, and each beat and
 * foreshadow op is marked ✓ or ✗ (a missed op is also in 待审; a missed beat
 * is only a reminder).
 *
 * @module @khorsheed/dsh-canvas-novel/client
 */
import { useState, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { capacityOf, type ChapterRecord, type EffectiveChapterPhase, type ForeshadowOp, type PlanBeat } from '../types.ts'
import css from './novel.module.css'

const OP_KEYS = { 推进: 'plan.op.advance', 暗示: 'plan.op.hint', 新埋: 'plan.op.plant', 揭晓: 'plan.op.resolve' } as const
const MARK_KEYS = { 转折: 'plan.mark.turn', 落点: 'plan.mark.land' } as const

/** The plan block; the empty line when the chapter has no plan, nothing for the person's own draft (its 原稿 tag says so). */
export function PlanBlock({ chapter, phase, names, words, canConfirm, busy, onConfirm, t }: {
  readonly chapter: ChapterRecord
  readonly phase: EffectiveChapterPhase
  /** The chapter's 目标字数 (its plan's, else the outline's per-chapter default). */
  readonly words?: number
  /** Display names of the card ids the plan uses. */
  readonly names: Readonly<Record<string, string>>
  readonly canConfirm: boolean
  readonly busy: boolean
  readonly onConfirm: () => void
  readonly t: TranslateNS<'novel'>
}): ReactNode {
  // A plan waiting on the person leads whatever the phase: a chapter re-planned
  // after its text was written reads 写作中, and its folded plan used to hide
  // the only ✓ 确认计划 while the gate refused the body (2026-10-09).
  const awaiting = chapter.plan !== undefined && chapter.planConfirmedAt === undefined && chapter.byUser !== true
  const lead = phase === 'planning' || awaiting
  const [open, setOpen] = useState(lead)
  const plan = chapter.plan
  if (chapter.byUser === true && plan === undefined) return null
  if (plan === undefined) return <div className={css.planEmpty}>{t('chapter.noPlan')}</div>
  const confirmed = chapter.planConfirmedAt !== undefined
  const delivery = chapter.delivery
  const named = (id: string): string => names[id] ?? id
  const opsMissed = delivery === undefined ? 0 : delivery.ops.filter(hit => !hit).length
  const summary = lead
    ? t(confirmed ? 'plan.confirmed' : 'plan.awaiting')
    : delivery === undefined
      ? t('plan.counts', { beats: plan.beats.length, ops: plan.foreshadowOps.length })
      : t('plan.delivery', {
        beats: delivery.beats.filter(Boolean).length, beatsTotal: plan.beats.length,
        ops: delivery.ops.filter(Boolean).length, opsTotal: plan.foreshadowOps.length,
      })
  return (
    <section className={css.plan} data-lead={lead || undefined} data-open={open || undefined}>
      <button type="button" className={css.planHead} aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
        <span className={css.planLabel}>{t('chapter.plan')}</span>
        <span className={css.planSum}>
          {summary}
          {opsMissed > 0 && <span className={css.miss}> · {t('plan.missed', { count: opsMissed })}</span>}
        </span>
        <span className={css.planChev}>›</span>
      </button>
      {open && (
        <div className={css.planBody}>
          {words !== undefined && <Budget words={words} beats={plan.beats.length} actual={chapter.wordCount} t={t} />}
          <p className={css.gist}>{plan.summary}</p>
          <dl className={css.kv}>
            {plan.beats.length > 0 && (
              <>
                <dt>{t('plan.beats')}</dt>
                <dd>
                  <ol className={css.beats}>
                    {plan.beats.map((beat, index) => (
                      <BeatRow key={index} beat={beat} index={index} hit={delivery?.beats[index]} t={t} />
                    ))}
                  </ol>
                </dd>
              </>
            )}
            {plan.conflict !== undefined && <><dt>{t('plan.conflict')}</dt><dd>{plan.conflict}</dd></>}
            {plan.highlight !== undefined && <><dt>{t('plan.highlight')}</dt><dd>{plan.highlight}</dd></>}
            {plan.foreshadowOps.length > 0 && (
              <>
                <dt>{t('plan.ops')}</dt>
                <dd>
                  <ul className={css.ops}>
                    {plan.foreshadowOps.map((op, index) => (
                      <OpRow key={index} op={op} named={named} hit={delivery?.ops[index]} t={t} />
                    ))}
                  </ul>
                </dd>
              </>
            )}
            {plan.cast.length > 0 && (
              <>
                <dt>{t('plan.cast')}</dt>
                <dd>
                  <ul className={css.ops}>
                    {plan.cast.map((member, index) => (
                      <li key={index}>
                        <span className={css.castName}>
                          {named(member.who)}
                          {member.who === plan.pov && <em className={css.pov}>{t('plan.pov')}</em>}
                        </span>
                        {member.role !== undefined && <span className={css.what}>{member.role}</span>}
                      </li>
                    ))}
                  </ul>
                </dd>
              </>
            )}
            {plan.infoGaps !== undefined && (
              <>
                <dt>{t('plan.infoGaps')}</dt>
                <dd>
                  <ul className={css.ops}>
                    {plan.infoGaps.map((gap, index) => (
                      <li key={index}>
                        <span className={css.castName}>{named(gap.who)}</span>
                        <span className={css.what}>{t('plan.learns', { fact: gap.fact })}</span>
                      </li>
                    ))}
                  </ul>
                </dd>
              </>
            )}
            {plan.hook !== undefined && <><dt>{t('plan.hook')}</dt><dd>{plan.hook}</dd></>}
          </dl>
          {lead && (
            <div className={css.planActs}>
              {confirmed
                ? <span className={css.done}>{t('plan.readyToWrite')}</span>
                : (
                  <>
                    {canConfirm && (
                      <button type="button" className={css.confirm} disabled={busy} onClick={onConfirm}>{t('chapter.confirmPlan')}</button>
                    )}
                    <span className={css.muted}>{t('plan.confirmHint')}</span>
                  </>
                )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function BeatRow({ beat, index, hit, t }: {
  readonly beat: PlanBeat
  readonly index: number
  readonly hit: boolean | undefined
  readonly t: TranslateNS<'novel'>
}): ReactNode {
  return (
    <li>
      <span className={css.beatAt}><b>{index + 1}</b>{beat.at ?? ''}</span>
      <span className={css.tx}>
        {beat.text}
        {beat.mark !== undefined && <span className={css.beatMark} data-mark={beat.mark === '转折' ? 'turn' : 'land'}>{t(MARK_KEYS[beat.mark])}</span>}
      </span>
      {hit !== undefined && <span className={css.res} data-hit={hit}>{t(hit ? 'plan.hit' : 'plan.beatMiss')}</span>}
    </li>
  )
}

function OpRow({ op, named, hit, t }: {
  readonly op: ForeshadowOp
  readonly named: (id: string) => string
  readonly hit: boolean | undefined
  readonly t: TranslateNS<'novel'>
}): ReactNode {
  const subject = op.id === undefined ? op.question ?? '' : named(op.id)
  return (
    <li>
      <span className={css.opTag}>{t(OP_KEYS[op.op])}</span>
      <span className={css.tx}>
        <span className={css.opRef}>{subject}</span>
        {op.note !== undefined && <span className={css.what}>{op.note}</span>}
      </span>
      {hit !== undefined && <span className={css.res} data-hit={hit}>{t(hit ? 'plan.hit' : 'plan.opMiss')}</span>}
    </li>
  )
}

/**
 * The plan's word budget: the target, how many beats it holds, and — once
 * the text is reconciled — the actual count beside it. Over the room it reads
 * as a reminder, never a gate.
 */
function Budget({ words, beats, actual, t }: {
  readonly words: number
  readonly beats: number
  readonly actual: number | undefined
  readonly t: TranslateNS<'novel'>
}): ReactNode {
  const room = capacityOf(words)
  const over = beats > room.beats[1]
  return (
    <div className={css.budget} data-over={over || undefined}>
      <span>{actual === undefined
        ? t('plan.words', { words: words.toLocaleString() })
        : t('plan.actual', { words: words.toLocaleString(), actual: actual.toLocaleString() })}</span>
      <span className={css.budgetSay}>{over
        ? t('plan.over', { beats, words: words.toLocaleString(), high: room.beats[1] })
        : t('plan.room', { low: room.beats[0], high: room.beats[1] })}</span>
    </div>
  )
}
