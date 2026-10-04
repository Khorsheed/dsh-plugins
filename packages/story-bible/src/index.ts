/**
 * story-bible, host half: provides the work-registry and per-work memory
 * store (`ctx.storyBible`) and mounts its Remote data face (namespace
 * `story`). The state lives at `$DSH_HOME/state/story/` — deployment-level
 * state whose fence re-roots at the plugin's own directory (see store.ts).
 *
 * The main-session tools, the focus pointer section and the `story` skill
 * are NOT registered here — they live in the `./agent` composition entry,
 * so a deployment decides where the story tools exist (profile-wide by the
 * shipped patch, or one preset by its own `agent.cordis.yml` — never both).
 * M1 ships no browser half: the right-sidebar tabs land with M3 against the
 * Remote face mounted here.
 *
 * Composing this plugin out of cordis.yml removes every surface it adds; the
 * operator's works stay on disk.
 *
 * @module @khorsheed/dsh-story-bible
 */
import type { Context } from '@deepseek-ai/cordis'
import { StoryBibleService, type StoryBibleConfig } from './store.ts'
import { StoryRemoteService } from './remote.ts'

export { StoryBibleService, resolveStoryStateRoot, storyErrorOf, evidenceInBody, tailOf } from './store.ts'
export type { StoryBibleConfig } from './store.ts'
export { StoryRemoteService } from './remote.ts'
export { storyMainSessionToolDefinitions } from './tools.ts'
export { renderWriteBrief, renderPlanBrief, renderExtractBrief, estimateTokens, BRIEF_BUDGETS } from './brief.ts'
export type { BriefData } from './brief.ts'
export * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The story-bible's service core (the Remote face and the tools delegate here). */
    storyBible: StoryBibleService
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'story-bible'

/** The service core cannot work without the mounted filesystem. */
export const inject = ['fs']

/**
 * Plugin body: provide the service core and mount the Remote data face.
 * @param ctx - owning Cordis Context.
 * @param config - optional store config (state-root override).
 */
export function apply(ctx: Context, config: StoryBibleConfig = {}): void {
  ctx.provide('storyBible', new StoryBibleService(ctx, config))
  ctx.plugin(StoryRemoteService, {})
}
