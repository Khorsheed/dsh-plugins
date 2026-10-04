/**
 * The `./agent` composition entry: the story-bible's main-session surface,
 * made for preset-scoped mounting (the canvas ./agent precedent, documented
 * in this package's cordis.patch.yml — the profile-root row and a preset's
 * own row naming this entry must never be live at once, or the tools
 * register twice). It registers the three story_* tools, the focus pointer
 * FUNCTION section and the `story` skill; the core service is probed, the
 * three registries join through deferred injection.
 *
 * The pointer is a function section (the host's native
 * `PromptSection.text: (context) => string` contract, evaluated at every
 * assembly): with a focus it costs one line, without a focus it renders ''
 * and costs nothing. It is synchronous by contract, so it reads ONLY the
 * store's in-memory focus map (title captured at focus time) — and every
 * unreadable path (no agent on the assemble context, no sessionId, no
 * focus) degrades to '' rather than throwing into prompt assembly.
 *
 * @module @khorsheed/dsh-story-bible/agent
 */
import type { Context } from '@deepseek-ai/cordis'
import type { StoryBibleService } from './store.ts'
import { STORY_SKILL_CONTENT, STORY_SKILL_DESCRIPTION, STORY_SKILL_NAME } from './skill.ts'
import { storyMainSessionToolDefinitions } from './tools.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'story-bible-agent'

/**
 * No hard injects: `storyBible` belongs to this package's core row and is
 * PROBED at apply time (a preset or profile that mounts this entry without
 * the core still loads — the tools simply stay absent), and the three
 * registries join through deferred injection so mount order can never
 * strand the row.
 */
export const inject = []

/** The pointer section's registry surface: the host's PromptSection.text function form. */
interface PromptSections {
  section(section: {
    name: string
    order: number
    text: string | ((context: { agent?: { sessionId?: string } }) => string)
  }): () => void
}

/** The narrow skill-registry slice this entry registers into (the canvas precedent). */
interface SkillRegistrySlice {
  register(skill: { name: string; description: string; content: string; source: string; provider?: string }): () => void
}

/**
 * The pointer section's placement: after the deliverable-file references
 * (9000) and before structured output (9900) — a guidance line, not a tool
 * contract (proposal §4.1's 约 9500).
 */
export const STORY_POINTER_ORDER = 9500

/**
 * The pointer's text, evaluated per assembly. One line with a focus, ''
 * without — the full brief never auto-injects (skill 与 brief 分离), and
 * the `story` skill carries the workflow.
 * @param store - the story service whose in-memory focus map is the whole input.
 * @returns the section text for this assembly.
 */
export function storyPointerText(store: StoryBibleService): (context: { agent?: { sessionId?: string } }) => string {
  return (context) => {
    try {
      const sessionId = context.agent?.sessionId
      if (sessionId === undefined || sessionId === '') return ''
      const focused = store.focusedWork(sessionId)
      if (focused === undefined) return ''
      return `本会话 focus 作品《${focused.title}》：涉及写作/续写/设定/章节时，先 story_read(brief)；story skill 载有完整工作流。`
    } catch {
      // Degrade, never explode: a prompt assembly must not fail on a pointer.
      return ''
    }
  }
}

/**
 * Composition entry body: register the story tools, the pointer section and
 * the `story` skill, or nothing when the core service is absent.
 * @param ctx - the mounting scope's context (profile root or a preset's plane).
 */
export function apply(ctx: Context): void {
  const store = ctx.get('storyBible') as StoryBibleService | undefined
  if (store === undefined) {
    // Degrade, don't explode: the core row is not mounted here, so there is
    // nothing to delegate to. The composition still loads.
    ctx.logger.warn('story-bible-agent: the storyBible service is absent — the story tools are not registered')
    return
  }
  // Deferred injection, NOT an apply-time probe: `ctx.get('tools')` races the
  // registry's own mount order on the real composition tree and loses (the
  // datasets-tool precedent, via canvas).
  ctx.inject(['tools'], (toolsCtx) => {
    for (const definition of storyMainSessionToolDefinitions(store)) {
      toolsCtx.effect(
        () => toolsCtx.tools.register(definition),
        `story-bible-agent: ${definition.name} tool`,
      )
    }
  })
  ctx.inject(['systemPrompt'], (promptCtx) => {
    const sections = promptCtx.get('systemPrompt') as PromptSections | undefined
    sections?.section({
      name: 'story:pointer',
      order: STORY_POINTER_ORDER,
      text: storyPointerText(store),
    })
  })
  ctx.inject(['skills'], (skillCtx) => {
    const skills = skillCtx.get('skills') as SkillRegistrySlice | undefined
    if (skills === undefined) return
    skillCtx.effect(() => skills.register({
      name: STORY_SKILL_NAME,
      description: STORY_SKILL_DESCRIPTION,
      content: STORY_SKILL_CONTENT,
      source: 'runtime',
      provider: '@khorsheed/dsh-story-bible',
    }), `story-bible-agent: ${STORY_SKILL_NAME} skill`)
  })
}
