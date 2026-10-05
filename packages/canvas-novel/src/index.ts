/**
 * canvas-novel, host half: registers the 长篇小说 genre with the canvas
 * (`ctx.canvasBoard`, joined through deferred injection — without the canvas
 * there is no genre and no work, and nothing throws) and provides the novel
 * engine (`ctx.canvasNovel`). A work IS a canvas whose genre is this one, and
 * its cards are the settings; the engine's own state (refs, audit notes,
 * chapter index, journals, pending queue) lives at
 * `$DSH_HOME/state/novel/<canvasId>/` —
 * deployment-level state whose fence re-roots at the plugin's own directory
 * (see store.ts).
 *
 * The main-session tools, the pointer section and the `novel` skill are NOT
 * registered here — they live in the `./agent` composition entry,
 * so a deployment decides where the novel tools exist (profile-wide by the
 * shipped patch, or one preset by its own `agent.cordis.yml` — never both).
 * The browser half (`./client`) mounts no surface of its own either: the
 * pending strip, the ledger page and the chapter page render inside the
 * canvas through the canvas tab's child slots, reading the `novel` Remote
 * mounted here.
 *
 * Composing this plugin out of cordis.yml removes every surface it adds; the
 * operator's works stay on disk.
 *
 * @module @khorsheed/dsh-canvas-novel
 */
import type { Context } from '@deepseek-ai/cordis'
import { NOVEL_GENRE, type CanvasBoardSlice } from './genre.ts'
import { NovelRemoteService } from './remote.ts'
import { NovelService, type NovelConfig } from './store.ts'

export { NovelService, resolveNovelStateRoot, novelErrorOf, evidenceInBody, tailOf, cleanFields, entriesOf, MAIN_FIELD } from './store.ts'
export type { NovelConfig, WorkEntries, CardHandle } from './store.ts'
export { novelToolDefinitions } from './tools.ts'
export { NovelRemoteService } from './remote.ts'
export type { NovelRemoteConfig } from './remote.ts'
export { renderWriteBrief, renderPlanBrief, renderExtractBrief, estimateTokens, BRIEF_BUDGETS } from './brief.ts'
export type { BriefData } from './brief.ts'
export * from './types.ts'
export { NOVEL_GENRE, NOVEL_ROLES, NOVEL_AGENT_ROW, canvasBoardOf } from './genre.ts'
export type { CanvasBoardSlice, NovelBoardView, NovelCardView, NovelCategorySeed, NovelGenreDefinition } from './genre.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The canvas-novel's engine (the tools delegate here). */
    canvasNovel: NovelService
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'canvas-novel'

/** The service core cannot work without the mounted filesystem. */
export const inject = ['fs']

/**
 * Plugin body: provide the service core, mount its Remote face, and register
 * the genre once the canvas is there.
 * @param ctx - owning Cordis Context.
 * @param config - optional store config (state-root override).
 */
export function apply(ctx: Context, config: NovelConfig = {}): void {
  ctx.provide('canvasNovel', new NovelService(ctx, config))
  ctx.plugin(NovelRemoteService, {})
  ctx.inject(['canvasBoard'], (canvasCtx) => {
    const canvas = canvasCtx.get('canvasBoard') as CanvasBoardSlice
    canvasCtx.effect(() => canvas.registerGenre(NOVEL_GENRE), 'canvas-novel: the 长篇小说 genre')
  })
}
