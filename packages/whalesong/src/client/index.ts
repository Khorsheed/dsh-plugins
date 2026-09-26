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
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
// Type-only: pulls the uiSession service merge (probed via ctx.get).
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import { createConfigSync } from './config.ts'
import { createWhalesongRuntime } from './controller.ts'
import { sessionStatusFromLegacyPending, type LegacyPendingInteractionSnapshot } from './status.ts'

/** Required services: the global session list snapshot feed. */
export const inject = ['sessions']

/**
 * Mount the whalesong client half.
 * @param ctx - Client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    // The Session status feed lives on the ui-session service; probe it so an
    // assembly without that UI layer degrades the blocked chime off instead of
    // pending the fiber. 0.1.6-alpha.2 merged `pendingInteractions` into
    // `sessionStatus`; the legacy name is gone from the new types, so both
    // faces are read off a duck type and the 0.1.5 feed is adapted forward.
    const uiSession = ctx.get('uiSession') as {
      sessionStatus?: ObservableSnapshot<SessionStatusSnapshot>
      pendingInteractions?: ObservableSnapshot<LegacyPendingInteractionSnapshot>
    } | undefined
    const status = uiSession?.sessionStatus
      ?? (uiSession?.pendingInteractions === undefined
        ? undefined
        : sessionStatusFromLegacyPending(uiSession.pendingInteractions))
    const runtime = createWhalesongRuntime({
      doc: document,
      win: window,
      list: ctx.sessions.list,
      ...(status === undefined ? {} : { pending: status }),
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
