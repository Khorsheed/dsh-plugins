/**
 * 退回给 agent… (T84 §五): the send-back panel under the stage bar.
 *
 * The reviewer writes what to change, picks up any of the page's own findings
 * as one-click suggestions, and the text — the experiment's name and id at the
 * head, «改完请跑 eval validate» at the tail — is PRE-FILLED in a composer,
 * never sent. The current session's composer is the default; the session that
 * drafted the experiment is offered when it is a different one.
 *
 * The degrade chain (§5.2 ④): the drafting session (open it, then retry the
 * draft while its composer mounts) → this session's composer, said so → the
 * clipboard → the text on the page for a manual copy.
 */
import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EvalExperimentRow, EvalPlanCheck, EvalPlanReview } from '../types.ts'
import type { LabViewProps } from './contract.ts'
import { readinessSentence } from './journey.ts'
import css from './LabView.module.css'

/** One suggestion chip: its label and the sentence it appends. */
export interface SendBackSuggestion {
  key: string
  label: string
  text: string
}

/**
 * The composer text: who the experiment is, what to change, and how the
 * reviewer will re-check it.
 * @param name - the experiment's display name.
 * @param id - the experiment id (what `eval_experiment_get` takes).
 * @param body - the reviewer's own words.
 * @param t - the locale lookup.
 */
export function sendBackText(name: string, id: string, body: string, t: LabViewProps['t']): string {
  return t('sendBack.template', { name, id, text: body.trim() })
}

/**
 * The suggestions the page can already argue for: more than one factor
 * differs, a stage scope short of an item's stages, and the reminders.
 * @param row - the open experiment's list row.
 * @param review - the plan review, when it has answered.
 * @param reminders - the readiness reminders (warn lines) on the page.
 * @param t - the locale lookup.
 */
export function sendBackSuggestions(
  row: Pick<EvalExperimentRow, 'factors'> | undefined,
  review: Pick<EvalPlanReview, 'items'> | null,
  reminders: readonly EvalPlanCheck[],
  t: LabViewProps['t'],
): SendBackSuggestion[] {
  const out: SendBackSuggestion[] = []
  const factors = row?.factors ?? []
  if (factors.length > 1) {
    out.push({
      key: 'factors',
      label: t('sendBack.chip.oneFactor'),
      text: t('sendBack.say.oneFactor', { count: factors.length, fields: factors.join('、') }),
    })
  }
  const partial = (review?.items?.items ?? []).filter(item =>
    item.runStages != null && item.phases !== undefined && item.runStages.length < item.phases.length)
  if (partial.length > 0) {
    const missing = [...new Set(partial.flatMap(item =>
      (item.phases ?? []).filter(stage => !(item.runStages ?? []).includes(stage))))]
    const items = partial.map(item => item.id.split('-')[0] ?? item.id).join('/')
    out.push({
      key: 'stages',
      label: t('sendBack.chip.stages', { items, stages: missing.join('、') }),
      text: t('sendBack.say.stages', { items: partial.map(item => item.id).join('、'), stages: missing.join('、') }),
    })
  }
  reminders.forEach((check, index) => {
    const sentence = readinessSentence(check)
    const said = sentence === null ? check.message : t(sentence.key, sentence.params)
    out.push({ key: `remind:${check.code}:${String(index)}`, label: said, text: t('sendBack.say.remind', { text: said }) })
  })
  return out
}

/** How long the drafting session's composer gets to mount before we give up on it. */
const ORIGIN_RETRIES_MS = [0, 250, 600, 1200, 2000]

/**
 * Put the text in the drafting session's composer: open that session, then
 * try the draft while its conversation scope comes up.
 * @param origin - the drafting session.
 * @param text - the composer text.
 * @param props - the two host doors.
 */
function draftInOrigin(
  origin: string,
  text: string,
  props: Pick<LabViewProps, 'openSession' | 'insertDraft'>,
): Promise<boolean> {
  try {
    props.openSession(origin as never, null)
  } catch {
    return Promise.resolve(false)
  }
  return new Promise((resolve) => {
    let attempt = 0
    const tick = (): void => {
      let ok = false
      try { ok = props.insertDraft(origin as never, text) } catch { ok = false }
      if (ok) { resolve(true); return }
      attempt += 1
      const wait = ORIGIN_RETRIES_MS[attempt]
      if (wait === undefined) { resolve(false); return }
      setTimeout(tick, wait - (ORIGIN_RETRIES_MS[attempt - 1] ?? 0))
    }
    tick()
  })
}

