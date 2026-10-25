/**
 * One decision the room made on its own ('room-decision' keyed renderer): a
 * single dim line in the room's conversation — the scenario's outcome, the
 * rule that decided or the model's probability and latency, and 查看判断 for a
 * decision that called the decision model (it opens Context Lens at that
 * request). The row reads like the relay / approval status lines.
 */
import type { ReactNode } from 'react'
import type { RoomDecisionEvent } from '../types.ts'
import type { RoomDecisionViewProps } from './slots.ts'
import css from './RoomRelayView.module.css'

type Translate = RoomDecisionViewProps['t']

/**
 * The line's text for one decision.
 * @param decision - the recorded decision.
 * @param t - the room translate.
 * @returns the outcome sentence.
 */
export function decisionLine(decision: RoomDecisionEvent, t: Translate): string {
  const failed = decision.call?.failure !== undefined
  if (decision.scenario === 'task-filing') {
    if (decision.rule === 'unavailable') return t(failed ? 'decision.filing.failed' : 'decision.filing.unavailable')
    return decision.about.task === undefined
      ? t('decision.filing.new')
      : t('decision.filing.task', { number: decision.about.task.number, title: decision.about.task.title })
  }
  const from = decision.about.from ?? ''
  const to = decision.about.to ?? ''
  if (decision.rule === 'unavailable') return t(failed ? 'decision.report.failed' : 'decision.report.unavailable', { from, to })
  if (decision.rule !== undefined) return t('decision.report.rule', { from, to, rule: t(`decision.rule.${decision.rule}` as never) })
  return t(decision.outcome === 'later' ? 'decision.report.later' : 'decision.report.now', { from, to })
}

/** The decision row. */
export function RoomDecisionView({ node, openDecision, t }: RoomDecisionViewProps): ReactNode {
  const decision = node.data.decision
  const call = decision.call
  const meta = [
    ...decision.probability === undefined ? [] : [decision.probability.toFixed(2)],
    ...call?.latencyMs === undefined ? [] : [`${(call.latencyMs / 1000).toFixed(1)}s`],
  ].join(' · ')
  return (
    <div className={css.row} data-decision={decision.scenario}>
      <span aria-hidden>{call?.failure !== undefined ? '⚠' : '🧭'}</span>
      <span className={css.text}>{decisionLine(decision, t)}</span>
      {meta !== '' && <span>{meta}</span>}
      {call !== undefined && openDecision !== undefined && (
        <button type="button" className={css.action} onClick={() => { openDecision(decision.id) }}>{t('decision.open')}</button>
      )}
    </div>
  )
}
