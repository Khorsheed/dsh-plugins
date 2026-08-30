/**
 * Package-owned invariant companion for `@khorsheed/dsh-plugin-upgrade`.
 * @module @khorsheed/dsh-plugin-upgrade/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@khorsheed/dsh-plugin-upgrade'

/** Cordis companion plugin name. */
export const name = 'plugin-upgrade-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package registers a skill and owns no durable
 * state. Reserved here so the loader knows this package is alive (and so a
 * future invariant can attach without a rename).
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
