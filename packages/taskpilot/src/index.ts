/**
 * TaskPilot host half: the two command verbs behind the dock pills.
 *
 * Both verbs ride the product `commands` extension point (registered as
 * effects, so uninstalling the bundle drops them), authorize through the
 * exact agent whose UI dispatched the command, and return a `CommandResult`
 * the dispatching surface renders inline. Nothing here touches product code:
 * `ctx.jobs`, `ctx.subagents`, and `ctx.commands` are the standard services
 * every composition already mounts.
 *
 * @module dsh-taskpilot
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the commands / jobs / subagents Context merges into the
// program so the injected members below type-check.
import type {} from '@deepseek-ai/dsh-commands'
import type { JobId } from '@deepseek-ai/dsh-jobs/brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subagent'

export const name = 'dsh-taskpilot'
export const inject = ['commands', 'jobs', 'subagents']

export function apply(ctx: Context): void {
  ctx.commands.register({
    name: 'taskpilot-stop',
    description: 'Stop a background job by id (e.g. /taskpilot-stop bash-1).',
    handler: (invocation) => {
      const jobId = invocation.rawInput.trim()
      if (jobId.length === 0) {
        return { kind: 'error', text: 'usage: /taskpilot-stop <jobId>' }
      }
      try {
        const outcome = ctx.jobs.kill(jobId as JobId, invocation.agent, 'user stop')
        return {
          kind: 'success',
          text: outcome === 'already-finished'
            ? `job ${jobId} had already finished`
            : `stop requested for job ${jobId}`,
        }
      } catch (error) {
        return { kind: 'error', text: `cannot stop job ${jobId}: ${String(error)}` }
      }
    },
  })

  ctx.commands.register({
    name: 'taskpilot-interrupt',
    description: 'Interrupt a running subagent by its session id; an optional direct-parent id authorizes a deep descendant '
      + '(e.g. /taskpilot-interrupt <child-session-id> [parent-session-id]).',
    handler: (invocation) => {
      const parts = invocation.rawInput.trim().split(/\s+/)
      const childId = parts[0] ?? ''
      if (childId.length === 0) {
        return { kind: 'error', text: 'usage: /taskpilot-interrupt <childSessionId> [parentSessionId]' }
      }
      const parentId = parts[1]?.trim()
      if (parentId !== undefined && parentId.length === 0) {
        return { kind: 'error', text: 'usage: /taskpilot-interrupt <childSessionId> [parentSessionId]' }
      }
      try {
        ctx.subagents.interrupt(childId as SessionId, {
          kind: 'user',
          // A deep descendant's direct parent authorizes the interrupt (user
          // authority checks the live target's durable direct parent); the
          // dispatching session's agent is the default for direct children.
          parentSessionId: (parentId ?? invocation.agent.session.id) as SessionId,
        })
        return { kind: 'success', text: `interrupt requested for subagent ${childId}` }
      } catch (error) {
        return { kind: 'error', text: `cannot interrupt subagent ${childId}: ${String(error)}` }
      }
    },
  })
}
