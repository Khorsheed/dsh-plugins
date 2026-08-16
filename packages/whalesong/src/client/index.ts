/**
 * Whalesong client plugin: sync the plugin config from the host anchor
 * (`GET /whalesong/config`, polled) and drive the runtime controller with it —
 * the whale whalesong overlay plus completion/blocked chimes when enabled,
 * zero residue when disabled. Dispose (hot unload via `entry.update({disabled})`
 * or fiber teardown) unwinds everything through the same controller path.
 * @module @deepseek-ai/dsh-whalesong/client
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { createConfigSync } from './config.ts'
import { createWhalesongRuntime } from './controller.ts'

/** Required services: the global session list snapshot feed. */
export const inject = ['sessions']

/**
 * Mount the whalesong client half.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const runtime = createWhalesongRuntime({ doc: document, win: window, list: ctx.sessions.list })
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
