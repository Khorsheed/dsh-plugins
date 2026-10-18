/**
 * The turn switcher: a trigger button (`turn N · query 预览`) opening the
 * host's own `Menu` (ui-primitives — keyboard walk, Escape / outside-click,
 * and focus return are the host's), one row per turn: turn number + query
 * preview on the first line, request count and token totals on the second.
 * Purpose pseudo-turns (no `hostTurn`) show their purpose label without a
 * turn number, same as the query line.
 *
 * @module @khorsheed/dsh-context-lens/client
 */
import { useState, type ReactNode } from 'react'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TurnListItem } from '../types.ts'
import { fmtK } from './aggregate.ts'
import type { InspectorTabProps } from './contract.ts'
import { IconChevronDownOutlineMedium } from './icons.tsx'
import css from './TurnMenu.module.css'

/** The panel's translate face. */
type T = InspectorTabProps['t']

/** One turn's one-line title: `turn N · query` for real turns, the purpose label otherwise. */
export function turnTitle(turn: TurnListItem, t: T): string {
  return turn.hostTurn === undefined
    ? turn.query === 'compaction' ? t('compaction.title') : turn.query
    : `${t('turn.label', { seq: String(turn.hostTurn) })} · ${turn.query}`
}

/** One menu row: the title line, then request count + token totals. */
function TurnRow({ turn, t }: { readonly turn: TurnListItem; readonly t: T }) {
  return (
    <span className={css.row}>
      <span className={css.rowTitle}>{turnTitle(turn, t)}</span>
      <span className={css.rowMeta}>
        {t('turn.rowMeta', {
          count: String(turn.requestCount),
          input: fmtK(turn.totalInputTokens),
          output: fmtK(turn.totalOutputTokens),
        })}
      </span>
    </span>
  )
}

export interface TurnMenuProps {
  /** The session's turns, newest last. */
  readonly turns: readonly TurnListItem[]
  /** The selected turn's seq (null while the list loads). */
  readonly turnSeq: number | null
  /** Row activation: select that turn. */
  readonly onSelect: (turnSeq: number) => void
  readonly t: T
}

/** The turn switcher menu. */
export function TurnMenu({ turns, turnSeq, onSelect, t }: TurnMenuProps): ReactNode {
  const [open, setOpen] = useState(false)
  const current = turns.find(candidate => candidate.turnSeq === turnSeq)
  return (
    <Menu
      open={open}
      portal
      compact
      selectedId={turnSeq === null ? undefined : String(turnSeq)}
      // Newest first: the overwhelmingly common destination is a recent turn.
      items={[...turns].reverse().map(candidate => ({
        id: String(candidate.turnSeq),
        label: <TurnRow turn={candidate} t={t} />,
      }))}
      onSelect={id => {
        setOpen(false)
        onSelect(Number(id))
      }}
      onClose={() => { setOpen(false) }}
      anchor={(
        <button
          type="button"
          className={css.trigger}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t('turn.switch')}
          onClick={() => { setOpen(value => !value) }}
        >
          <span className={css.triggerLabel}>{current === undefined ? t('turn.switch') : `${current.hostTurn ?? (current.query === 'compaction' ? t('compaction.title') : current.query)} / ${turns.at(-1)?.hostTurn ?? turns.length}`}</span>
          <IconChevronDownOutlineMedium />
        </button>
      )}
    />
  )
}
