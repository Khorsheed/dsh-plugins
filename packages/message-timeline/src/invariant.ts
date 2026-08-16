/**
 * Package-owned invariant companion for `@khorsheed/dsh-message-timeline`.
 * @module @khorsheed/dsh-message-timeline/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@khorsheed/dsh-message-timeline'

/** Cordis companion plugin name. */
export const name = 'client-message-timeline-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the rail contribution is one slot entry whose disposal
 * is proven by the HMR-safety spec — the plugin writes no session state, emits
 * no cordis events, and reads the conversation snapshot through the framework
 * hook only. Its DOM probe targets the official chat row attributes
 * ([data-chat-anchor-key] / [data-conversation-scroll]) read-only and
 * degrades to a hidden rail when they change, so no second authority exists to
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
