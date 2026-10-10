/**
 * Package-owned invariant companion for `@khorsheed/dsh-context-lens`.
 * @module @khorsheed/dsh-context-lens/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** The identity the package publishes under (the manifest's `name`). */
const PACKAGE_NAME = '@khorsheed/dsh-context-lens'

/** Cordis companion plugin name. */
export const name = 'context-lens-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Capability probe for the context-lens host half: capture needs a
 * runtime with timers (ring-buffer bookkeeping) and a working Map (the
 * per-session store). Both are standard in a dsh host, so this is a low-value
 * check — registered for package-ownership consistency, and kept pure (no
 * network, no filesystem, no session) so a broken deployment is never
 * reported as a healthy one and vice versa. The llm/stream seam itself is
 * deliberately not probed: its absence is a silent degradation (an empty
 * panel), not an unhealthy deployment.
 *
 * @param _ctx - host context (unused; the probe touches process globals only).
 * @param fail - invariant failure reporter.
 */
export const install: InvariantInstaller = async (_ctx, fail) => {
  try {
    if (typeof globalThis.setTimeout !== 'function') fail('context-lens requires a runtime with timers')
    if (typeof globalThis.Map !== 'function') fail('context-lens requires a runtime with Map')
  } catch {
    fail('context-lens requires a standard node runtime')
  }
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
