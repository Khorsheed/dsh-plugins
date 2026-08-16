/**
 * Package-owned invariant companion for `@khorsheed/dsh-ui-shortcuts`.
 * @module @khorsheed/dsh-ui-shortcuts/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@khorsheed/dsh-ui-shortcuts'

/** Cordis companion plugin name. */
export const name = 'client-ui-shortcuts-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the keydown listeners and the settings-row slot
 * registration are effects owned and observed by their respective registries,
 * and the durable bindings are validated by the settings provider.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns The installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
