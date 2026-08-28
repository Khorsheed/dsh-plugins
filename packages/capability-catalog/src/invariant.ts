/**
 * Package-owned invariant companion for `@khorsheed/dsh-capability-catalog`.
 * @module @khorsheed/dsh-capability-catalog/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@khorsheed/dsh-capability-catalog'

/** Cordis companion plugin name. */
export const name = 'capability-catalog-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the catalog is read-only over existing registries
 * (ctx.skills / ctx.tools) and the add-skill write path validates its inputs
 * before touching disk. The unit tests exercise the channel attribution,
 * skill decoding, and the wire projection.
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
