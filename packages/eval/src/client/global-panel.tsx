/**
 * T97 · the global 「实验室」 panel: the deployment's experiments as a
 * left-sidebar entry (`sidebar.panellist`) and a central panel (`main`), the
 * host 0.2.0 mechanism the plugin manager and the automation-task list use.
 *
 * The panel is the SAME {@link LabView} the session tab renders, handed the
 * session-less sentinel {@link PANEL_SESSION}. Since T97 the eval Remote takes
 * no session for anything but `approve`, so every read is the tab's read; the
 * view itself switches the three things a session meant there — the list
 * shows 全部 (there is no 本会话), and the two hand-offs to an agent open a
 * NEW evaluation-mode session instead of writing into this one's chat box.
 * @module @khorsheed/dsh-eval/client
 */
import type { ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InjectFace, PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { LabViewInjected, LabViewProps } from './contract.ts'
import { IconGaugeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { LabView } from './LabView.tsx'
import type { createLabViewStore } from './store.ts'

/** The panel's id: the `sidebar.panellist` entry id and the `main` key, which must match. */
export const PANEL_ID = 'eval-lab'

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
export function LabPanelIcon({ size }: PanelIconProps): ReactNode {
  return <IconGaugeOutlineRegular size={size} />
}

/** The panel's props: the `main` slot's runtime plus the same store, face and copy the tab gets. */
export type LabPanelProps =
  & PropsStore<ReturnType<typeof createLabViewStore>>
  & InjectFace<LabViewInjected>
  & PropsLocale<'dshEval'>

const noop = (): void => {}

/**
 * The global panel: the tab's view with no session behind it. The four
 * conversation-view owner props are a tab strip's; a panel has no strip, so
 * they are inert here. The session-scope runtime hooks the tab type also
 * carries are never read by the view — everything it shows comes through the
 * face — so the panel does not forge them; the cast says exactly that.
 * @param props - store, face and copy.
 */
export function LabPanel(props: LabPanelProps): ReactNode {
  const viewProps = {
    ...props,
    sessionId: PANEL_SESSION,
    inspectCall: undefined,
    viewRequest: null,
    openView: noop,
    completeViewRequest: noop,
  } as unknown as LabViewProps
  return <LabView {...viewProps} />
}
