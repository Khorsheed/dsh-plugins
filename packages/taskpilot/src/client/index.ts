/**
 * TaskPilot browser half: the dock pills and the job detail drawer.
 *
 * Two registrations share one drawer store (the dock opens, the drawer
 * renders). Data flows entirely through product channels — the `useSessions`
 * mirrors for live jobs/subagents, the generated session remote for the
 * history trail (0.1.2-alpha.1: the follow stream's opening snapshot supplies
 * the tail page and its cursor, `remote.session.page` the older pages; the
 * retired `connection.api.sessions.history` had no throughSeq), and
 * `remote.commands.execute` for the two verbs — so the bundle adds no RPC
 * surface and touches no product code. Uninstalling the bundle removes both
 * registrations with their effects.
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
import type { SessionAddress, SessionHistoryRecord, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import { en, NS, zh, type TaskPilotLocaleKey } from './locales.ts'
import { createDrawerStore, type DrawerActions } from './drawer-store.ts'
import { TaskPilotDock, type TaskPilotDockInjected } from './TaskPilotDock.tsx'
import { JobDrawer, type JobDrawerInjected, type HistoryPage } from './JobDrawer.tsx'
import { pollActiveDelegations } from './active-delegations.ts'
import type { SessionLogRow } from './job-trajectory.ts'
import { renderTaskPilotCommand } from '../types.ts'

/** The dock/drawer copy owns its namespace, merged into the locale map. */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** TaskPilot pill and drawer copy. */
    taskpilot: TaskPilotLocaleKey
  }
}

/** Required services: slots, the session runtime, the command remote, and locale. */
export const inject = ['slots', 'sessions', 'remote', 'remote.commands', 'locale']

/**
 * Unwrap history records into the fold's narrow row shape. Both record
 * variants (raw event and packed chunk run) carry a `{seq, time, type, data}`
 * wire event; the trajectory fold ignores chunk rows by type, so nothing is
 * filtered here and the page boundary (min seq) matches the host's cut.
 */
function unwrapRecords(records: readonly SessionHistoryRecord[]): SessionLogRow[] {
  return records.map(record => record.event as unknown as SessionLogRow)
}

/**
 * Read the tail page of one session's durable log through the follow stream's
 * opening snapshot — the cold read that also yields the log cut
 * (`throughSeq`) the page RPC requires. The stream aborts right after the
 * snapshot; every failure mode (carrier, business, stream ending early)
 * resolves undefined so the drawer degrades to its error row.
 */
async function followTail(
  ctx: Context,
  address: SessionAddress,
  maxMessages: number,
): Promise<{ readonly cursor: number; readonly page: HistoryPage } | undefined> {
  const controller = new AbortController()
  try {
    for await (const frame of ctx.remote.session.follow({ address, maxMessages }, controller.signal)) {
      if (frame.type !== 'snapshot') continue
      return { cursor: frame.cursor, page: { events: unwrapRecords(frame.records), hasMore: frame.hasMore } }
    }
    return undefined
  } catch {
    return undefined
  } finally {
    controller.abort()
  }
}

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'taskpilot: dictionaries')

  // One handle shared by the dock (opens) and the drawer (renders).
  const drawer = createDrawerStore()

  // Log cuts captured from follow snapshots: the page RPC's throughSeq is the
  // "inclusive log cut obtained from the corresponding follow opening frame",
  // so the first (tail) read seeds it and older pages reuse it.
  const historyCuts = new Map<SessionId, number>()

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
      // Duck-typed read of the local-agent family gateway: resolves [] on an
      // absent channel or call error, so the dock's second running source is
      // a no-op when the family is not installed (independent, but compatible).
      pollActiveDelegations: () => pollActiveDelegations(ctx),
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
          const address: SessionAddress = { kind: 'session', sessionId }
          if (beforeSeq === undefined) {
            const tail = await followTail(ctx, address, maxMessages)
            if (tail === undefined) return undefined
            historyCuts.set(sessionId, tail.cursor)
            return tail.page
          }
          let cut = historyCuts.get(sessionId)
          if (cut === undefined) {
            // Older page requested without a tail read (drawer reopen raced):
            // a one-message snapshot relearns the cut.
            const tail = await followTail(ctx, address, 1)
            if (tail === undefined) return undefined
            historyCuts.set(sessionId, tail.cursor)
            cut = tail.cursor
          }
          try {
            const result = await ctx.remote.session.page({ address, throughSeq: cut, beforeSeq, maxMessages })
            return result.ok
              ? { events: unwrapRecords(result.value.records), hasMore: result.value.hasMore }
              : undefined
          } catch {
            return undefined
          }
        },
        close: () => { actions.close() },
      }
    },
  }, JobDrawer))
}
