/**
 * Side chat (侧边对话), host half: provides the service core (`ctx.sideChat`)
 * and mounts its Remote data face.
 *
 * A right-sidebar "side Agent" available in every preset: each contextKey
 * binds one persistent agent session (ordinary conversations use the source
 * session's id; consumers supply their own opaque keys). Refs are opaque
 * `{ label, text }` chunks — this plugin knows nothing about any consumer's
 * types, and no consumer knows anything about it beyond the `openWith`
 * contract. The plugin never registers a model-facing tool of its own and
 * never mentions a consumer by name.
 *
 * Composing this plugin out of cordis.yml removes every surface it adds; the
 * side sessions and the contexts document stay on disk.
 *
 * @module @khorsheed/dsh-sidechat
 */
import type { Context } from '@deepseek-ai/cordis'
import { SideChatRemoteService } from './remote.ts'
import { SideChatService, type SideChatConfig } from './service.ts'

export { SideChatService } from './service.ts'
export type { SideChatConfig } from './service.ts'
export { SideChatStore, resolveSideChatStateRoot, SideChatStoreError } from './store.ts'
export { SideChatRemoteService } from './remote.ts'
export { projectTranscript, messageTextOf } from './journal.ts'
export { composeSideAgent, probeAgentPresets, probeSessionPersistence, inspectCold } from './agent-setup.ts'
export * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The side chat's service core (the Remote face delegates here; consumers call `openWith` on it). */
    sideChat: SideChatService
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'sidechat'

/**
 * The agent registry and the session store are the two capabilities the core
 * cannot work without: no `agents` means no side agent can ever spin up, and
 * no `sessions` means no cwd inheritance. Both are core host services (the
 * room precedent); everything else is probed at call time.
 */
export const inject = ['agents', 'sessions']

/**
 * Plugin body: provide the service core, then mount the Remote data face.
 * @param ctx - owning Cordis Context.
 * @param config - optional state-root and agent-preset overrides.
 */
export function apply(ctx: Context, config: SideChatConfig = {}): void {
  const service = new SideChatService(ctx, config)
  ctx.provide('sideChat', service)
  ctx.effect(() => () => service.disposeAgents(), 'sidechat: agent handles')
  ctx.plugin(SideChatRemoteService, {})
}
