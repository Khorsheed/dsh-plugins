/**
 * T96 · the 「核对并登记」 entry: one card per proposal a Turn filed, rendered
 * in that Turn's tail (beneath the closing prose, outside the folded tool
 * group — review-turn.ts says why). The card names the proposal and carries
 * one action that opens that proposal's review in the global 「题集」 panel
 * (T97; skipping the list and its banner), or — on a host without that
 * panel — leaves it for this session's 题集 tab.
 *
 * The card model also reads dry runs, failures and unknown results (each says
 * so in one quiet line, no button) so the card stays honest for any block it
 * is handed; the tail hands it filed results only. The card never registers
 * anything — the review page is where a person confirms (decision A).
 * @module @khorsheed/dsh-datasets/client
 */
import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DatasetsViewProps } from './contract.ts'
import { Chip } from './parts.tsx'
import { proposeCardOf, type ProposeToolBlock } from './review-card.ts'
import { proposedInTurn, type ProposedTurnOwner } from './review-turn.ts'
import css from './ReviewCard.module.css'

/** What the card reaches outside its own block, bound to the card's session. */
export interface ReviewCardFace {
  /** Whether the proposal still waits for a person; null when the list cannot be read. */
  loadPending: (proposalId: string) => Promise<boolean | null>
  /**
   * Open the review: true when the global 「题集」 panel took it (the panel is
   * now on screen); false when the request was left for this session's 题集
   * tab instead (it opens the review when it mounts).
   */
  openReview: (proposalId: string) => boolean
}

/** One card's props: the block, the session-bound face, the copy. */
export interface ReviewCardProps extends ReviewCardFace {
  block: ProposeToolBlock
  t: DatasetsViewProps['t']
}

/**
 * Render one `datasets_propose_registration` call.
 * @param props - the tool block, the session-bound face, the copy.
 */
export function ReviewCard(props: ReviewCardProps) {
  const { block, loadPending, openReview, t } = props
  const card = proposeCardOf(block)
  const [pending, setPending] = useState<boolean | null>(null)
  const [opened, setOpened] = useState<null | 'switched' | 'manual'>(null)
  const { proposalId } = card

  useEffect(() => {
    if (proposalId === null) return
    let cancelled = false
    void loadPending(proposalId).then((value) => {
      if (!cancelled) setPending(value)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [proposalId, loadPending])

  const open = (): void => {
    if (proposalId === null) return
    setOpened(openReview(proposalId) ? 'switched' : 'manual')
  }

  const kindText = card.kind === 'update' ? t('card.kindUpdate') : t('card.kindNew')
  return (
    <div className={css.card} data-tool="datasets_propose_registration" data-state={card.state}>
      <div className={css.head}>
        <span className={css.kind}>{card.state === 'checked' ? t('card.check') : kindText}</span>
        <span className={css.name} title={card.name ?? undefined}>{card.name ?? '—'}</span>
        {card.state === 'filed' && pending === false && <Chip tone="neutral">{t('card.handled')}</Chip>}
        {card.state === 'checked' && (
          <Chip tone={card.problems > 0 ? 'danger' : 'ok'}>
            {card.problems > 0 ? t('card.checkProblems', { count: card.problems }) : t('card.checkOk')}
          </Chip>
        )}
      </div>
      {card.state === 'running' && <div className={css.note}>{t('card.running')}</div>}
      {card.state === 'failed' && <div className={css.warn}>{t('card.failed')}</div>}
      {card.state === 'unreadable' && <div className={css.note}>{t('card.unreadable')}</div>}
      {card.state === 'checked' && <div className={css.note}>{t('card.checkNote')}</div>}
      {card.state === 'filed' && (
        <>
          <div className={css.note}>
            {pending === false ? t('card.handledNote') : t('card.filedNote')}
            {card.warnings > 0 && ` ${t('card.warnings', { count: card.warnings })}`}
          </div>
          <div className={css.actions}>
            <Button size="sm" variant={pending === false ? 'outline' : 'primary'} onClick={open}>
              {pending === false ? t('card.view') : t('card.open')}
            </Button>
            {opened === 'switched' && <span className={css.note} role="status">{t('card.opened')}</span>}
            {opened === 'manual' && <span className={css.note} role="status">{t('card.openedManual')}</span>}
          </div>
        </>
      )}
    </div>
  )
}

/** The props ui-chat's `conversation.chat.turnTail` list composes for this entry. */
export interface ReviewTurnTailProps extends ReviewCardFace, ProposedTurnOwner {
  t: DatasetsViewProps['t']
}

/**
 * The Turn-tail entry: one card per proposal the Turn filed, nothing otherwise.
 * @param props - the closing Turn's owner props, the session-bound face, the copy.
 */
export function ReviewTurnTail(props: ReviewTurnTailProps) {
  const filed = proposedInTurn(props)
  if (filed.length === 0) return null
  return (
    <div className={css.tail}>
      {filed.map((block, index) => (
        <ReviewCard
          key={block.seq ?? index}
          block={block}
          loadPending={props.loadPending}
          openReview={props.openReview}
          t={props.t}
        />
      ))}
    </div>
  )
}
