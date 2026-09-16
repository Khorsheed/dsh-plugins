/**
 * Inspiration canvas (灵感画布), host half: provides the pad's service core
 * (`ctx.canvasStore`) and mounts its Remote data face.
 *
 * The pad is a workspace-level directory of plain markdown documents — one
 * item per file — plus a `.index.json` sidecar holding the display order and
 * the archive set. Every mutation goes through the mounted `ctx.fs`, so the
 * deployment's sandbox mode fences each write and the observation policy sees
 * it. Nothing here registers a model-facing tool and nothing is injected into
 * the prompt: the v1 contract is that the operator copies the path by hand.
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
 * Plugin body: provide the service cores, then mount the Remote data face.
 * @param ctx - owning Cordis Context.
 * @param config - optional board config (state-root override).
 */
export function apply(ctx: Context, config: CanvasBoardConfig = {}): void {
  ctx.provide('canvasStore', new CanvasService(ctx))
  ctx.provide('canvasBoard', new CanvasBoardService(ctx, config))
  ctx.plugin(CanvasRemoteService, {})
}
