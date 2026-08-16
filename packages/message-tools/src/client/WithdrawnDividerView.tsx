/**
 * Withdrawal divider row ('message-tools-withdrawn' keyed renderer), redone
 * in the official compaction-marker visual language: one dim clickable row
 * (chevron +「已撤回 N 条消息」), expanding in place to a read-only replay of
 * the withdrawn span (user originals + assistant text) with a「恢复到对话
 * 末尾」action. The restore tail-replays the span's replayable entries (user
 * messages + assistant text) — the surface fold is positional, so in-place
 * restoration is impossible — and the divider carries a「已恢复」badge while
 * a live restore row cites the span (withdrawing the restored rows clears
 * the badge and re-enables the action). The「重新编辑」action was removed
 * once withdrawals backfill the draft automatically.
 */
import { useState, type ReactNode } from 'react'
import { Button, IconChevronDownOutline14, IconChevronRightOutline14, MessageText } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconUndoOutline16 } from './icons.tsx'
import {
  collectWithdrawnEntries, countHiddenInSpan, foldHiddenRanges, hasRestoreForSpan, type WithdrawnEntry,
} from './withdrawn-node.ts'
import type { WithdrawnDividerViewProps } from './slots.ts'
import css from './WithdrawnDividerView.module.css'

/** The withdrawal divider: collapsed marker row plus the expandable replay. */
export function WithdrawnDividerView({
  node, t, useSession, restoreMessage,
}: WithdrawnDividerViewProps): ReactNode {
  const data = node.data
  const [expanded, setExpanded] = useState(false)
  const [entries, setEntries] = useState<readonly WithdrawnEntry[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  // The node store is a stable live reader: the count/badge selectors read
  // through it, and the expand click folds the replay from the live snapshot
  // (event handlers may read live snapshots; render code subscribes).
  const nodesStore = useSession(snapshot => snapshot.chat.nodes)
  const count = useSession(snapshot => countHiddenInSpan(
    snapshot.chat.nodes.values(), data.hiddenStartSeq, data.seq,
  ))
  // The badge tracks a LIVE restore row: withdrawing the restored rows again
  // clears it and re-enables the restore action (the events stay in the log).
  const restored = useSession((snapshot) => {
    const nodes = snapshot.chat.nodes.values()
    return hasRestoreForSpan(nodes, data.hiddenStartSeq, foldHiddenRanges(nodes))
  })

  const toggle = (): void => {
    if (expanded) {
      setExpanded(false)
      return
    }
    setEntries(collectWithdrawnEntries(nodesStore.values(), data.hiddenStartSeq, data.seq))
    setExpanded(true)
  }
  const restore = (): void => {
    setBusy(true)
    setFailed(false)
    void restoreMessage(data.hiddenStartSeq)
      .catch(() => { setFailed(true) })
      .finally(() => { setBusy(false) })
  }

  return (
    <div className={css.row}>
      <button
        type="button"
        className={css.marker}
        aria-expanded={expanded}
        aria-label={t('withdrawn.expand')}
        onClick={toggle}
      >
        <span className={css.leading} aria-hidden>
          {expanded ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
        </span>
        <span className={css.title}>{t('withdrawn.divider', { count })}</span>
        {restored && (
          <span className={css.badge}>
            <IconUndoOutline16 />
            {t('withdrawn.restored')}
          </span>
        )}
      </button>
      {expanded && (
        <div className={css.body}>
          {entries === null || entries.length === 0 ? (
            <div className={css.empty}>{t('withdrawn.empty')}</div>
          ) : (
            entries.map((entry, index) => (
              <div key={index} className={entry.kind === 'user' ? css.entryUser : css.entryAssistant}>
                <div className={css.entryKind}>
                  {entry.kind === 'user' ? t('withdrawn.entryUser') : t('withdrawn.entryAssistant')}
                </div>
                <MessageText text={entry.text} />
              </div>
            ))
          )}
          <div className={css.restoreRow}>
            <Button
              variant="outline"
              disabled={busy || restored}
              onClick={restore}
            >
              {t('withdrawn.restore')}
            </Button>
            {failed && <span className={css.restoreFailed} role="status">{t('withdrawn.restoreFailed')}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
