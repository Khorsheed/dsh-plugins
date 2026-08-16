/**
 * Message timeline plugin, browser half. Registers one entry into the
 * official `conversation.session.header.utilities` seat (a right-aligned
 * optional-utility slot) that anchors the plugin into the session scope; the
 * component itself renders only through a body portal: the flat floating
 * timeline panel over the chat scrollport's left edge — one row per loaded
 * user message, no frame, no visible scrollbar. The
 * panel reads the session chat snapshot through the framework `useSession`
 * hook, jumps through the official row anchor attributes, and degrades to a
 * hidden panel when those attributes change — no official code is modified.
 * @module @khorsheed/dsh-message-timeline/client
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ctx.locale service merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls ui-conversation's SlotMap merge (the header utilities seat)
// and the conversation service merge.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { resolveConfig, type TimelineConfig } from './config.ts'
import { en, zh } from './locales.ts'
import { installRailTracker } from './rail-tracker.ts'
import type { TimelineRailInjected } from './slots.ts'
import { TimelineRailEntry } from './TimelineRail.tsx'

export type { TimelineConfig } from './config.ts'
export { resolveConfig } from './config.ts'
export type { TimelineKey } from './locales.ts'
export { previewText } from './preview.ts'
export type { TimelineItem, TimelineRailInjected, TimelineRailProps, TimelineRailState } from './slots.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'message-timeline'

/** Required services: the slot ledger, the session store, and the copy. */
export const inject = ['slots', 'sessions', 'locale']

/**
 * Client plugin body: register the header-utilities entry and install the DOM
 * tracker that publishes rail geometry and answers jumps.
 * @param ctx - client root context.
 * @param config - entry config; defaults apply when the runner passes none.
 */
export function apply(ctx: ClientContext, config?: Partial<TimelineConfig>): void {
  const options = resolveConfig(config)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'message-timeline: dictionaries')
  if (!options.enabled) return

  const tracker = installRailTracker(ctx, options.includeSteering)
  ctx.effect(() => () => { tracker.dispose() }, 'message-timeline: rail tracker')

  // The slot is declared by ui-conversation, whose apply order relative to
  // this plugin is unconstrained: register through slots.inject so the entry
  // waits for the declaration instead of crashing the loader at boot.
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'message-timeline',
    order: 100,
    locale: NS,
    inject: (sessionId): TimelineRailInjected => {
      const actx = ctx.sessions.scope(sessionId)
      if (actx === undefined) throw new Error('message-timeline: session resolved no scope')
      const conversation = actx.get('conversation')
      if (conversation === undefined) throw new Error('message-timeline: conversation service unavailable')
      return {
        includeSteering: options.includeSteering,
        panelWidth: options.panelWidth,
        initialPages: options.initialPages,
        loadOlder: () => conversation.loadOlder(),
        jumpTo: (key) => { tracker.jumpTo(key) },
        hooks: { rail: tracker.state },
      }
    },
  }, TimelineRailEntry))
}
