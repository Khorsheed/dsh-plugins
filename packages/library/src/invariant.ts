/**
 * Package-owned invariant companion for `@khorsheed/dsh-library`.
 * @module @khorsheed/dsh-library/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** The identity the package publishes under (the manifest's `name`). */
export const PACKAGE_NAME = '@khorsheed/dsh-library'

/** Cordis companion plugin name. */
export const name = 'library-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Capability probe for the library: the host half persists and reads images
 * back, so it needs a runtime with `URL` and timers. Both are standard in a
 * dsh host, so this is a low-value check — registered for package-ownership
 * consistency, and kept pure (no network, no filesystem, no session) so a
 * broken deployment is never reported as a healthy one and vice versa.
 *
 * @param _ctx - host context (unused; the probe touches process globals only).
 * @param fail - invariant failure reporter.
 */
export const install: InvariantInstaller = async (_ctx, fail) => {
  try {
    if (typeof globalThis.URL !== 'function') fail('library requires a runtime with URL')
    if (typeof globalThis.setTimeout !== 'function') fail('library requires a runtime with timers')
  } catch {
    fail('library requires a standard node runtime')
  }
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
