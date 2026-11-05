/**
 * Member compaction row ('room-compaction' keyed renderer): one dim line in
 * the boundary register — 「📦 尼尔盖曼 已压缩上下文 · 560K → 41K tok · 用量 21K」
 * — whose summary (when the CLI gave one: Kimi does, Codex does not) opens
 * below it on click. A failed compaction reads as such, with its reason; a
 * member that does not report compaction data (no record this round) says
 * so instead of claiming a compaction with no numbers.
 *
 * The numbers are the run's core compaction fact, read through the room
 * state's execution reading (batch 5 S6: never copied into the room); a row
 * from before S6 shows the copies it stored. The sizes are the context's
 * before and after — never usage; only 用量 is the compaction call's spend.
 */
import { useState, useSyncExternalStore, type ReactNode } from 'react'
import type { RoomCompactionViewProps } from './slots.ts'
import { formatTokens } from './RoomStatsLine.tsx'
import { compactionNumbers } from './round-usage.ts'
import css from './RoomCompactionView.module.css'

const NO_STATE = (): undefined => undefined
const NO_SUBSCRIBE = (): (() => void) => () => {}

export function RoomCompactionView({ node, sessionId, roomStore, t }: RoomCompactionViewProps): ReactNode {
  const data = node.data
  const [open, setOpen] = useState(false)
  const state = useSyncExternalStore(roomStore?.subscribe ?? NO_SUBSCRIBE, roomStore === undefined ? NO_STATE : () => roomStore.getCached(sessionId))
  const execution = data.runId === undefined ? undefined : state?.executions?.find(entry => entry.id === data.runId)
  const numbers = compactionNumbers(data, execution)
  const unreported = data.unreported === true || numbers.unreported === true
  const parts = [
    data.outcome !== 'completed' ? t('compaction.failed', { member: data.member })
      : unreported ? t('compaction.unreported', { member: data.member })
      : t('compaction.done', { member: data.member }),
    ...numbers.beforeTokens !== undefined && numbers.afterTokens !== undefined ? [`${formatTokens(numbers.beforeTokens)} → ${formatTokens(numbers.afterTokens)} tok`] : [],
    ...numbers.usage === undefined ? [] : [t('compaction.usage', { tokens: formatTokens(numbers.usage) })],
    ...data.outcome === 'completed' || data.error === undefined ? [] : [data.error],
  ]
  const summary = data.summary
  return (
    <div className={css.row} data-outcome={data.outcome}>
      <button type="button" className={css.line} disabled={summary === undefined} aria-expanded={summary === undefined ? undefined : open} onClick={() => { setOpen(!open) }}>
        <span aria-hidden>📦</span>
        <span className={css.text}>{parts.join(' · ')}</span>
        {summary !== undefined && <span className={css.toggle}>{open ? t('compaction.hideSummary') : t('compaction.showSummary')}</span>}
      </button>
      {open && summary !== undefined && <div className={css.summary}>{summary}</div>}
    </div>
  )
}
