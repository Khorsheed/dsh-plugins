/**
 * Request-inspector plugin, host half: provides the capture service core and
 * mounts its Remote face. All capture rides read-only listeners — the
 * `llm/stream` waterfall tee, `system-prompt/assemble` section attribution,
 * `session/event` turn/tool correlation — plus a lazy child-log lane through
 * `sessionPersistence` for fresh-process subagent runs. The plugin observes
 * requests; it never rewrites them, and a capture failure never touches the
 * model path.
 *
 * @module @khorsheed/dsh-context-lens
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
export const name = 'context-lens'

/**
 * Plugin body: provide the service core, then mount the Remote data face.
 *
 * No `static inject`: every seam the capture touches is an event name or a
 * probed service, so a composition missing one (no persistence backend, a host
 * without these events) simply yields an empty panel instead of a failed boot.
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
  }, 'context-lens: capture shutdown')
}
