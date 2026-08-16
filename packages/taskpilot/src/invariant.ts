/**
 * Runtime invariant companion for dsh-taskpilot.
 *
 * No runtime invariant: TaskPilot owns no data relation of its own. Its host
 * half routes existing `jobs` / `subagents` services through the `commands`
 * extension point, and its browser half reads the product-provided
 * `jobsBySession` / `subagentsByParent` mirrors and the session log — every
 * invariant it could assert already belongs to the owning product package.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-invariants'

export const name = 'dsh-taskpilot'

export function apply(ctx: Context): void {
  ctx.invariants.register(name, () => {})
}
