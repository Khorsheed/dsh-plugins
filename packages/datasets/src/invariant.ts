/**
 * Package-owned invariant companion for `@khorsheed/dsh-datasets`.
 * @module @khorsheed/dsh-datasets/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { resolveMaterializedRoot } from './defaults.ts'
import { checkMaterializedRootIntegrity } from './materialize.ts'

const PACKAGE_NAME = '@khorsheed/dsh-datasets'

/** Cordis companion plugin name. */
export const name = 'datasets-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Owned-data check: the materialized-layer root, when present at the default
 * location, must hold only well-formed content-addressed entries
 * (`<repo key>/<sha>/<set>/<layers-key>/`, plus the staging area). A foreign
 * entry means the cache can no longer be trusted to hold what its key says —
 * consumers mount these directories read-only, so fail loud at load instead
 * of serving a poisoned view.
 * @param _ctx - host context (unused; the check reads only the materialized root).
 * @param fail - invariant failure reporter.
 */
export const install: InvariantInstaller = (_ctx, fail) => {
  const violation = checkMaterializedRootIntegrity(resolveMaterializedRoot(undefined))
  if (violation !== undefined) fail(`materialized root integrity: ${violation}`)
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns The installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
