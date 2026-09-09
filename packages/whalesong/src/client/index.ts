/**
 * Whalesong client plugin: sync the plugin config from the host anchor
 * (`GET /whalesong/config`, polled) and drive the runtime controller with it —
 * the whale whalesong overlay plus completion/blocked chimes when enabled,
 * zero residue when disabled. Dispose (hot unload via `entry.update({disabled})`
 * or fiber teardown) unwinds everything through the same controller path.
 * @module @khorsheed/dsh-whalesong/client
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the Controller service merge (ctx.sessions).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the uiSession service merge (probed via ctx.get).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { createConfigSync } from './config.ts'
import { createWhalesongRuntime } from './controller.ts'

/** Required services: the global session list snapshot feed. */
export const inject = ['sessions']

/**
 * Mount the whalesong client half.
 * @param ctx - Client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    // The pending-interaction feed lives on the ui-session service; probe it
    // so an assembly without that UI layer degrades the blocked chime off
    // instead of pending the fiber.
    const uiSession = ctx.get('uiSession')
    const runtime = createWhalesongRuntime({
      doc: document,
      win: window,
      list: ctx.sessions.list,
      ...(uiSession === undefined ? {} : { pending: uiSession.pendingInteractions }),
    })
    const sync = createConfigSync(window)
    const unsubscribe = sync.subscribe((config) => { runtime.applyConfig(config) })
    // Optimistic default (enabled) until the first route response lands; a
    // disabled config tears down within one poll round-trip.
    runtime.applyConfig(sync.get())

    return () => {
      unsubscribe()
      sync.dispose()
      runtime.dispose()
    }
  }, 'whalesong: config sync + session-state runtime')
}
