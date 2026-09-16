/**
 * The side-chat tab body (`sidebar.right.pane.tab`): the thin wrapper that
 * decides WHICH context the shared panel shows.
 *
 * One view-local context selection: initialized from the tab's navigation
 * params (the quote action and consumers open the tab with
 * `params.contextKey`) and following later re-navigations; the selector's
 * switches stay view-local (a later `openTab` simply re-navigates again).
 * The default is the CURRENT conversation's own context (contextKey = the
 * session id) — opening the tab in any conversation is asking beside it.
 *
 * The header's「弹出为浮层」button is offered only when the `shell.overlay`
 * seat exists (probed at mount by the inject face): without the seat the tab
 * is the whole surface, which is the degrade, not an error.
 *
 * @module @khorsheed/dsh-sidechat/client
 */
import { useEffect, useState, type ReactNode } from 'react'
import { IconBrowseOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SideChatTabParams } from './definition.ts'
import type { SideChatViewProps } from './contract.ts'
import { SideChatPanel } from './SideChatPanel.tsx'
import { useOpenWithSurfacer } from './use-open-with-surfacer.ts'
import panelCss from './SideChatPanel.module.css'

/** The side-chat tab body. */
export function SideChatView({
  sessionId, useSessions, usePanelInfo, useTabInfo, t,
  getState, listContexts, send, surfaceHints, dockAvailable, openDock, openTab,
}: SideChatViewProps): ReactNode {
  const { tab } = useTabInfo()
  const params = tab.navigation.params as SideChatTabParams | undefined
  const navContext = params?.contextKey
  const revision = tab.navigation.revision
  const fallbackLabel = useSessions(sessions => sessions.byId[sessionId]?.displayTitle) ?? String(sessionId)

  const [contextKey, setContextKey] = useState(navContext ?? String(sessionId))
  // A re-navigation (quote action, a consumer's openTab, the surfacer's)
  // re-aims the view; the selector's own switches are view-local and never
  // write navigation.
  useEffect(() => {
    setContextKey(navContext ?? String(sessionId))
  }, [navContext, revision, sessionId])

  // The fallback surfacer: only while the overlay seat is ABSENT (the dock
  // is the primary otherwise, and the two never double-fire). It only ever
  // re-navigates this tab — a host without the overlay seat surfaces nothing
  // while the tab itself is closed (documented degrade).
  const dockSeated = dockAvailable()
  const activePanelId = usePanelInfo(info => info.activePanelId)
  useOpenWithSurfacer({
    surfaceHints,
    activePanelId,
    openTab,
    openDock: undefined,
    enabled: !dockSeated,
  })

  return (
    <SideChatPanel
      sessionId={sessionId}
      contextKey={contextKey}
      onContextChange={setContextKey}
      fallbackLabel={fallbackLabel}
      t={t}
      remote={{ getState, listContexts, send }}
      headerActions={dockAvailable()
        ? (
          <Tooltip label={t('dock.open')} side="bottom">
            <button
              type="button"
              className={panelCss.headerAction}
              aria-label={t('dock.open')}
              onClick={() => { openDock(contextKey) }}
            >
              <IconBrowseOutline16 />
            </button>
          </Tooltip>
        )
        : undefined}
    />
  )
}
