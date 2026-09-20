/**
 * Package-owned invariant companion for `@khorsheed/dsh-capture`.
 * @module @khorsheed/dsh-capture/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** The identity the package publishes under (the manifest's `name`). */
const PACKAGE_NAME = '@khorsheed/dsh-capture'

/** Cordis companion plugin name. */
export const name = 'capture-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Capability probe for the capture host half: rendering needs a runtime that
 * has `URL` (the target policy), timers (the sweep dwell and idle shutdown),
 * and child processes (the managed Chrome). All three are standard in a dsh
 * host, so this is a low-value check — registered for package-ownership
 * consistency, and kept pure (no network, no filesystem, no session) so a
 * broken deployment is never reported as a healthy one and vice versa. The
 * Chrome BINARY is deliberately not probed: it installs lazily, and its
 * absence is a per-call domain error (`capture/unavailable`), not an
 * unhealthy deployment.
 *
 * @param _ctx - host context (unused; the probe touches process globals only).
 * @param fail - invariant failure reporter.
 */
export const install: InvariantInstaller = async (_ctx, fail) => {
  try {
    if (typeof globalThis.URL !== 'function') fail('capture requires a runtime with URL')
    if (typeof globalThis.setTimeout !== 'function') fail('capture requires a runtime with timers')
    const { spawn } = await import('node:child_process')
    if (typeof spawn !== 'function') fail('capture requires a runtime that can spawn child processes')
  } catch {
    fail('capture requires a standard node runtime')
  }
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
