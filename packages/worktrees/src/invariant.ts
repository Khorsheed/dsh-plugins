/**
 * Package-owned invariant companion for `@khorsheed/dsh-worktrees`.
 * @module @khorsheed/dsh-worktrees/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { git } from './git.ts'

const PACKAGE_NAME = '@khorsheed/dsh-worktrees'

/** Cordis companion plugin name. */
export const name = 'worktrees-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Capability probe: the whole plugin is a git reader, so a host without a
 * `git` binary on PATH can never answer a query — fail loud at load instead
 * of surfacing empty badges everywhere.
 * @param _ctx - host context (unused; the probe runs in the current directory).
 * @param fail - invariant failure reporter.
 */
export const install: InvariantInstaller = async (_ctx, fail) => {
  try {
    await git(process.cwd(), ['--version'])
  } catch {
    fail('git binary is required on PATH for worktree status reads')
  }
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns The installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
