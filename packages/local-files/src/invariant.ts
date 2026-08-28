/**
 * Package-owned invariant companion for `@khorsheed/dsh-local-files`.
 * @module @khorsheed/dsh-local-files/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@khorsheed/dsh-local-files'

/** Cordis companion plugin name. */
export const name = 'local-files-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Capability probe: the browser reads absolute local paths with node fs, so it
 * requires a node runtime that can open files — probe the current directory's
 * fs is usable. `node:fs` is always present in a dsh host, so this is a
 * low-value check; registered for package-ownership consistency only.
 * @param _ctx - host context (unused; the probe runs in the current directory).
 * @param fail - invariant failure reporter.
 */
export const install: InvariantInstaller = async (_ctx, fail) => {
  try {
    if (typeof process === 'undefined' || !process.cwd) fail('local-files requires a node runtime')
  } catch {
    fail('local-files requires a node runtime')
  }
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns The installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
