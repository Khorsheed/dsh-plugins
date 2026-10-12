/**
 * Package-owned invariant companion for `@khorsheed/dsh-video-studio`.
 * @module @khorsheed/dsh-video-studio/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@khorsheed/dsh-video-studio'

/** Cordis companion plugin name. */
export const name = 'video-studio-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Capability probe: the host half spawns child processes (ffmpeg, the speech
 * worker). ffmpeg itself is NOT required — a missing binary is a designed
 * panel state, never a boot failure — so only the node runtime is checked.
 * @param _ctx - host context (unused).
 * @param fail - invariant failure reporter.
 */
export const install: InvariantInstaller = async (_ctx, fail) => {
  try {
    const cp = await import('node:child_process')
    if (typeof cp.spawn !== 'function') fail('video-studio requires node:child_process')
  } catch {
    fail('video-studio requires node:child_process')
  }
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns The installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
