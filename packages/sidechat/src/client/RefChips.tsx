/**
 * The ref chip row: one chip per ref, clicking a chip expands it INLINE to
 * the full quoted block (label + full text, collapsible) — the quote's body
 * travels with the conversation, so the user never round-trips to the source
 * tab to check it. The expansion renders in flow below the chip row (never
 * an absolutely-positioned popover: the panel roots clip overflow).
 *
 * Shared by the pending-refs row above the composer and the transcript's
 * user rows (whose refs the journal projection lifts back out of the fold).
 *
 * @module @khorsheed/dsh-sidechat/client
 */
import { useState, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { SideChatRef } from '../types.ts'
import css from './SideChatPanel.module.css'

/** One row of expandable ref chips. */
export function RefChips({ refs, t }: {
  readonly refs: readonly SideChatRef[]
  readonly t: TranslateNS<'sidechat'>
}): ReactNode {
  const [expanded, setExpanded] = useState<number | null>(null)
  return (
    <div className={css.refs}>
      <div className={css.refChips}>
        {refs.map((ref, index) => (
          <button
            key={`${index}-${ref.label}`}
            type="button"
            className={css.refChip}
            data-expanded={expanded === index ? 'true' : 'false'}
            title={ref.text}
            aria-expanded={expanded === index}
            onClick={() => { setExpanded(current => (current === index ? null : index)) }}
          >
            {ref.label}
          </button>
        ))}
      </div>
      {expanded !== null && refs[expanded] !== undefined && (
        <div className={css.refBody}>
          <div className={css.refBodyHead}>
            <span className={css.refBodyLabel}>{refs[expanded].label}</span>
            <button
              type="button"
              className={css.refBodyClose}
              onClick={() => { setExpanded(null) }}
            >
              {t('refs.collapse')}
            </button>
          </div>
          <div className={css.refBodyText}>{refs[expanded].text}</div>
        </div>
      )}
    </div>
  )
}
