/**
 * The experiment card that replaces the generic `eval_plan_draft` tool row
 * (I5·T76 · D3): the experiment the call drafted, in the lab's words — name,
 * the person's question when the plan carries one, scale, dataset version,
 * status — and one action, 打开实验.
 *
 * No approve button, and none will be added (ui-spec R1): starting spends
 * compute and is a person's decision taken on the design page, where the
 * readiness checks sit beside it. The card is a pointer to that page.
 * @module @khorsheed/dsh-eval/client
 */
import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EvalExperimentStatus } from '../types.ts'
import type { LabViewProps } from './contract.ts'
import { draftCardOf, type DraftToolBlock } from './draft-card.ts'
import { Chip, statusKey, statusTone } from './parts.tsx'
import css from './DraftCard.module.css'

/** What the card reaches outside its own block, bound to the card's session. */
export interface DraftCardFace {
  /** The lab list's status for this experiment; null when the list has no row for it (yet). */
  loadStatus: (experimentId: string) => Promise<EvalExperimentStatus | null>
  /** Mark the experiment in the lab tab's list (there is no tab switch to call). */
  openExperiment: (experimentId: string) => void
}

/** The props the keyed tool slot composes for this card. */
export interface DraftCardProps extends DraftCardFace {
  block: DraftToolBlock
  t: LabViewProps['t']
}

/**
 * Render one `eval_plan_draft` call as an experiment card.
 * @param props - the tool block, the session-bound face, the copy.
 */
export function DraftCard(props: DraftCardProps) {
  const { block, loadStatus, openExperiment, t } = props
  const card = draftCardOf(block)
  const [status, setStatus] = useState<EvalExperimentStatus | null>(null)
  const [opened, setOpened] = useState(false)
  const { experimentId } = card

  // Read once per mount: the block is frozen, and the status is the one field
  // that moves after the call. A list that fails or lacks the row leaves the
  // card at 草稿 — the state the draft verb itself leaves an experiment in.
  useEffect(() => {
    if (experimentId === null) return
    let cancelled = false
    void loadStatus(experimentId).then((value) => {
      if (!cancelled) setStatus(value)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [experimentId, loadStatus])

  const scale = card.items !== null && card.conditions !== null && card.reps !== null
    ? t('overview.shapeValue', {
      items: card.items,
      conditions: card.conditions,
      reps: card.reps,
      cells: card.items * card.conditions * card.reps,
    })
    : null
  const shown = status ?? 'draft'

  return (
    <div className={css.card} data-tool="eval_plan_draft" data-state={card.state}>
      <div className={css.head}>
        <span className={css.kind}>{t('card.kind')}</span>
        <span className={css.name} title={card.name ?? undefined}>{card.name ?? '—'}</span>
        {card.state === 'ready' && <Chip tone={statusTone(shown)} title={t('card.status')}>{t(statusKey(shown))}</Chip>}
      </div>
      {card.state === 'running' && <div className={css.note}>{t('card.running')}</div>}
      {card.state === 'failed' && <div className={css.warn}>{t('card.failed')}</div>}
      {card.state === 'unreadable' && <div className={css.note}>{t('card.unreadable')}</div>}
      {card.state === 'ready' && (
        <>
          <dl className={css.facts}>
            {card.question !== null && (
              <>
                <dt>{t('card.question')}</dt>
                <dd className={css.question}>{card.question}</dd>
              </>
            )}
            {scale !== null && (
              <>
                <dt>{t('card.scale')}</dt>
                <dd>{scale}</dd>
              </>
            )}
            {card.dataset !== null && (
              <>
                <dt>{t('card.dataset')}</dt>
                <dd>{card.dataset}</dd>
              </>
            )}
          </dl>
          {card.errors > 0 && <div className={css.warn}>{t('card.errors', { errors: card.errors })}</div>}
          <div className={css.actions}>
            <Button
              size="sm"
              onClick={() => {
                if (experimentId === null) return
                openExperiment(experimentId)
                setOpened(true)
              }}
            >
              {t('card.open')}
            </Button>
            {opened && <span className={css.note}>{t('card.opened')}</span>}
          </div>
        </>
      )}
    </div>
  )
}
