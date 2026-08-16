/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-whalesong`.
 * @module @deepseek-ai/dsh-whalesong/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-whalesong'

/** Cordis companion plugin name. */
export const name = 'whalesong-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the host half holds Config and serves it over one
 * exact route whose response is pinned by the host-config unit tests, and the
 * browser half renders an overlay/body class over the session-list snapshot
 * with every transition unit-tested against fake halves. The session-list
 * store itself (dsh-client-runtime) owns the snapshot contract; no second
 * authority exists to check at runtime.
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
