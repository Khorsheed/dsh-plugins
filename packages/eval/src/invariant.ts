/**
 * Package-owned invariant companion for `@khorsheed/dsh-eval`.
 * @module @khorsheed/dsh-eval/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@khorsheed/dsh-eval'

/** Cordis companion plugin name. */
export const name = 'eval-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * eval owns no durable host state: the offline verbs read contract files and
 * hash their bytes; every artifact they will ever produce (lock files, run
 * records) lives in the dataset repos and mission roots other packages own.
 * The companion reserves package ownership so a future stateful line must add
 * its check here deliberately.
 * @param _ctx - host context (unused; there is no owned data to check).
 * @param _fail - invariant failure reporter (unused).
 */
export const install: InvariantInstaller = (_ctx, _fail) => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns The installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
