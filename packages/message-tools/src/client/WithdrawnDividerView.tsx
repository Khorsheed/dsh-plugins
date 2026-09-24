/**
 * Withdrawal divider row ('message-tools-withdrawn' keyed renderer), redone
 * in the official compaction-marker visual language: one dim clickable row
 * (chevron +「已撤回 N 条消息」), expanding in place to a read-only replay of
 * the withdrawn span (user originals — text and attached images — plus
 * assistant text) with a「恢复到对话
 * 末尾」action. The restore tail-replays the span's replayable entries (user
 * messages + assistant text) — the surface fold is positional, so in-place
 * restoration is impossible — and the divider carries a「已恢复」badge while
 * a live restore row cites the span (withdrawing the restored rows clears
 * the badge and re-enables the action). The「重新编辑」action was removed
 * once withdrawals backfill the draft automatically.
 */
import { useState, type ReactNode } from 'react'
import { Button, IconChevronDownOutlineMedium, IconChevronRightOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconUndoOutlineMedium } from './icons.tsx'
import {
  collectWithdrawnEntries, countHiddenInSpan, foldHiddenRanges, hasRestoreForSpan, isRestoreSuperseded,
  type WithdrawnEntry,
} from './withdrawn-node.ts'
import { chatHookOf } from './chat-hook.ts'
import type { WithdrawnDividerViewProps } from './slots.ts'
import css from './WithdrawnDividerView.module.css'

/** The withdrawal divider: collapsed marker row plus the expandable replay. */
export function WithdrawnDividerView({
  node, t, restoreMessage, renderMessageImages,
  ...standard
}: WithdrawnDividerViewProps): ReactNode {
  const data = node.data
  // The gallery closure is a required owner prop of every `conversation.chat.node`
  // renderer; widening it to `| undefined` keeps the degrade path explicit — a
  // composition without the attachment UI replays text only instead of throwing.
  const renderImages: WithdrawnDividerViewProps['renderMessageImages'] | undefined = renderMessageImages
  const [expanded, setExpanded] = useState(false)
  const [entries, setEntries] = useState<readonly WithdrawnEntry[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  // Chat data lives in the `useChat` session standard prop on host 0.1.2
  // (the helper degrades to the frozen empty snapshot without it).
  const useChatSlice = chatHookOf(standard as Pick<WithdrawnDividerViewProps, 'useChat'>)
  // The node store is a stable live reader: the count/badge selectors read
  // through it, and the expand click folds the replay from the live snapshot
  // (event handlers may read live snapshots; render code subscribes).
  const nodesStore = useChatSlice(chat => chat.nodes)
  const count = useChatSlice(chat => countHiddenInSpan(
    chat.nodes.values(), data.hiddenStartSeq, data.seq,
  ))
  // The badge tracks a LIVE restore row: withdrawing the restored rows again
  // clears it. A superseded divider still shows its historical marker, but its
  // restore action is disabled because the later re-withdrawal divider is now
  // the active restore point for the same logical content.
  const restored = useChatSlice((chat) => {
    const nodes = chat.nodes.values()
    return hasRestoreForSpan(nodes, data.hiddenStartSeq, foldHiddenRanges(nodes))
  })
  const superseded = useChatSlice((chat) => {
    const nodes = chat.nodes.values()
    return isRestoreSuperseded(nodes, data.hiddenStartSeq, foldHiddenRanges(nodes))
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
          {expanded ? <IconChevronDownOutlineMedium /> : <IconChevronRightOutlineMedium />}
        </span>
        <span className={css.title}>{t('withdrawn.divider', { count })}</span>
        {restored && (
          <span className={css.badge}>
            <IconUndoOutlineMedium />
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
                {/* The retired official MessageText primitive, kept as a local text-run block. */}
                {entry.text !== '' && <div className={css.textRun}>{entry.text}</div>}
                {renderImages !== undefined && entry.images.length > 0 && (
                  <div className={css.entryImages}>{renderImages({ images: entry.images, align: 'end' })}</div>
                )}
              </div>
            ))
          )}
          <div className={css.restoreRow}>
            <Button
              variant="outline"
              disabled={busy || restored || superseded}
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
