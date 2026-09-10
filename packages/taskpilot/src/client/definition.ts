/**
 * Stage one of TaskPilot's right-sidebar registration: what the `taskpilot`
 * tab type IS.
 *
 * The type is a page, not a viewer: it claims no address and is opened by
 * kind, from the dock pill's detail entry (`ctx.sidebarRight.openTab`), with
 * the selected job delivered as navigation params. One tab per pane — pages
 * deduplicate, so re-opening another job re-navigates the same tab and the
 * body follows `navigation.params`. The type stays off the guide page: a job
 * detail with no job selected is not a meaningful entry point.
 *
 * @module dsh-taskpilot/client/definition
 */

import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from './locales.ts'

/** The tab kind this package owns. */
export const TASKPILOT_KIND = 'taskpilot'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const TASKPILOT_TAB_ID = '@khorsheed/dsh-taskpilot'

/** Navigation params the dock hands `openTab`: which job the detail tab shows. */
export interface TaskPilotTabParams {
  readonly jobId: string
}

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    /** The job detail page's selection. */
    taskpilot: TaskPilotTabParams
  }
}

/**
 * The taskpilot type's registry definition. No `priority`: the default
 * `extension` band is exactly what a type shipped from outside the product is.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function taskpilotDefinition(t: TranslateNS<'taskpilot'>): SidebarRightTabDefinition {
  return {
    id: TASKPILOT_TAB_ID,
    kind: TASKPILOT_KIND,
    title: () => t('drawer.title'),
  }
}
