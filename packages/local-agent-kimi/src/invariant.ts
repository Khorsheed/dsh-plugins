/**
 * Package-owned invariant companion for `@khorsheed/dsh-local-agent-kimi`.
 * @module @khorsheed/dsh-local-agent-kimi/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { LocalAgentHarness } from '@khorsheed/dsh-local-agent'

const PACKAGE_NAME = '@khorsheed/dsh-local-agent-kimi'

/** Cordis companion plugin name. */
export const name = 'local-agent-kimi-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * The kimi harness definition is this bundle's contract with the core
 * registry: whenever a `kimi` harness registers, its scoped-home variable must
 * be the one this bundle pins.
 */
const install: InvariantInstaller = (ctx: Context, fail: InvariantFailure) => {
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'localAgent/harness-added') return
    const harness = args[0] as LocalAgentHarness
    if (harness.name !== 'kimi') return
    if (harness.homeEnvVar !== 'KIMI_CODE_HOME') {
      fail('kimi harness registered with a home env other than the local-agent-kimi contract')
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
