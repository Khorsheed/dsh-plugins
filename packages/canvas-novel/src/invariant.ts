/**
 * Package-owned invariant companion for `@khorsheed/dsh-canvas-novel`.
 * @module @khorsheed/dsh-canvas-novel/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { chapterFileName, chapterNumberOfFile, normalizeAnnotations, parseRef, refOf } from './types.ts'

/** The package's npm name (the identity triangle's third leg). */
export const PACKAGE_NAME = '@khorsheed/dsh-canvas-novel'

/** Cordis companion plugin name. */
export const name = 'canvas-novel-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Capability probe: the store's naming and id vocabulary must round-trip.
 * The chapter file name is the one naming rule every surface agrees on (the
 * index, the reader, the extract pack); the ref spellings are what the
 * plan ops, the tools and the import whitelist share; and
 * `normalizeAnnotations` is the read gate the sidecar passes. All three are checkable without
 * touching a filesystem, a workspace, or a session, so the probe can never
 * report a healthy deployment as broken.
 * @param _ctx - host context (unused; the probe is pure vocabulary).
 * @param fail - invariant failure reporter.
 */
export const install: InvariantInstaller = async (_ctx, fail) => {
  for (const n of [1, 5, 60]) {
    if (chapterNumberOfFile(chapterFileName(n)) !== n) {
      fail(`canvas-novel: chapter file name for ${n} does not round-trip`)
      return
    }
  }
  for (const spelling of ['#12', '12', 'w12']) {
    const ref = parseRef(spelling)
    if (ref?.group !== 'entry' || ref.n !== 12 || refOf('foreshadow', ref.n) !== '#12') {
      fail(`canvas-novel: entry ref ${spelling} does not resolve to number 12`)
      return
    }
  }
  const character = parseRef('c3')
  if (character?.group !== 'character' || refOf('character', character.n) !== 'c3') {
    fail('canvas-novel: character ref c3 does not round-trip')
    return
  }
  if (normalizeAnnotations({ refs: {}, notes: {} }) === undefined) {
    fail('canvas-novel: an empty sidecar fails the read gate')
    return
  }
  if (normalizeAnnotations({}) !== undefined) {
    fail('canvas-novel: a document without refs/notes passes the sidecar read gate')
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
