/**
 * Package-owned invariant companion for `@khorsheed/dsh-room`.
 * @module @khorsheed/dsh-room/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@khorsheed/dsh-room'

/** Cordis companion plugin name. */
export const name = 'room-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Placeholder (Step 0/1 spike): no runtime invariant yet. The `room/created`
 * marker write passes through Session.append, whose validation rejects any
 * non-JSON payload, and the client contributions ride the slot/locale
 * lifecycles disposed with the plugin fiber. Later steps (roster transition
 * validation, dispatch invariants) install real checks here.
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
