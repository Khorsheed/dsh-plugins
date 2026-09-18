/**
 * Package-owned invariant companion for `@khorsheed/dsh-quote`.
 * @module @khorsheed/dsh-quote/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { formatQuoteBlock, mergedQuoteDraft } from './types.ts'

/** This package's published name — the loader entry id, the cordis row id, and the client bundle id all move with it. */
export const PACKAGE_NAME = '@khorsheed/dsh-quote'

/** Cordis companion plugin name. */
export const name = 'quote-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Capability probe: the pieces every surface depends on must round-trip —
 * the quote block a composer insert writes and the draft merge that keeps a
 * typed draft intact. Both are pure (no selection, no session, no Remote), so
 * the probe can never report a healthy deployment as broken.
 * @param _ctx - host context (unused; the probe is pure vocabulary).
 * @param fail - invariant failure reporter.
 */
export const install: InvariantInstaller = async (_ctx, fail) => {
  const block = formatQuoteBlock('第一行\n第二行', '—— 引用自「主会话」')
  if (block !== '> 第一行\n> 第二行\n> —— 引用自「主会话」') {
    fail(`quote: the quote block does not prefix every line and close with the attribution (got ${JSON.stringify(block)})`)
    return
  }
  if (mergedQuoteDraft('  ', block) !== block) {
    fail('quote: a blank draft is not filled directly')
    return
  }
  if (mergedQuoteDraft('已经打的字', block) !== `已经打的字\n\n${block}`) {
    fail('quote: a typed draft does not keep the quote block appended after one blank line')
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
