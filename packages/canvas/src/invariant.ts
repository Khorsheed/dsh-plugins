/**
 * Package-owned invariant companion for `@khorsheed/dsh-canvas`.
 * @module @khorsheed/dsh-canvas/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { CANVAS_KINDS, itemNameOf, kindOfItemName, titleOfItemName } from './types.ts'

const PACKAGE_NAME = '@khorsheed/dsh-canvas'

/** Cordis companion plugin name. */
export const name = 'canvas-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Capability probe: the pad's layout vocabulary must round-trip. This is the
 * one fact every surface depends on — the list, the header, the archive set
 * and the Remote's name guard all ask `kindOfItemName` what a name means — and
 * it is checkable without touching a filesystem, a workspace, or a session, so
 * the probe can never report a healthy deployment as broken.
 * @param _ctx - host context (unused; the probe is pure vocabulary).
 * @param fail - invariant failure reporter.
 */
export const install: InvariantInstaller = async (_ctx, fail) => {
  for (const kind of CANVAS_KINDS) {
    const name = itemNameOf(kind, '探针')
    if (kindOfItemName(name) !== kind) {
      fail(`canvas: item name ${JSON.stringify(name)} does not round-trip to kind ${kind}`)
      return
    }
    if (titleOfItemName(name) !== '探针') {
      fail(`canvas: item name ${JSON.stringify(name)} does not round-trip to its title`)
      return
    }
  }
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns The installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
