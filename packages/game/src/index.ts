/**
 * Game mode, host half: provides the service core (`ctx.gameStore`), mounts
 * its Remote face, and runs the end-of-turn check loop for sessions bound to
 * a project. The model tools, their guidance and the skills live in the
 * `./agent` composition entry (preset-scoped).
 * @module @khorsheed/dsh-game
 */
import type { Context } from '@deepseek-ai/cordis'
import { registerTurnHooks } from './hooks.ts'
import { GameRemoteService } from './remote.ts'
import { GameService, type GameConfig } from './store.ts'

export { GameService, resolveGameStateRoot } from './store.ts'
export type { GameConfig } from './store.ts'
export { GameRemoteService } from './remote.ts'
export * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The game mode's service core. */
    gameStore: GameService
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'game'

/** The service core writes through the mounted filesystem. */
export const inject = ['fs']

/**
 * Plugin body.
 * @param ctx - owning Cordis Context.
 * @param config - plugin config.
 */
export function apply(ctx: Context, config: GameConfig = {}): void {
  const store = new GameService(ctx, config)
  ctx.provide('gameStore', store)
  ctx.effect(() => () => { void store.dispose() }, 'game: checker browser')
  ctx.plugin(GameRemoteService, {})
  registerTurnHooks(ctx, store)
}
