/**
 * Package-owned invariant companion for `@khorsheed/dsh-taskpilot`.
 * @module @khorsheed/dsh-taskpilot/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@khorsheed/dsh-taskpilot'

/** Cordis companion plugin name. */
export const name = 'taskpilot-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: TaskPilot owns no data relation of its own. Its host
 * half routes existing `jobs` / `subagents` services through the `commands`
 * extension point, and its browser half reads the product-provided
 * `jobsBySession` / `subagentsByParent` mirrors and the session log — every
 * invariant it could assert already belongs to the owning product package.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
