/**
 * Member compaction row ('room-compaction' keyed renderer): one dim line in
 * the boundary register — 「📦 尼尔盖曼 已压缩上下文 · 560K → 41K tok · 用量 21K」
 * — whose summary (when the CLI gave one: Kimi does, Codex does not) opens
 * below it on click. A failed compaction reads as such, with its reason; a
 * member that does not report compaction data (no record this round) says
 * so instead of claiming a compaction with no numbers.
 */
import { useState, type ReactNode } from 'react'
import type { RoomCompactionViewProps } from './slots.ts'
import { formatTokens } from './RoomStatsLine.tsx'
import css from './RoomCompactionView.module.css'

export function RoomCompactionView({ node, t }: RoomCompactionViewProps): ReactNode {
  const data = node.data
  const [open, setOpen] = useState(false)
  const usage = data.usage === undefined ? undefined
    : data.usage.inputTokens + (data.usage.cacheReadTokens ?? 0) + (data.usage.cacheWriteTokens ?? 0) + data.usage.outputTokens
  const parts = [
    data.outcome !== 'completed' ? t('compaction.failed', { member: data.member })
      : data.unreported === true ? t('compaction.unreported', { member: data.member })
      : t('compaction.done', { member: data.member }),
    ...data.beforeTokens !== undefined && data.afterTokens !== undefined ? [`${formatTokens(data.beforeTokens)} → ${formatTokens(data.afterTokens)} tok`] : [],
    ...usage === undefined ? [] : [t('compaction.usage', { tokens: formatTokens(usage) })],
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
