/** TurnFileRow: the mutation card a finished turn ends with — every file the
 * turn created or edited, as a titled card with per-file line deltas. The
 * paths come from the host `filePreview.turnFiles` RPC — the single source of
 * truth shared with the products tab (write/edit calls, Code Mode dispatches,
 * render-intent paths, and bash captures all land here), fetched once per
 * session through the turn-files cache. Clicking a file opens the file-preview
 * drawer in place rather than the host OS. Long turns collapse: the body folds
 * away from the header chevron, and an expanded card caps its visible rows
 * behind a "show more" row. Until the fetch settles — or when the turn has no
 * files, or the fetch fails — the card renders nothing. */

import { useEffect, useState } from 'react'
import type { FilePreviewTurnFile } from '@khorsheed/dsh-file-preview/types'
import type { FilePreviewTurnRowProps } from './contract.ts'
import {
  IconChevronDownOutline14, IconChevronRightOutline14, IconFolderOpenOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { basename } from './turn-files.ts'
import { parentPath } from './path-utils.ts'
import css from './TurnFileRow.module.css'

/** Rows visible before the "show more" overflow row takes over. */
const SHOWN_LIMIT = 5

/**
 * Render one turn's mutated files as a summary card, fetched from the host.
 * @param props - session standard kit (sessionId), the chain owner (turn), the
 *   injected drawer opener + turn-files loader, and the locale seat.
 */
export function TurnFileRow(props: FilePreviewTurnRowProps) {
  const { sessionId, openDrawer, turnFiles, t } = props
  const turn = props.turn.turn
  const [files, setFiles] = useState<readonly FilePreviewTurnFile[] | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    let cancelled = false
    setFiles(null)
    void turnFiles(sessionId, turn).then((loaded) => {
      if (cancelled) return
      setFiles(loaded)
    })
    return () => { cancelled = true }
  }, [sessionId, turn, turnFiles])
  // Data not arrived, or nothing to show: the card stays invisible (the chain
  // claims every turn; visibility is decided here).
  if (files === null || files.length === 0) return null
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
        <IconFolderOpenOutline16 size={14} className={css.headerIcon} />
        <span className={css.headerText}>
          {t(files.length === 1 ? 'turn.summaryOne' : 'turn.summary', { count: files.length })}
        </span>
        <span className={css.chevron} aria-hidden>
          {collapsed ? <IconChevronRightOutline14 /> : <IconChevronDownOutline14 />}
        </span>
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
