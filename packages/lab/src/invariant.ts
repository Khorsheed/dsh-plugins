/**
 * Package-owned invariant companion for `@khorsheed/dsh-lab`.
 * @module @khorsheed/dsh-lab/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@khorsheed/dsh-lab'

/** Cordis companion plugin name. */
export const name = 'lab-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Lab owns no durable host state: unit records live on the provider's own
 * resource labels (the docker daemon is the registry of record), and
 * in-container pidfiles die with their unit. The companion reserves package
 * ownership so a future stateful line must add its check here deliberately.
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
