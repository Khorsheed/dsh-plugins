/**
 * The document-tab renderer variant: one file's change history as a
 * switchable body of the official document tab.
 *
 * Registration is the official two-step: the implementation metadata into
 * `ctx.documentPreviews` (suffix-matched, `priority: 'builtin'` so the
 * official renderer keeps the default and this one appears in the toolbar
 * dropdown) and this component into the keyed `sidebar.right.tab.document`
 * seat under the same id. The owner's prepared `content` is ignored — the
 * diffs come from the host `filePreview.list` fold (the same source the tab
 * body reads), matched by workspace-resolved path.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { parseFileAddress, resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import type { DocumentPreviewProps } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type { FilePreviewEntry } from '@khorsheed/dsh-file-preview/types'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { FilePreviewTabInjected } from './contract.ts'
import { DiffHistory } from './DiffHistory.tsx'
import css from './FilePreviewTab.module.css'

/** Full props of the change-history document body (owner + injected + locale shares). */
export type FileHistoryBodyProps =
  & DocumentPreviewProps
  & InjectFace<Pick<FilePreviewTabInjected, 'listFiles'>>
  & PropsLocale<'filePreview'>

/**
 * Render the change history for the document tab's file: every recorded
 * write/edit diff with the stepper. Files with no recorded changes (and
 * addresses outside the session scope) get the empty notice.
 * @param props - the document seat's owner props plus the injected Remote face.
 */
export function FileHistoryBody(props: FileHistoryBodyProps): ReactNode {
  const { resourceAddress, scrollportRef, listFiles, useSessions, t } = props
  const parsed = parseFileAddress(resourceAddress)
  const sessionId = parsed?.scope === 'session' ? parsed.sessionId as SessionId : undefined
  const path = parsed?.scope === 'session' ? parsed.path : undefined
  const cwd = useSessions(s => (sessionId === undefined ? undefined : s.byId[sessionId]?.cwd))
  // undefined while the fetch is in flight; null for an unreadable or
  // unrecorded file (the empty notice covers both — the document tab's own
  // failure line already said why an unreadable file failed).
  const [entry, setEntry] = useState<FilePreviewEntry | null | undefined>(undefined)
  useEffect(() => {
    if (sessionId === undefined || path === undefined) {
      setEntry(null)
      return undefined
    }
    let cancelled = false
    setEntry(undefined)
    void listFiles(sessionId).then((result) => {
      if (cancelled) return
      if (!result.ok) {
        setEntry(null)
        return
      }
      // The fold records paths as the tool call spelled them (often relative);
      // the address path is root-relative — compare both resolved to absolute.
      const target = resolveWorkspacePath(cwd, path)
      setEntry(result.value.entries.find(e => resolveWorkspacePath(cwd, e.path) === target) ?? null)
    })
    return () => { cancelled = true }
  }, [sessionId, path, cwd, listFiles])

  return (
    <div className={css.historyScroll} ref={scrollportRef}>
      {entry === undefined && <div className={css.empty}>{t('list.loading')}</div>}
      {entry !== undefined && (entry === null || entry.diffs.length === 0) && (
        <div className={css.empty}>{t('history.empty')}</div>
      )}
      {entry != null && entry.diffs.length > 0 && <DiffHistory entry={entry} t={t} />}
    </div>
  )
}
