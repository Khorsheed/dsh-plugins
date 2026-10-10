/**
 * Package-owned invariant companion for `@khorsheed/dsh-game`.
 * @module @khorsheed/dsh-game/invariant
 */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@khorsheed/dsh-game'

/** Cordis companion plugin name. */
export const name = 'game-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No hard capability: a host without Chrome still runs the data checks (the
 * browser part reports itself skipped), so nothing here can fail the load.
 */
export const install: InvariantInstaller = async () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the registration's disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
