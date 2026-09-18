/**
 * Package-owned invariant companion for `@khorsheed/dsh-sidechat`.
 * @module @khorsheed/dsh-sidechat/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { foldRefsIntoText, normalizeContextsDoc, refLabelOf } from './types.ts'

/** This package's published name — the loader entry id, the cordis row id, and the client bundle id all move with it. */
export const PACKAGE_NAME = '@khorsheed/dsh-sidechat'

/** Cordis companion plugin name. */
export const name = 'sidechat-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Capability probe: the pieces every surface depends on must round-trip —
 * the ref-label derivation, the ref fold a send performs, and the tolerant
 * document reader the store trusts. All three are pure (no filesystem, no
 * session, no agent), so the probe can never report a healthy deployment as
 * broken.
 * @param _ctx - host context (unused; the probe is pure vocabulary).
 * @param fail - invariant failure reporter.
 */
export const install: InvariantInstaller = async (_ctx, fail) => {
  const ref = { label: refLabelOf('  沉默并不总是\n\n金的  '), text: '沉默并不总是\n\n金的' }
  if (ref.label !== '沉默并不总是') {
    fail(`sidechat: ref label does not take the first line (got ${JSON.stringify(ref.label)})`)
    return
  }
  const folded = foldRefsIntoText([ref], '怎么看这句话？')
  if (!folded.includes('<quoted_context label="沉默并不总是">') || !folded.endsWith('怎么看这句话？')) {
    fail('sidechat: the ref fold does not wrap quoted context and keep the user text last')
    return
  }
  const doc = normalizeContextsDoc({ version: 1, contexts: [{ contextKey: 'k', label: 'l', refs: [{}], createdAt: 't', updatedAt: 't' }] })
  if (doc.contexts.length !== 1 || doc.contexts[0]!.refs.length !== 0) {
    fail('sidechat: the tolerant document reader does not default malformed refs')
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
