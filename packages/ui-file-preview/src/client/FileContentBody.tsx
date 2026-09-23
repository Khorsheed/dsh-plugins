/**
 * The document-tab content renderer: one file's current content as the
 * DEFAULT body of the official document tab (0.1.7-rc.1 and later).
 *
 * Registration is the official two-step, same as the change-history
 * renderer's: the implementation metadata into `ctx.documentPreviews`
 * (suffix-matched, default `extension` band — an external implementation outranks
 * the official renderers, so file clicks land here while every official
 * renderer stays in the toolbar dropdown) and this component into the keyed
 * `sidebar.right.tab.document` seat under the same id.
 *
 * `loading: 'renderer'` keeps the read on this plugin's own Remote instead of
 * the owner's paged workspace read: the host `read` resolves outside-workspace
 * absolute paths (the workspace-scoped official read cannot), so bash-written
 * products outside the workspace keep rendering — the self-drawn 0.1.5 tab's
 * headline capability the official frame would otherwise lose. The owner
 * drives reloads through the renderer content's `revision` (its toolbar
 * reload, and auto-refresh when the file's resource version moves); the body
 * reports settlement through `loaded(version)` / `failed()`.
 *
 * The body is the shared content pane (@khorsheed/dsh-client-ui-content-preview)
 * with this plugin's adapter (preview.ts): document-form previews (markdown,
 * JSON tree, CSV table, sandboxed HTML tiers, highlighted code), content
 * search, and the copy-path gesture ride along unchanged. The frame's own
 * gestures (open in app / reveal) come from the official
 * `sidebar.right.tab.document.actions` contributions, so the pane's folder/IDE
 * chrome is NOT repeated here; the change history is the dropdown's sibling
 * renderer (FileHistoryBody), so the pane's content⇄diff toggle is not
 * repeated either.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { parseFileAddress, resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import type { DocumentPreviewProps } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-api-workspace-files/client'
import type { FilePreviewRead } from '@khorsheed/dsh-file-preview/types'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { ContentPane } from '@khorsheed/dsh-client-ui-content-preview/src/client/index.ts'
import type { FileContentBodyInjected } from './contract.ts'
import { previewTranslator, structuredLabels, toPreviewRead } from './preview.ts'
import css from './FilePreviewTab.module.css'

/** Full props of the content document body (owner + injected + locale shares). */
export type FileContentBodyProps =
  & DocumentPreviewProps
  & InjectFace<FileContentBodyInjected>
  & PropsLocale<'filePreview'>

/**
 * Render the document tab's file through the shared content pane, reading
 * through the plugin's own Remote.
 * @param props - the document seat's owner props plus the injected Remote face.
 */
export function FileContentBody(props: FileContentBodyProps): ReactNode {
  const { resourceAddress, content, scrollportRef, readFile, copyPath, useResource, useSessions, t } = props
  const parsed = parseFileAddress(resourceAddress)
  const sessionId = parsed?.scope === 'session' ? parsed.sessionId as SessionId : undefined
  const path = parsed?.scope === 'session' ? parsed.path : undefined
  const cwd = useSessions(s => (sessionId === undefined ? undefined : s.byId[sessionId]?.cwd))
  // The file resource's version token, reported back through `loaded` so the
  // owner's change detection (the changed bar + auto-refresh) works for this
  // renderer; outside-workspace files have no resource and stay unversioned.
  const meta = useResource<'file'>(resourceAddress)
  const request = content.kind === 'renderer' ? content : undefined
  const revision = request?.revision
  // undefined while the fetch is in flight only through the local read state
  // below; a settled fetch is either a read or an error string.
  const [read, setRead] = useState<FilePreviewRead | null>(null)
  const [error, setError] = useState<string | null>(null)
  const version = meta.value?.version
  useEffect(() => {
    if (request === undefined || sessionId === undefined || path === undefined) return undefined
    let cancelled = false
    setRead(null)
    setError(null)
    const fail = (message: string): void => {
      if (cancelled) return
      setError(message)
      request.failed()
    }
    // `version` is deliberately captured, not a dependency: a mid-flight
    // metadata bump is the owner's cue to start another revision, not ours to
    // refetch within this one.
    void readFile(sessionId, path).then((result) => {
      if (cancelled) return
      if (result.ok) {
        setRead(result.value)
        request.loaded(version ?? 'file-preview')
      } else {
        fail(result.error.message)
      }
    }).catch((transportError: unknown) => {
      fail(transportError instanceof Error ? transportError.message : String(transportError))
    })
    return () => { cancelled = true }
  }, [sessionId, path, readFile, revision, request])

  if (request === undefined) return null
  return (
    <div className={css.documentPane} ref={scrollportRef}>
      <ContentPane
        key={path ?? ''}
        path={path ?? ''}
        sessionId={sessionId}
        read={read === null ? null : toPreviewRead(read)}
        loading={read === null && error === null}
        error={error}
        displayPath={path === undefined ? undefined : resolveWorkspacePath(cwd, path)}
        {...(path === undefined ? {} : { onCopyPath: () => copyPath(resolveWorkspacePath(cwd, path)) })}
        labels={structuredLabels(t)}
        t={previewTranslator(t)}
      />
    </div>
  )
}
