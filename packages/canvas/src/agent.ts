/**
 * The `./agent` composition entry: the canvas's main-session surface, made
 * for preset-scoped mounting. Everything here used to register at the
 * profile root (every session, every preset); moved out so a deployment can
 * choose WHERE the canvas tools exist — the package's `cordis.patch.yml`
 * inserts this row beside the core (community default: every session, the
 * status quo), while a preset-scoped deployment disables that row in its
 * profile patch and names this same entry in the target preset's
 * `agent.cordis.yml`. THE TWO MUST NEVER BE LIVE AT ONCE: same-named tools
 * register twice otherwise (the local-agent family's documented pattern for
 * exactly this arrangement).
 *
 * Mounting inside a preset's agent-plane works because `ctx.get('canvasBoard')`
 * resolves up the scope parent chain to the profile-root service; the
 * `tools` and `systemPrompt` registries reached through `ctx.inject` are the
 * preset's own layers, so the tools and the guidance exist only for that
 * preset's sessions (the plan-mode precedent).
 *
 * @module @khorsheed/dsh-canvas/agent
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CanvasBoardService } from './store.ts'
import { CANVAS_SKILL_CONTENT, CANVAS_SKILL_DESCRIPTION, CANVAS_SKILL_NAME } from './skill.ts'
import { canvasMainSessionToolDefinitions } from './tools.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'canvas-agent'

/**
 * No hard injects: `canvasBoard` belongs to this package's core row and is
 * PROBED at apply time (a preset or profile that mounts this entry without
 * the core still loads — the tools simply stay absent), and the two
 * registries join through deferred injection so mount order can never
 * strand the row.
 */
export const inject = []

/** The narrow prompt-section registry surface this entry opportunistically uses. */
interface PromptSections {
  section(section: { name: string; order: number; text: string }): () => void
}

/** The narrow skill-registry slice this entry registers into (the typesafe-tool precedent). */
interface SkillRegistrySlice {
  register(skill: { name: string; description: string; content: string; source: string; provider?: string }): () => void
}

/**
 * The guidance section's text. Deliberately one pointer sentence: every
 * behavioral rule (ghost-card flow, the no-substitution rule, comment style,
 * manuscript baseVersion, the type grammar) lives in the `canvas` skill,
 * which the model loads when it works on the canvas — the writing preset's
 * every turn should not carry it (2026-09-30 slimming).
 */
const CANVAS_TOOLS_GUIDANCE =
  'The canvas_* tools act on this session\'s canvas (the one open in the right-sidebar tab, or the one canvas_open chose); load the canvas skill before writing to it.'

/**
 * Composition entry body: register the canvas tools, their guidance section
 * and the `canvas` skill, or nothing when the core service is absent.
 * @param ctx - the mounting scope's context (profile root or a preset's plane).
 */
export function apply(ctx: Context): void {
  const board = ctx.get('canvasBoard') as CanvasBoardService | undefined
  if (board === undefined) {
    // Degrade, don't explode: the core row is not mounted here, so there is
    // nothing to delegate to. The composition still loads.
    ctx.logger.warn('canvas-agent: the canvasBoard service is absent — the canvas tools are not registered')
    return
  }
  // Deferred injection, NOT an apply-time probe: `ctx.get('tools')` races the
  // registry's own mount order on the real composition tree and loses,
  // silently never registering the tools (the datasets-tool precedent).
  ctx.inject(['tools'], (toolsCtx) => {
    for (const definition of canvasMainSessionToolDefinitions(board)) {
      toolsCtx.effect(
        () => toolsCtx.tools.register(definition),
        `canvas-agent: ${definition.name} tool`,
      )
    }
  })
  // The guidance describes those tools, so it rides with them — and through
  // the same deferred door, for the same reason.
  ctx.inject(['systemPrompt'], (promptCtx) => {
    const sections = promptCtx.get('systemPrompt') as PromptSections | undefined
    sections?.section({
      name: 'canvas:tools',
      order: 151,
      text: CANVAS_TOOLS_GUIDANCE,
    })
  })
  // The skill the descriptions point at rides the same door: registered from
  // a preset's plane it lands in that preset's skill layer alone.
  ctx.inject(['skills'], (skillCtx) => {
    const skills = skillCtx.get('skills') as SkillRegistrySlice | undefined
    if (skills === undefined) return
    skillCtx.effect(() => skills.register({
      name: CANVAS_SKILL_NAME,
      description: CANVAS_SKILL_DESCRIPTION,
      content: CANVAS_SKILL_CONTENT,
      source: 'runtime',
      provider: '@khorsheed/dsh-canvas',
    }), `canvas-agent: ${CANVAS_SKILL_NAME} skill`)
  })
}