/** Where the text ended up — the notice the page shows. */
export type SendBackOutcome = 'origin' | 'here' | 'hereFallback' | 'copied' | 'manual'

/**
 * Run the degrade chain.
 * @param target - where the reviewer asked for the text.
 * @param text - the composer text.
 * @param props - the host doors.
 */
export async function deliverSendBack(
  target: { kind: 'here'; sessionId: string } | { kind: 'origin'; sessionId: string; origin: string },
  text: string,
  props: Pick<LabViewProps, 'openSession' | 'insertDraft'> & { writeClipboard: (text: string) => Promise<boolean> },
): Promise<SendBackOutcome> {
  if (target.kind === 'origin') {
    if (await draftInOrigin(target.origin, text, props)) return 'origin'
  }
  let here = false
  try { here = props.insertDraft(target.sessionId as never, text) } catch { here = false }
  if (here) return target.kind === 'origin' ? 'hereFallback' : 'here'
  return (await props.writeClipboard(text)) ? 'copied' : 'manual'
}

/**
 * The panel itself.
 * @param props - the experiment, the page's findings and the host doors.
 */
export function SendBackPanel(props: {
  sessionId: string
  row: EvalExperimentRow
  review: EvalPlanReview | null
  reminders: readonly EvalPlanCheck[]
  onCancel: () => void
  /** Called with the composer text and the target; the caller runs the chain. */
  onSubmit: (text: string, target: 'here' | 'origin') => void
  t: LabViewProps['t']
}) {
  const { sessionId, row, review, reminders, onCancel, onSubmit, t } = props
  const [body, setBody] = useState('')
  const [target, setTarget] = useState<'here' | 'origin'>('here')
  const suggestions = sendBackSuggestions(row, review, reminders, t)
  const origin = row.originSession
  const offerOrigin = origin !== null && origin !== '' && origin !== sessionId
  const append = (text: string): void => {
    setBody(prev => (prev.trim() === '' ? text : `${prev.replace(/\s+$/, '')}\n${text}`))
  }
  return (
    <div className={css.sendBack} role="group" aria-label={t('sendBack.title')}>
      <label className={css.sendBackLabel} htmlFor="eval-send-back-text">{t('sendBack.title')}</label>
      <textarea
        id="eval-send-back-text"
        className={css.sendBackText}
        rows={3}
        value={body}
        placeholder={t('sendBack.placeholder')}
        onChange={(e) => { setBody(e.target.value) }}
      />
      {suggestions.length > 0 && (
        <div className={css.sendBackChips}>
          <span className={css.sendBackKey}>{t('sendBack.suggest')}</span>
          {suggestions.map(s => (
            <button key={s.key} type="button" className={css.sendBackChip} title={s.text} onClick={() => { append(s.text) }}>
              {s.label}
            </button>
          ))}
        </div>
      )}
      {offerOrigin && (
        <div className={css.sendBackTarget} role="radiogroup" aria-label={t('sendBack.target')}>
          <span className={css.sendBackKey}>{t('sendBack.target')}</span>
          <label>
            <input type="radio" name="eval-send-back-target" checked={target === 'here'} onChange={() => { setTarget('here') }} />
            {t('sendBack.target.here')}
          </label>
          <label>
            <input type="radio" name="eval-send-back-target" checked={target === 'origin'} onChange={() => { setTarget('origin') }} />
            {t('sendBack.target.origin')}
          </label>
        </div>
      )}
      <div className={css.sendBackActions}>
        <span className={css.sendBackKey}>{t('sendBack.never')}</span>
        <Button size="sm" variant="outline" onClick={onCancel}>{t('sendBack.cancel')}</Button>
        <Button
          size="sm"
          variant="primary"
          disabled={body.trim() === ''}
          onClick={() => { onSubmit(sendBackText(row.name, row.experimentId ?? row.id, body, t), offerOrigin ? target : 'here') }}
        >
          {t('sendBack.submit')}
        </Button>
      </div>
    </div>
  )
}
