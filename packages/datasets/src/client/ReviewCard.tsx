/**
 * T96 · the card that replaces the generic `datasets_propose_registration`
 * tool row: the proposal the call filed, in the review's words, and one
 * action — 核对并登记 — that opens that proposal's review in this session's
 * 题集 tab (skipping the list and its banner).
 *
 * A dry run gets the same card without the button (nothing was filed: the
 * check's verdict is the whole story); an error or a result this card does
 * not know says so in one quiet line. The card never registers anything — the
 * review page is where a person confirms (decision A).
 * @module @khorsheed/dsh-datasets/client
 */
import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DatasetsViewProps } from './contract.ts'
import { Chip } from './parts.tsx'
import { proposeCardOf, switchToTab, type ProposeToolBlock } from './review-card.ts'
import css from './ReviewCard.module.css'

/** What the card reaches outside its own block, bound to the card's session. */
export interface ReviewCardFace {
  /** Whether the proposal still waits for a person; null when the list cannot be read. */
  loadPending: (proposalId: string) => Promise<boolean | null>
  /** Leave the request for this session's 题集 tab (it opens the review when it mounts). */
  openReview: (proposalId: string) => void
}

/** The props the keyed tool slot composes for this card. */
export interface ReviewCardProps extends ReviewCardFace {
  block: ProposeToolBlock
  t: DatasetsViewProps['t']
}

/** How long the card waits before it reads whether the tab click took. */
const SWITCH_SETTLE_MS = 150

/**
 * Render one `datasets_propose_registration` call.
 * @param props - the tool block, the session-bound face, the copy.
 */
export function ReviewCard(props: ReviewCardProps) {
  const { block, loadPending, openReview, t } = props
  const card = proposeCardOf(block)
  const root = useRef<HTMLDivElement>(null)
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

  // A switch that took unmounts the chat view, and this card with it; one
  // still on screen a moment later means the click did not select the tab.
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (settle.current !== null) clearTimeout(settle.current) }, [])

  const open = (): void => {
    if (proposalId === null) return
    openReview(proposalId)
    const tab = switchToTab(root.current, t('open'))
    if (tab === null) {
      setOpened('manual')
      return
    }
    setOpened('switched')
    settle.current = setTimeout(() => {
      settle.current = null
      if (tab.isConnected && tab.getAttribute('aria-selected') !== 'true') setOpened('manual')
    }, SWITCH_SETTLE_MS)
  }

  const kindText = card.kind === 'update' ? t('card.kindUpdate') : t('card.kindNew')
  return (
    <div ref={root} className={css.card} data-tool="datasets_propose_registration" data-state={card.state}>
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
            {card.warnings > 0 && ` · ${t('card.warnings', { count: card.warnings })}`}
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
