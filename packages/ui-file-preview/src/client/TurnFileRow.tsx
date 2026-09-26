/** TurnFileRow: the turn's product table — every file the turn created or
 * edited, as a compact table in the `conversation.chat.turnTail` slot.
 *
 * The paths come from the host `filePreview.turnFiles` RPC — the single
 * source of truth (write/edit calls, Code Mode dispatches, render-intent
 * paths, and bash captures all land here), fetched once per session through
 * the turn-files cache. 0.1.6-alpha.2 re-kinded the slot chain → list; the
 * 2026-09-24 convergence decision keeps ONLY this row in the slot: the
 * official deliverables entry (present card + memory-resident changes card)
 * is shadowed by an empty lower-priority registration under its cell id (see
 * index.ts), superseding the 2026-09-18 coexistence. On a 0.1.5 host the
 * registration keeps the old chain preemption instead. Either way the row
 * itself decides visibility from its data.
 *
 * Density: up to three products render as plain rows; beyond that the card
 * collapses to a "N 个产物" summary row that expands in place. Every file
 * click goes through the owner's `openFile` — the official openResource
 * route, where this package's tab type claims the renderable addresses on
 * both host lines (extension band over the official document tab's
 * fallback) — so one file is one tab for every origin.
 * Until the fetch settles — or when the turn has no files, or the fetch fails
 * — the card renders nothing. */

import { useEffect, useState } from 'react'
import type { FilePreviewTurnFile } from '@khorsheed/dsh-file-preview/types'
import type { FilePreviewTurnRowProps } from './contract.ts'
import { FileTypeIcon } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconChevronDownOutlineMedium, IconChevronUpOutlineMedium } from './icons.tsx'
import { basename } from './turn-files.ts'
import { parentPath } from './path-utils.ts'
import css from './TurnFileRow.module.css'

/** Above this many products the card collapses to the summary row. */
const COLLAPSE_OVER = 3

/**
 * Render one turn's products as a compact table, fetched from the host.
 * @param props - session standard kit (sessionId), the turn-tail owner (turn,
 *   openFile), the injected turn-files loader, and the locale seat.
 */
export function TurnFileRow(props: FilePreviewTurnRowProps) {
  const { sessionId, openFile, turnFiles, t } = props
  const turn = props.turn.turn
  const [files, setFiles] = useState<readonly FilePreviewTurnFile[] | null>(null)
  // Expanded means: the table is showing. Default: showing at ≤3 products,
  // collapsed to the summary row above that.
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    let cancelled = false
    setFiles(null)
    setExpanded(false)
    void turnFiles(sessionId, turn).then((loaded) => {
      if (cancelled) return
      setFiles(loaded)
    })
    return () => { cancelled = true }
  }, [sessionId, turn, turnFiles])
  // Data not arrived, or nothing to show: the card stays invisible (on the
  // list-kind slot every entry renders; visibility is decided here).
  if (files === null || files.length === 0) return null
  const collapsible = files.length > COLLAPSE_OVER
  const showing = !collapsible || expanded
  return (
    <div className={css.card} data-turn-file-row>
      {collapsible && (
        <button
          type="button"
          className={css.summary}
          aria-expanded={expanded}
          onClick={() => { setExpanded(value => !value) }}
        >
          <span className={css.summaryText}>{t('turn.count', { count: files.length })}</span>
          <span className={css.chevron} aria-hidden>
            {/* Accordion convention: collapsed → down (click unfolds downward),
                open → up (click folds the body back up). */}
            {expanded ? <IconChevronUpOutlineMedium /> : <IconChevronDownOutlineMedium />}
          </span>
        </button>
      )}
      {showing && (
        <div className={css.list} role="table" aria-label={t('turn.count', { count: files.length })}>
          {files.map((file) => {
            const dir = parentPath(file.path)
            return (
              <button
                key={file.path}
                type="button"
                role="row"
                className={css.file}
                title={file.path}
                // Every path goes through the owner's openFile — the official
                // openResource route, where our tab type claims the renderable
                // addresses on both host lines (fileAddressFor keeps
                // outside-workspace absolutes inside the session address, and
                // our detail view renders them via the Remote read), so one
                // file is one tab for every origin.
                onClick={() => { void openFile(file.path) }}
              >
                <FileTypeIcon path={file.path} size={14} className={css.fileIcon} />
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
        </div>
      )}
    </div>
  )
}
