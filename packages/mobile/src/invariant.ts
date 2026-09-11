/**
 * Package-owned invariant companion for `@khorsheed/dsh-mobile`.
 * @module @khorsheed/dsh-mobile/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@khorsheed/dsh-mobile'

/** Cordis companion plugin name. */
export const name = 'mobile-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Mobile owns no session data relations; the host owns authentication and streams. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
