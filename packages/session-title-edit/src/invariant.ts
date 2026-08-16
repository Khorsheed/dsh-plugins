/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-session-title-edit`.
 * @module @deepseek-ai/dsh-client-session-title-edit/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-session-title-edit'

/** Cordis companion plugin name. */
export const name = 'client-session-title-edit-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: every accepted rename is appended through the official
 * session service, whose session-title invariant companion audits the
 * `session/title` source relationship (a user rename must carry no message
 * citations), and the plugin's one header-slot entry proves disposal through
 * the browser-plugin spec. No second authority exists to check at runtime.
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
