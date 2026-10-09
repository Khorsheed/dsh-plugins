/**
 * Request-inspector plugin, host half: provides the capture service core and
 * mounts its Remote face. All capture rides read-only waterfall/event
 * listeners (`llm/stream`, `system-prompt/assemble`, `session/event`) — the
 * plugin observes requests, it never rewrites them.
 *
 * @module @khorsheed/dsh-request-inspector
 */
import type { Context } from '@deepseek-ai/cordis'
import { InspectorService, type InspectorConfig } from './service.ts'
import { RequestInspectorRemoteService } from './remote.ts'

export { RequestInspectorRemoteService } from './remote.ts'
export type { RequestInspectorRemoteConfig } from './remote.ts'
export { InspectorService } from './service.ts'
export type { InspectorConfig } from './service.ts'
export * from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'request-inspector'

/**
 * Plugin body: provide the service core, then mount the Remote data face.
 *
 * No `static inject`: the capture listeners probe their seams at apply time
 * and degrade to an empty panel when a seam is absent, so the row boots in
 * any composition.
 *
 * @param ctx - owning Cordis context.
 * @param config - optional plugin config.
 */
export function apply(ctx: Context, config: InspectorConfig = {}): void {
  const service = new InspectorService(ctx, config)
  ctx.provide('requestInspector', service)
  ctx.plugin(RequestInspectorRemoteService, {})
  ctx.effect(() => () => {
    service.dispose()
  }, 'request-inspector: capture shutdown')
}
