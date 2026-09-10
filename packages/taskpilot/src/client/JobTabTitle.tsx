/**
 * The taskpilot type's chip title: the captured type label followed by the
 * selected job id, so re-navigating the page to another job is visible on the
 * tab itself. Registered under `sidebar.right.pane.tab.title`; without it the
 * chip would show the bare label captured at open time.
 *
 * @module dsh-taskpilot/client/job-tab-title
 */

import type { ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TaskPilotTabParams } from './definition.ts'

/**
 * The title as the chip and a floating panel's header show it.
 * @param props - the tab information hook.
 * @returns the tab's title text followed by the selected job id.
 */
export function JobTabTitle({ useTabInfo }: PropsRuntime<'sidebar.right.pane.tab.title'>): ReactNode {
  const { tab } = useTabInfo()
  const params = tab.navigation.params as TaskPilotTabParams | undefined
  return <>{tab.title}{params !== undefined ? ` · ${params.jobId}` : ''}</>
}
