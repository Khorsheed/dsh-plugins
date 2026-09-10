/** TurnFileRow: the turn's product table — every file the turn created or
 * edited, as a compact table replacing the official deliverables row (user
 * decision 2026-09-11: the official presented card's spacing/density read
 * wrong and never collapses; this table is the single turn-tail surface).
 *
 * The paths come from the host `filePreview.turnFiles` RPC — the single
 * source of truth (write/edit calls, Code Mode dispatches, render-intent
 * paths, and bash captures all land here), fetched once per session through
 * the turn-files cache. The entry registers at priority -1 — deliberately
 * BEFORE the official deliverables entry (default 0): the chain elects the
 * first non-null select in ascending priority order (ui-slots ChainSelect
 * contract), and this card's unconditional claim means the official row never
 * mounts while this plugin is composed (the preemption retired at the S1 move
 * returns as a product decision, in table form).
 *
 * Density: up to three products render as plain rows; beyond that the card
 * collapses to a "N 个产物" summary row that expands in place. Every file
 * click goes through the owner's `openFile` — the official openResource route
 * our tab type claims — so one file is one detail tab for every origin.
 * Until the fetch settles — or when the turn has no files, or the fetch fails
 * — the card renders nothing. */

import { useEffect, useState } from 'react'
import type { FilePreviewTurnFile } from '@khorsheed/dsh-file-preview/types'
import type { FilePreviewTurnRowProps } from './contract.ts'
import {
  FileTypeIcon, IconChevronDownOutline14, IconChevronUpOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { basename } from './turn-files.ts'
import { parentPath } from './path-utils.ts'
import css from './TurnFileRow.module.css'

/** Above this many products the card collapses to the summary row. */
const COLLAPSE_OVER = 3

/**
 * Render one turn's products as a compact table, fetched from the host.
 * @param props - session standard kit (sessionId), the chain owner (turn,
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
  // Data not arrived, or nothing to show: the card stays invisible (the chain
  // claims every turn; visibility is decided here).
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
            {expanded ? <IconChevronUpOutline14 /> : <IconChevronDownOutline14 />}
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
                // openResource route. Our tab type claims renderable
                // session-scoped addresses (fileAddressFor keeps outside-
                // workspace absolutes inside the session address, and our
                // detail view renders them via the Remote read), so one file
                // is one tab for every origin.
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
