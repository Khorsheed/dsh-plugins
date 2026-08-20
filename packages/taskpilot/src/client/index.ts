/**
 * TaskPilot browser half: the dock pills and the job detail drawer.
 *
 * Two registrations share one drawer store (the dock opens, the drawer
 * renders). Data flows entirely through product channels — the `useSessions`
 * mirrors for live jobs/subagents, `session.history` via the connection API
 * for the trail, and `remote.commands.execute` for the two verbs — so the
 * bundle adds no RPC surface and touches no product code. Uninstalling the
 * bundle removes both registrations with their effects.
 *
 * @module dsh-taskpilot/client
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the Context merges (slots/sessions/remote/locale) and the
// SlotMap rows ('conversation.input.dock' from ui-conversation, 'shell.overlay'
// from ui-layout) into the program so the registrations type.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-commands/remote'
import type { ConnectionHandle, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import { en, NS, zh, type TaskPilotLocaleKey } from './locales.ts'
import { createDrawerStore, type DrawerActions } from './drawer-store.ts'
import { TaskPilotDock, type TaskPilotDockInjected } from './TaskPilotDock.tsx'
import { JobDrawer, type JobDrawerInjected, type HistoryPage } from './JobDrawer.tsx'
import { renderTaskPilotCommand } from '../types.ts'

/** The dock/drawer copy owns its namespace, merged into the locale map. */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** TaskPilot pill and drawer copy. */
    taskpilot: TaskPilotLocaleKey
  }
}

/** Required services: slots, the session runtime, the command remote, the wire, and locale. */
export const inject = ['slots', 'sessions', 'remote', 'remote.commands', 'connection', 'locale']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'taskpilot: dictionaries')

  // One handle shared by the dock (opens) and the drawer (renders).
  const drawer = createDrawerStore()
  const connection = ctx.get('connection') as ConnectionHandle

  // The drawer owns the store under the root-scope slot (one handle, one
  // scope). Its registered actions are captured into the apply closure; the
  // dock's openJob verb invokes them, so the two surfaces stay in lockstep
  // without mounting the handle twice.
  let drawerActions: BoundActions<ReturnType<typeof createDrawerStore>> | undefined

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
      openJob: (jobId) => { drawerActions?.openJob(sessionId, jobId) },
      openSession: (id) => { (ctx.sessions as ISessions).open(id) },
    }),
  }, TaskPilotDock))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'taskpilot-drawer',
    order: 120,
    locale: NS,
    store: drawer,
    inject: (actions): JobDrawerInjected => {
      drawerActions = actions
      return {
        loadHistory: async (
          sessionId: SessionId,
          beforeSeq: number | undefined,
          maxMessages: number,
        ): Promise<HistoryPage | undefined> => {
          const payload = beforeSeq === undefined
            ? { sessionId, maxMessages }
            : { sessionId, beforeSeq, maxMessages }
          const response = await connection.api.sessions.history(payload)
          return response.result.ok ? response.result.value : undefined
        },
        close: () => { actions.close() },
      }
    },
  }, JobDrawer))
}
