/**
 * Package-owned invariant companion for `@khorsheed/dsh-client-ui-file-preview`.
 * @module @khorsheed/dsh-client-ui-file-preview/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@khorsheed/dsh-client-ui-file-preview'

/** Cordis companion plugin name. */
export const name = 'ui-file-preview-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the drawer is a pure consumer that renders the
 * file-preview Remote's responses; the host service owns the log fold and the
 * filesystem reads, and presentation behavior is covered by component specs.
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
