/** TurnFileRow: the mutation card a finished turn ends with — every file the
 * turn created or edited, as a titled card with per-file line deltas. The
 * paths come from the turn-mutations fold plus the official deliverables
 * vocabulary (never from the closing prose); clicking a file opens the
 * file-preview drawer in place rather than the host OS. Long turns collapse:
 * the body folds away from the header chevron, and an expanded card caps its
 * visible rows behind a "show more" row. */

import { useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { basename, type TurnFilePath } from './turn-files.ts'
import { parentPath } from './path-utils.ts'
import type { NS } from './locales.ts'
import css from './TurnFileRow.module.css'

/** Rows visible before the "show more" overflow row takes over. */
const SHOWN_LIMIT = 5

/** Full props: the selector-matched mutated entries and the drawer opener. */
export type TurnFileRowProps = {
  /** Mutated entries in first-seen order (selector-matched). */
  matched: readonly TurnFilePath[]
  /** Open the file-preview drawer for one path (the injected face). */
  openDrawer: (path: string) => void
} & PropsLocale<typeof NS>

/**
 * Render one turn's mutated files as a summary card.
 * @param props - matched entries, the drawer opener, and the locale seat.
 */
export function TurnFileRow({ matched: files, openDrawer, t }: TurnFileRowProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const overflow = files.length - SHOWN_LIMIT
  const shown = expanded || overflow <= 0 ? files : files.slice(0, SHOWN_LIMIT)
  return (
    <div className={css.card} data-turn-file-row>
      <button
        type="button"
        className={css.header}
        aria-expanded={!collapsed}
        onClick={() => { setCollapsed(value => !value) }}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden className={css.headerIcon}>
          <path
            d="M3 2.5h6.5L13 6v7.5H3z M9.5 2.5V6H13"
            fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"
          />
        </svg>
        <span className={css.headerText}>
          {t(files.length === 1 ? 'turn.summaryOne' : 'turn.summary', { count: files.length })}
        </span>
        <span className={css.chevron} aria-hidden>{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed && (
        <div className={css.list}>
          {shown.map((file) => {
            const dir = parentPath(file.path)
            return (
              <button
                key={file.path}
                type="button"
                className={css.file}
                title={file.path}
                onClick={() => { openDrawer(file.path) }}
              >
                <span className={css.name}>{basename(file.path)}</span>
                {dir !== '' && <span className={css.dir}>{dir}</span>}
                <span className={css.stats}>
                  {file.added !== undefined && file.added > 0 && (
                    <span className={css.added}>+{file.added}</span>
                  )}
                  {file.removed !== undefined && file.removed > 0 && (
                    <span className={css.removed}>−{file.removed}</span>
                  )}
                </span>
              </button>
            )
          })}
          {overflow > 0 && (
            <button
              type="button"
              className={css.overflowToggle}
              onClick={() => { setExpanded(value => !value) }}
            >
              {expanded ? t('turn.collapse') : t('turn.expand', { count: overflow })}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
