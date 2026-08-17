/**
 * Package-owned invariant companion for `@khorsheed/dsh-context-guard`.
 * @module @khorsheed/dsh-context-guard/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@khorsheed/dsh-context-guard'

/** Cordis companion plugin name. */
export const name = 'context-guard-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: every compact action is executed through the official
 * `/compact` command channel, whose command-log invariant companion audits the
 * command lifecycle, and the plugin's one composer-tool-row entry proves
 * disposal through the browser-plugin spec. No second authority exists to
 * check at runtime.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
