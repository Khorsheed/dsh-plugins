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

/**
 * The guidance section's text. Deliberately one pointer sentence: every
 * behavioral rule (ghost-card flow, the no-substitution rule, comment style,
 * manuscript baseVersion, the no-canvas fallback) lives in the tool
 * descriptions themselves, which the model reads with the catalog — repeating
 * them here just spends prompt tokens twice (2026-09-29 slimming). English,
 * the host prompt's own voice; the tool descriptions stay Chinese (the
 * canvas's writing-domain voice) — sections and catalogs are separate layers.
 */
const CANVAS_TOOLS_GUIDANCE =
  'The canvas_* tools act on the canvas currently open in the right-sidebar tab; when no canvas is open the tool says so — ask the user to open one.'

/**
 * Composition entry body: register the two canvas tools and their guidance
 * section, or nothing when the core service is absent.
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
}
