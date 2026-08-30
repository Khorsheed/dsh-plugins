/**
 * Host half of the fixture-legacy-store e2e fixture. Deliberately minimal and
 * build-free: proves the plugin applied on the running host by logging and by
 * dropping a marker file under $DSH_HOME/state, which the e2e driver polls.
 * @module @fixture/legacy-store
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const inject = []

/**
 * @param ctx - Cordis context.
 */
export function apply(ctx) {
  ctx.logger.info('legacy-store alive')
  try {
    const home = process.env.DSH_HOME ?? join(process.env.HOME ?? '.', '.dsh')
    const stateDir = join(home, 'state')
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(
      join(stateDir, 'legacy-store-alive.json'),
      JSON.stringify({ alive: true, pid: process.pid, at: new Date().toISOString() }, null, 2) + '\n',
    )
  } catch (error) {
    ctx.logger.warn(`legacy-store: alive marker write failed (${String(error)})`)
  }
}
