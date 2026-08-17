/**
 * Package-owned invariant companion for `@khorsheed/dsh-local-agent-dsh`.
 * @module @khorsheed/dsh-local-agent-dsh/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { LocalAgentHarness } from '@khorsheed/dsh-local-agent'

const PACKAGE_NAME = '@khorsheed/dsh-local-agent-dsh'

/** Cordis companion plugin name. */
export const name = 'local-agent-dsh-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * The dsh harness definition is this bundle's contract with the core
 * registry: whenever a `dsh` harness registers, its scoped-home variable must
 * be the one this bundle pins, and it must delegate through the `dsh-cli`
 * provider this bundle mounts.
 */
const install: InvariantInstaller = (ctx: Context, fail: InvariantFailure) => {
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'localAgent/harness-added') return
    const harness = args[0] as LocalAgentHarness
    if (harness.name !== 'dsh') return
    if (harness.homeEnvVar !== 'DSH_HOME') {
      fail('dsh harness registered with a home env other than the local-agent-dsh contract')
    }
    if (harness.delegationProvider !== 'dsh-cli') {
      fail('dsh harness registered with a delegation provider other than the local-agent-dsh contract')
    }
  }, { global: true })
}

/**
 * Register this package's invariant companion.
 * @param ctx - plugin context carrying the invariant registry.
 * @returns the installed registration's disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
