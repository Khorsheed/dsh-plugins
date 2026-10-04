/**
 * Package-owned invariant companion for `@khorsheed/dsh-story-bible`.
 * @module @khorsheed/dsh-story-bible/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { chapterFileName, chapterNumberOfFile, foreshadowIdOf, foreshadowRefOf, normalizeMemory } from './types.ts'

const PACKAGE_NAME = '@khorsheed/dsh-story-bible'

/** Cordis companion plugin name. */
export const name = 'story-bible-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Capability probe: the store's naming and id vocabulary must round-trip.
 * The chapter file name is the one naming rule every surface agrees on (the
 * index, the reader, the extract pack); the foreshadow ref spellings are
 * what the plan ops and the import whitelist share; and `normalizeMemory`
 * is the read gate every document passes. All three are checkable without
 * touching a filesystem, a workspace, or a session, so the probe can never
 * report a healthy deployment as broken.
 * @param _ctx - host context (unused; the probe is pure vocabulary).
 * @param fail - invariant failure reporter.
 */
export const install: InvariantInstaller = async (_ctx, fail) => {
  for (const n of [1, 5, 60]) {
    if (chapterNumberOfFile(chapterFileName(n)) !== n) {
      fail(`story-bible: chapter file name for ${n} does not round-trip`)
      return
    }
  }
  for (const spelling of ['m12', '#12', '12']) {
    if (foreshadowIdOf(spelling) !== 'm12' || foreshadowRefOf('m12') !== '#12') {
      fail(`story-bible: foreshadow ref ${spelling} does not normalize to m12 / #12`)
      return
    }
  }
  if (normalizeMemory({ id: 'm1', layer: 'canon', content: '探针' }) === undefined) {
    fail('story-bible: a minimal valid memory record fails the read gate')
    return
  }
  if (normalizeMemory({ id: 'm1', layer: 'canon' }) !== undefined) {
    fail('story-bible: a memory record without content passes the read gate')
    return
  }
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns The installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
