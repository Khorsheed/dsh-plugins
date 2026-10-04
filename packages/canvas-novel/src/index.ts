/**
 * canvas-novel, host half: provides the work-registry and per-work memory
 * store (`ctx.storyBible`). The state lives at `$DSH_HOME/state/story/` —
 * deployment-level state whose fence re-roots at the plugin's own directory
 * (see store.ts).
 *
 * The main-session tools, the focus pointer section and the `story` skill
 * are NOT registered here — they live in the `./agent` composition entry,
 * so a deployment decides where the story tools exist (profile-wide by the
 * shipped patch, or one preset by its own `agent.cordis.yml` — never both).
 * The genre ships no browser half of its own: its surfaces render inside
 * the canvas through the canvas tab's child slots.
 *
 * Composing this plugin out of cordis.yml removes every surface it adds; the
 * operator's works stay on disk.
 *
 * @module @khorsheed/dsh-canvas-novel
 */
import type { Context } from '@deepseek-ai/cordis'
import { StoryBibleService, type StoryBibleConfig } from './store.ts'

export { StoryBibleService, resolveStoryStateRoot, storyErrorOf, evidenceInBody, tailOf } from './store.ts'
export type { StoryBibleConfig } from './store.ts'
export { storyMainSessionToolDefinitions } from './tools.ts'
export { renderWriteBrief, renderPlanBrief, renderExtractBrief, estimateTokens, BRIEF_BUDGETS } from './brief.ts'
export type { BriefData } from './brief.ts'
export * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The canvas-novel's service core (the tools delegate here). */
    storyBible: StoryBibleService
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'canvas-novel'

/** The service core cannot work without the mounted filesystem. */
export const inject = ['fs']

/**
 * Plugin body: provide the service core.
 * @param ctx - owning Cordis Context.
 * @param config - optional store config (state-root override).
 */
export function apply(ctx: Context, config: StoryBibleConfig = {}): void {
  ctx.provide('storyBible', new StoryBibleService(ctx, config))
}
