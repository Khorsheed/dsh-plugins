/**
 * The reader's tool composition entry (`@khorsheed/dsh-reader/tool`).
 *
 * A row of its own so a composition decides where the tools are visible: the
 * package's patch mounts it at the profile root (every session, for now); a
 * preset may mount it in its own composition instead. It delegates to the
 * core row's `reader` and `readerNotes` services, resolved along the scope
 * chain; without them it registers nothing.
 *
 * @module @khorsheed/dsh-reader/tool
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ReaderNotesStore } from './notes.ts'
import { READER_SKILL_CONTENT, READER_SKILL_DESCRIPTION, READER_SKILL_NAME } from './skill.ts'
import { readerToolDefinitions, type ReaderToolCore } from './tools.ts'

interface SkillRegistrySlice {
  register(skill: { name: string; description: string; content: string; source: string; provider?: string }): () => void
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'reader-tool'

/** Nothing hard-injected: the core services are probed, the tool registry is waited for. */
export const inject = []

/**
 * Register the reader's tools.
 *
 * @param ctx - owning Cordis context.
 */
export function apply(ctx: Context): void {
  const core = ctx.get('reader') as ReaderToolCore | undefined
  const notes = ctx.get('readerNotes') as ReaderNotesStore | undefined
  if (core === undefined || notes === undefined) {
    // Degrade, don't explode: the core row is not mounted in this composition.
    ctx.logger.warn('reader-tool: the reader services are absent — the reader tools are not registered')
    return
  }
  // Deferred, not an apply-time probe: `ctx.get('tools')` races the registry's
  // own mount order (the canvas-agent / datasets-tool precedent).
  ctx.inject(['tools'], (toolsCtx) => {
    for (const definition of readerToolDefinitions(core, notes)) {
      toolsCtx.effect(() => toolsCtx.tools.register(definition), `reader-tool: ${definition.name} tool`)
    }
  })
  // The skill the descriptions point at rides the same deferred door.
  ctx.inject(['skills'], (skillCtx) => {
    const skills = skillCtx.get('skills') as SkillRegistrySlice | undefined
    if (skills === undefined) return
    skillCtx.effect(() => skills.register({
      name: READER_SKILL_NAME,
      description: READER_SKILL_DESCRIPTION,
      content: READER_SKILL_CONTENT,
      source: 'runtime',
      provider: '@khorsheed/dsh-reader',
    }), `reader-tool: ${READER_SKILL_NAME} skill`)
  })
}
