/**
 * Inspiration canvas (灵感画布), host half: provides the pad's service core
 * (`ctx.canvasStore`) and the board's (`ctx.canvasBoard`), and mounts its
 * Remote data face.
 *
 * The pad is a workspace-level directory of plain markdown documents; the v2
 * board is deployment-level state at `$DSH_HOME/state/canvas/`. Every
 * mutation goes through the mounted `ctx.fs`, so the deployment's sandbox
 * mode fences each write and the observation policy sees it (the board's
 * fence re-roots at the plugin's own state dir — see the package Agent
 * Note). The main-session tools and their guidance section live in the
 * `./agent` composition entry (preset-scoped mounting; this root apply
 * registers none of them).
 *
 * Composing this plugin out of cordis.yml removes every surface it adds; the
 * operator's documents stay on disk.
 *
 * @module @khorsheed/dsh-canvas
 */
import type { Context } from '@deepseek-ai/cordis'
import { CanvasService } from './service.ts'
import { CanvasBoardService, type CanvasBoardConfig } from './store.ts'
import { CanvasRemoteService } from './remote.ts'

export { CanvasService, canvasErrorOf } from './service.ts'
export { CanvasBoardService, resolveCanvasStateRoot } from './store.ts'
export type { CanvasBoardConfig } from './store.ts'
export { CanvasRemoteService } from './remote.ts'
export { canvasMainSessionToolDefinitions } from './tools.ts'
export * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The inspiration pad's service core (the Remote face delegates here). */
    canvasStore: CanvasService
    /** The canvas space's board service core (deployment-level state). */
    canvasBoard: CanvasBoardService
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'canvas'

/** The service core cannot work without the mounted filesystem. */
export const inject = ['fs']

/**
 * Plugin body: provide the service cores and mount the Remote data face. The
 * main-session tools and the guidance section are NOT registered here — they
 * live in the `./agent` composition entry, so a deployment decides where the
 * canvas tools exist (profile-wide by the shipped patch, or one preset by
 * its own `agent.cordis.yml` — never both).
 * @param ctx - owning Cordis Context.
 * @param config - optional board config (state-root override).
 */
export function apply(ctx: Context, config: CanvasBoardConfig = {}): void {
  ctx.provide('canvasStore', new CanvasService(ctx))
  ctx.provide('canvasBoard', new CanvasBoardService(ctx, config))
  ctx.plugin(CanvasRemoteService, {})
}
