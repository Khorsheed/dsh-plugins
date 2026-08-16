/**
 * Package-owned invariant companion for `@khorsheed/dsh-file-preview`.
 * @module @khorsheed/dsh-file-preview/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@khorsheed/dsh-file-preview'

/** Cordis companion plugin name. */
export const name = 'file-preview-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the service owns no durable package-local state and
 * writes nothing — `list` is a pure deterministic fold over the session log
 * (unit-tested), and `read` re-reads the filesystem through `ctx.fs`, whose
 * own invariants own that relationship.
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
