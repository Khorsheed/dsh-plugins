/**
 * Package-owned invariant companion for `@khorsheed/dsh-client-message-tools`.
 * @module @khorsheed/dsh-client-message-tools/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@khorsheed/dsh-client-message-tools'

/** Cordis companion plugin name. */
export const name = 'client-message-tools-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the withdrawal write passes through Session.append,
 * whose surface validation rejects any replacement that misses a shadowed
 * surface node, and the client contributions (one Definition, two slot
 * entries) ride the slot/declaration lifecycles disposed with the plugin
 * fiber. The package's unit tests exercise the plan fold and the projection
 * helpers, so no second authority exists to check at runtime.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
