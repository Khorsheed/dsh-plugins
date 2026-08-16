/**
 * Package-owned invariant companion for
 * `@khorsheed/dsh-local-agent-tool-subagent`.
 * @module @khorsheed/dsh-local-agent-tool-subagent/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@khorsheed/dsh-local-agent-tool-subagent'

/** Cordis companion plugin name. */
export const name = 'local-agent-tool-subagent-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant of its own: the family tool routes the existing
 * `ctx.subagents` seam through the localAgent delegation registry, and every
 * data relation it could assert already belongs to the core package — a
 * recorded delegation must name a mounted provider (the core's
 * `local-agent` invariant), and a resolved resume handle must name a recorded
 * delegation for the same parent and provider (enforced by
 * `LocalAgentRegistry.resolveDelegation` at call time). Registering an empty
 * installer still reserves the package name so a future relation cannot be
 * registered twice.
 */
const install: InvariantInstaller = (_ctx: Context, _fail: InvariantFailure) => {}

/**
 * Register this package's invariant companion.
 * @param ctx - plugin context carrying the invariant registry.
 * @returns the installed registration's disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
