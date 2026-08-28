/**
 * Package-owned invariant companion for `@khorsheed/dsh-inline-html-render`.
 * @module @khorsheed/dsh-inline-html-render/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@khorsheed/dsh-inline-html-render'

/** Cordis companion plugin name. */
export const name = 'client-inline-html-render-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the renderer is a pure DOM-layer effect owning its own
 * MutationObserver and a per-document iframe/`<pre>` pair; there is no durable
 * state shared with other packages. Reserved here so the loader knows this
 * package is alive (and so a future invariant can attach without a rename).
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns The installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
