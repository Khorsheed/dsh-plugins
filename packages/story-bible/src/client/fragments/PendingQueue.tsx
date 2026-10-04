/**
 * 待审队列: pinned at the fragments tab's bottom, red-dot counted on the
 * chip. Every item shows its confidence dots (●●○), its evidence quote, and
 * the ✓/✗ pair; a new character is marked 新角色 (gate 3: they ALWAYS wait
 * for a person). The extract row's 「去处理」 pulses it into view.
 *
 * @module @khorsheed/dsh-story-bible/client
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { PendingItem } from '../../types.ts'
import type { StoryTabProps } from '../contract.ts'
import type { WorkShell } from '../data.ts'
import css from '../fragments.module.css'

/** The queue's props: the tab's faces, the shell, the focus. */
export interface PendingQueueProps {
  readonly props: StoryTabProps
  readonly shell: WorkShell
  readonly workId: string
}

/** The confidence dots (●●○ = medium, ●○○ = low). */
function confDotsOf(confidence: 'medium' | 'low'): string {
  return confidence === 'medium' ? '●●○' : '●○○'
}

/** The ✓/✗ pair's labels, per kind. */
function actLabelsOf(kind: PendingItem['kind'], t: PendingQueueProps['props']['t']): [string, string] {
  if (kind === 'new-character') return [t('pending.acceptCharacter'), t('pending.dropCharacter')]
  if (kind === 'new-foreshadow' || kind === 'memory') return [t('pending.acceptMemory'), t('pending.dropMemory')]
  if (kind === 'experience') return [t('pending.acceptExperience'), t('pending.dropExperience')]
  if (kind === 'mention') return [t('pending.acceptMention'), t('pending.dropMention')]
  return [t('pending.accept'), t('pending.drop')]
}

/** One payload's one-line summary. */
function summaryOf(item: PendingItem): string {
  const payload = item.payload
  if (item.kind === 'new-character') return `「${payload.name ?? ''}」${payload.identity === undefined ? '' : `——${payload.identity}`}`
  if (item.kind === 'new-foreshadow') return `${payload.question ?? ''}`
  if (item.kind === 'mention') return `${payload.kind ?? ''} ${payload.foreshadowId ?? ''}`
  if (item.kind === 'experience') return `${payload.characterId ?? ''}：${payload.entry ?? ''}`
  if (item.kind === 'plan-missed') return item.reason
  return payload.content ?? item.reason
}

/** The pending queue. */
export function PendingQueue({ props, shell, workId }: PendingQueueProps): ReactNode {
  const { t, decidePending } = props
  const sessionId = props.sessionId
  const rev = props.useStory(current => current.rev)
  const pulse = props.useStory(current => current.pendingPulse)
  const [items, setItems] = useState<readonly PendingItem[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const value = await shell.run(() => props.listPending({ workId }))
      if (!cancelled && value !== null) setItems(value)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId, rev])

  const decide = (id: string, action: 'accept' | 'discard'): void => {
    if (sessionId === undefined) return
    void (async () => {
      const value = await shell.run(() => decidePending(sessionId, { workId, id, action }))
      if (value === null) return
      if (!value.ok) {
        shell.showToast(shell.errorText(value.error))
        return
      }
      setItems(current => current?.filter(item => item.id !== id) ?? current)
      props.refresh()
      void shell.reloadShell()
      shell.showToast(t(action === 'accept' ? 'toast.pendingAccepted' : 'toast.pendingDropped'))
    })()
  }

  if (items === null || items.length === 0) return null

  return (
    <div className={css.review} data-pending-queue>
      <div className={css.reviewTitle}>{t('pending.title')}</div>
      {items.map(item => (
        <div key={item.id} className={css.rv} data-pulse={pulse > 0 || undefined}>
          {item.kind === 'new-character'
            ? <span className={css.rvConf} data-new="true">{t('pending.newCharacter')}</span>
            : <span className={css.rvConf} data-low={item.confidence === 'low' || undefined}>{confDotsOf(item.confidence)}</span>}
          <span className={css.rvMain}>
            {item.kind === 'new-character' ? `${summaryOf(item)}（${item.reason}）` : summaryOf(item)}
            {item.kind === 'plan-missed' && <span className={css.rvEvidence}>{t('pending.missedNote')}</span>}
            {item.evidenceInText !== undefined && (
              <span className={css.rvEvidence}>{t('pending.evidence', { text: item.evidenceInText })}</span>
            )}
          </span>
          {sessionId !== undefined && (
            <span className={css.rvActs}>
              {(() => {
                const [accept, drop] = actLabelsOf(item.kind, t)
                return (
                  <>
                    <button type="button" data-ok="true" onClick={() => { decide(item.id, 'accept') }}>{accept}</button>
                    <button type="button" data-no="true" onClick={() => { decide(item.id, 'discard') }}>{drop}</button>
                  </>
                )
              })()}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
