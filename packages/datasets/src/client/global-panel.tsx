/**
 * T97 · the global 「题集」 panel: the deployment's dataset registry as a
 * left-sidebar entry (`sidebar.panellist`) and a central panel (`main`), the
 * host 0.2.0 mechanism the plugin manager and the automation-task list use.
 *
 * The panel is the SAME {@link DatasetsView} the session tab renders — list,
 * detail, review page and back — handed the session-less sentinel
 * {@link PANEL_SESSION} in place of a session id. Nothing the view reads
 * belongs to a session (the datasets Remote takes none since T97), so the
 * sentinel only reaches the doors that genuinely need one: 「添加题集」 opens
 * a new 「题集整理」 session, which is what it did from the tab too.
 * @module @khorsheed/dsh-datasets/client
 */
import type { ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InjectFace, PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { DatasetsViewInjected, DatasetsViewProps } from './contract.ts'
import { DatasetsView } from './DatasetsView.tsx'
import { IconDatabaseOutlineRegular } from './icons.tsx'
import type { createDatasetsViewStore } from './store.ts'

/** The panel's id: the `sidebar.panellist` entry id and the `main` key, which must match. */
export const PANEL_ID = 'datasets'

/** The session id the global panel hands the view: none. */
export const PANEL_SESSION = '' as SessionId

/** The panel list's owner props (ui-sidebar's `SidebarPanelIconOwnerProps`, structurally). */
export interface PanelIconProps {
  size?: number
  active?: boolean
}

/**
 * The sidebar entry's icon.
 * @param props - the owner's icon size.
 */
export function DatasetsPanelIcon({ size }: PanelIconProps): ReactNode {
  return <IconDatabaseOutlineRegular size={size} />
}

/** The panel's props: the `main` slot's runtime plus the same store, face and copy the tab gets. */
export type DatasetsPanelProps =
  & PropsStore<ReturnType<typeof createDatasetsViewStore>>
  & InjectFace<DatasetsViewInjected>
  & PropsLocale<'datasets'>

const noop = (): void => {}

/**
 * The global panel: the tab's view with no session behind it. The four
 * conversation-view owner props are a tab strip's; a panel has no strip, so
 * they are inert here. The session-scope runtime hooks (`useSession`,
 * `useConversation`, …) the tab type also carries are never read by the
 * view — everything it shows comes through the face — so the panel does not
 * forge them; the cast says exactly that.
 * @param props - store, face and copy.
 */
export function DatasetsPanel(props: DatasetsPanelProps): ReactNode {
  const viewProps = {
    ...props,
    sessionId: PANEL_SESSION,
    inspectCall: undefined,
    viewRequest: null,
    openView: noop,
    completeViewRequest: noop,
  } as unknown as DatasetsViewProps
  return <DatasetsView {...viewProps} />
}
