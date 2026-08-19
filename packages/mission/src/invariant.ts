/**
 * Package-owned invariant companion for `@khorsheed/dsh-mission`.
 * @module @khorsheed/dsh-mission/invariant
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { resolveDataDir } from './defaults.ts'

const PACKAGE_NAME = '@khorsheed/dsh-mission'

/** Cordis companion plugin name. */
export const name = 'mission-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Owned-data check: every run file present at the default data root must
 * parse as a well-formed run record (id + frozen state machine). A malformed
 * run file would fail loud at the moment a guard or transition needs it —
 * the shape is this package's own contract, so corruption is reported at
 * load instead.
 * @param _ctx - host context (unused; the check reads only the run files).
 * @param fail - invariant failure reporter.
 */
export const install: InvariantInstaller = (_ctx, fail) => {
  const runsDir = join(resolveDataDir(undefined), 'runs')
  if (!existsSync(runsDir)) return
  for (const name of readdirSync(runsDir)) {
    if (!name.endsWith('.json')) continue
    const file = join(runsDir, name)
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
      if (typeof parsed['id'] !== 'string' || typeof parsed['stateMachine'] !== 'object' || parsed['stateMachine'] === null) {
        fail(`run file ${file} is missing its id or frozen state machine`)
      }
    } catch (error) {
      fail(`run file ${file} is malformed: ${String(error)}`)
    }
  }
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns The installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
