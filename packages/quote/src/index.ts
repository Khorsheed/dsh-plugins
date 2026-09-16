/**
 * Quote-anything (引用任意内容), host half: mounts the plugin's thin Remote
 * data face (namespace `quote`). The face carries no service core of its own
 * — its one verb adapts the probed side-chat seam (`ctx.get('sideChat')` →
 * `openWith`), so the plugin keeps working alone: without the side-chat
 * package the verb refuses `unavailable` and the browser hides the route.
 *
 * Composing this plugin out of cordis.yml removes every surface it adds; no
 * state of its own exists to leave behind.
 *
 * @module @khorsheed/dsh-quote
 */
import type { Context } from '@deepseek-ai/cordis'
import { QuoteRemoteService } from './remote.ts'

export { QuoteRemoteService } from './remote.ts'
export type { QuoteRemoteConfig, SideChatMirror } from './remote.ts'
export * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The quote plugin's Remote face. */
    quoteRemote: QuoteRemoteService
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'quote'

/**
 * Plugin body: mount the Remote data face. No injects — every capability is
 * probed per gesture, so the row boots in any composition.
 * @param ctx - owning Cordis Context.
 */
export function apply(ctx: Context): void {
  ctx.plugin(QuoteRemoteService, {})
}
