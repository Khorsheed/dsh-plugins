/**
 * The `./agent` composition entry: the game mode's tools, their guidance
 * section and the `gamedev` / `game-design` skills. The package's
 * `cordis.patch.yml` inserts this row DISABLED at the profile root; the game
 * preset (`preset-dsh-gamedev`) names it in its own composition, so the tools
 * exist for that preset's sessions only. Never both live at once — the tools
 * would register twice (the canvas `./agent` pattern).
 * @module @khorsheed/dsh-game/agent
 */
import type { Context } from '@deepseek-ai/cordis'
import { GAME_SKILLS } from './skills.ts'
import type { GameService } from './store.ts'
import { gameToolDefinitions } from './tools.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'game-agent'

/** No hard injects: the core service is probed, the registries join through deferred injection. */
export const inject = []

interface PromptSections {
  section(section: { name: string; order: number; text: string }): () => void
}

interface SkillRegistrySlice {
  register(skill: { name: string; description: string; content: string; source: string; provider?: string }): () => void
}

/** One pointer paragraph; the rules live in the skills. */
const GUIDANCE = 'This session is the game-development mode. The user designs and plays a small web game (2D or 3D) with you: '
  + 'the conversation decides what the game is, the right-sidebar game tab shows the design doc and plays the latest '
  + 'version that passed the checks. Use game_open / game_read for the project; write its files with the '
  + 'ordinary file tools. Whenever you changed something playable, call game_publish before you report or ask anything, '
  + 'without waiting to be asked — a question does not end the turn, so the play area would still show the old version. '
  + 'When a CLI member reports its changes, publish them for it (members have no publish tool). Load the game-design skill when shaping the game with the user, and the gamedev skill before '
  + 'writing game code. Answer in the user\'s language.'

/**
 * Register the tools, the guidance and the skills, or nothing when the core is absent.
 * @param ctx - the mounting scope (a preset's plane, normally).
 */
export function apply(ctx: Context): void {
  const store = ctx.get('gameStore') as GameService | undefined
  if (store === undefined) {
    ctx.logger.warn('game-agent: the gameStore service is absent — the game tools are not registered')
    return
  }
  ctx.inject(['tools'], (toolsCtx) => {
    for (const definition of gameToolDefinitions(store)) {
      toolsCtx.effect(() => toolsCtx.tools.register(definition), `game-agent: ${definition.name} tool`)
    }
  })
  ctx.inject(['systemPrompt'], (promptCtx) => {
    const sections = promptCtx.get('systemPrompt') as PromptSections | undefined
    sections?.section({ name: 'game:mode', order: 152, text: GUIDANCE })
  })
  ctx.inject(['skills'], (skillCtx) => {
    const skills = skillCtx.get('skills') as SkillRegistrySlice | undefined
    if (skills === undefined) return
    for (const skill of GAME_SKILLS) {
      skillCtx.effect(() => skills.register({ ...skill, source: 'runtime', provider: '@khorsheed/dsh-game' }), `game-agent: ${skill.name} skill`)
    }
  })
}
