/**
 * TaskPilot browser half: the dock pills and the job detail right-sidebar tab.
 *
 * Data flows entirely through product channels — the `useSessions` mirrors for
 * live jobs/subagents, a capability-probed history loader for the trail
 * (./history-loader.ts: the generated `remote.session.follow`/`page` when
 * mounted — read via `ctx.get('remote.session')` since the namespace may be
 * absent and must not sit in the inject list — `connection.api.sessions.history`
 * otherwise), and `remote.commands.execute` for the two verbs — so the bundle
 * adds no RPC surface and touches no product code. Uninstalling the bundle
 * removes every registration with its effects.
 *
 * The detail view is a page-type right-sidebar tab, registered through the
 * public two-stage path (./definition.ts into `ctx.sidebarRightTabs`, the body
 * and chip title into the keyed `sidebar.right.pane.tab(.title)` seats under
 * the same id). The dock's detail entry opens it with
 * `ctx.sidebarRight.openTab(TASKPILOT_KIND, { params: { jobId } })`; pages
 * deduplicate, so picking another job re-navigates the one tab.
 *
 * @module dsh-taskpilot/client
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the Context merges (slots/sessions/remote/locale plus
// sidebarRight/sidebarRightTabs) and the SlotMap rows ('conversation.input.dock'
// from ui-conversation, 'sidebar.right.pane.tab(.title)' from ui-sidebar-right)
// into the program so the registrations type.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-commands/remote'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { en, NS, zh } from './locales.ts'
import { TaskPilotDock, type TaskPilotDockInjected } from './TaskPilotDock.tsx'
import { JobTab, type JobTabInjected } from './JobTab.tsx'
import { JobTabTitle } from './JobTabTitle.tsx'
import { TASKPILOT_KIND, TASKPILOT_TAB_ID, taskpilotDefinition } from './definition.ts'
import { createHistoryLoader } from './history-loader.ts'
import { pollActiveDelegations } from './active-delegations.ts'
import { renderTaskPilotCommand } from '../types.ts'

/** Required services: slots, the session runtime, the command remote, the wire, copy, and the right-sidebar faces. */
export const inject = [
  'slots', 'sessions', 'remote', 'remote.commands', 'connection', 'locale',
  'sidebarRight', 'sidebarRightTabs',
]

export function apply(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'taskpilot: dictionaries')
  ctx.effect(() => ctx.sidebarRightTabs.register(taskpilotDefinition(t)), 'taskpilot: tab type')

  // Capability-probed at apply time: the session remote namespace when
  // mounted, the connection api otherwise (see ./history-loader.ts). The
  // namespace comes through ctx.get, not the ctx.remote proxy: declaring
  // 'remote.session' in inject would pend the plugin on a host without it,
  // and the proxy throws on undeclared sub-service access.
  const loadHistory = createHistoryLoader(ctx.get('remote.session'), ctx.get('connection'))

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'taskpilot-dock',
    order: 30,
    locale: NS,
    inject: (sessionId): TaskPilotDockInjected => ({
      stopJob: (jobId) => (
        ctx.remote.commands.execute(sessionId, renderTaskPilotCommand({ kind: 'stop-job', jobId }), [])
      ),
      interruptSubagent: (childId, parentId) => {
        const command = parentId === undefined
          ? { kind: 'interrupt-subagent' as const, childId }
          : { kind: 'interrupt-subagent' as const, childId, parentId }
        return ctx.remote.commands.execute(sessionId, renderTaskPilotCommand(command), [])
      },
      // The dock lives in the mounted session's conversation, so the
      // controller's mounted-seat aim and the pill's session coincide.
      openJob: (jobId) => { ctx.sidebarRight.openTab(TASKPILOT_KIND, { params: { jobId } }) },
      openSession: (id) => { (ctx.sessions as ISessions).open(id) },
      // Duck-typed read of the local-agent family gateway: resolves [] on an
      // absent channel or call error, so the dock's second running source is
      // a no-op when the family is not installed (independent, but compatible).
      pollActiveDelegations: () => pollActiveDelegations(ctx),
    }),
  }, TaskPilotDock))

  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: TASKPILOT_TAB_ID, locale: NS, inject: (): JobTabInjected => ({ loadHistory }) },
    JobTab,
  ))
  ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab.title', key: TASKPILOT_TAB_ID },
    JobTabTitle,
  ))
}
