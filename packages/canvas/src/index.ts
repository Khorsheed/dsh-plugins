/**
 * Inspiration canvas (灵感画布), host half: provides the pad's service core
 * (`ctx.canvasStore`) and the board's (`ctx.canvasBoard`), mounts its Remote
 * data face, and — M3 — registers the two canvas tools into the profile-root
 * tools registry (the main-session entrance), with their guidance section.
 *
 * The pad is a workspace-level directory of plain markdown documents; the v2
 * board is deployment-level state at `$DSH_HOME/state/canvas/`. Every
 * mutation goes through the mounted `ctx.fs`, so the deployment's sandbox
 * mode fences each write and the observation policy sees it (the board's
 * fence re-roots at the plugin's own state dir — see the package Agent
 * Note). The tools tag their origin the documented no-import way and answer
 * "no canvas open" as text, never as an error.
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
import { canvasMainSessionToolDefinitions } from './tools.ts'

export { CanvasService, canvasErrorOf } from './service.ts'
export { CanvasBoardService, resolveCanvasStateRoot } from './store.ts'
export type { CanvasBoardConfig, SideChatMirror } from './store.ts'
export { CanvasRemoteService } from './remote.ts'
export { canvasMainSessionToolDefinitions, canvasToolDefinitions } from './tools.ts'
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

/** The narrow prompt-section registry surface this plugin opportunistically uses. */
interface PromptSections {
  section(section: { name: string; order: number; text: string }): () => void
}

/**
 * Plugin body: provide the service cores, mount the Remote data face, then
 * register the main-session canvas tools and their guidance section through
 * the deferred doors (the registries' mount order is not ours to race).
 * @param ctx - owning Cordis Context.
 * @param config - optional board config (state-root override).
 */
export function apply(ctx: Context, config: CanvasBoardConfig = {}): void {
  const board = new CanvasBoardService(ctx, config)
  ctx.provide('canvasStore', new CanvasService(ctx))
  ctx.provide('canvasBoard', board)
  ctx.plugin(CanvasRemoteService, {})

  // M3's second entrance: the two canvas tools in the profile-root registry,
  // so the MAIN session's agent can edit the open canvas too (the side-chat
  // openWith path is untouched). Deferred injection, NOT an apply-time probe
  // — the registry's own mount order would race a `ctx.get` and silently
  // lose (the datasets-tool precedent).
  ctx.inject(['tools'], (toolsCtx) => {
    for (const definition of canvasMainSessionToolDefinitions(board)) {
      toolsCtx.effect(
        () => toolsCtx.tools.register(definition),
        `canvas: ${definition.name} tool`,
      )
    }
  })
  // The guidance rides with the tools through the same deferred door.
  ctx.inject(['systemPrompt'], (promptCtx) => {
    const sections = promptCtx.get('systemPrompt') as PromptSections | undefined
    sections?.section({
      name: 'canvas:tools',
      order: 151,
      text:
        '画布工具（canvas_*）作用于右栏「画布详情」tab 当前打开的画布：提议新卡用 canvas_propose_card'
        + '（落成 proposed 待用户确认，绝不在正文里贴卡片冒充落卡），评论用 canvas_comment（指出假设或'
        + '张力并以一个尖锐问题收尾）。没有打开的画布时工具会明说——提醒用户先打开一块，不要自己猜。',
    })
  })
}
