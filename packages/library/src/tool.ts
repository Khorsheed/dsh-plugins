/**
 * The session-granted library tools AND the coach's prompt — this package's
 * `./tool` composition entry for agent-preset compositions. The row provides
 * NO service (the preset-mount isolate-realm rule forbids service rows); it
 * registers the model tools (library_read, one library_<noun> per write,
 * library_assess), their guidance section, and a per-turn context line naming
 * the session's bound book and its weakest cards, all delegating to the
 * global `ctx.library` service core the core row provides at the profile root
 * — the official tool-row shape (the evaluation-family fold, T88). Granting
 * is therefore per-session: a preset names the row, its sessions get all of
 * it; every other preset's sessions get none.
 *
 * The row can also quiet its scope for a focused preset (the learning
 * mode): `hideSections` blanks root prompt sections that do not apply there
 * (a scoped section shadows a global one of the same name), and `denyTools`
 * masks root-registered tools for the scope. Both are best-effort — a name
 * the composition does not hold is skipped, never a boot failure.
 *
 * @module @khorsheed/dsh-library/tool
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: pulls this package's `Context.library` service augmentation.
import type {} from './index.ts'
import { libraryToolDefinitions } from './tool-definition.ts'
import type { LibraryService } from './service.ts'
import { ImageRefCache } from './image-refs.ts'
import { masteryReason } from './mastery.ts'
import { profileOf } from './profiles.ts'

const PACKAGE_NAME = '@khorsheed/dsh-library'

/**
 * Tag the model-visible tools with their origin (AGENTS.md § Tool origin
 * tagging; seam S12): the capability catalog reads this `Symbol.for`-keyed
 * tag back through `ctx.tools.get()`, so the library tools attribute to THIS
 * package (the row the preset mounts). The tag is host-side only and never
 * travels on the model wire. Inlined (the eval precedent) — importing the
 * helper from capability-catalog would be a cross-package edge.
 */
const definePluginTool = <T extends object>(def: T): T =>
  Object.assign(def, {
    [Symbol.for('dsh.tool.origin')]: { channel: 'plugin', owner: PACKAGE_NAME },
  })

/** Plugin configuration. */
export interface LibraryToolConfig {
  /**
   * Whether this row grants the library tools: `all` (the default) or `none`
   * (no tools, no guidance, no context — a deployment where the model must not
   * even read the library). The core row's faces stay mounted either way.
   */
  tools?: 'all' | 'none'
  /** Root prompt sections to blank in this scope (e.g. `harness:source`). */
  hideSections?: string[]
  /** Root-registered tools to mask in this scope (e.g. `list_capabilities`). */
  denyTools?: string[]
}

export const Config: z = z.object({
  tools: z.union([z.const('all'), z.const('none')]).default('all'),
  hideSections: z.array(z.string()).default([]),
  denyTools: z.array(z.string()).default([]),
})

/** Cordis plugin name used by loader diagnostics. */
export const name = 'library-tool'

/**
 * The `library` core is a declared inject (the owning-family companion
 * exception to the community-service probe rule): a preset's standing scope
 * mounts at registry-activation time, BEFORE the profile's later bundle rows
 * provide the core, so a one-shot ctx.get probe at apply saw ABSENT there and
 * nothing re-ran the row (rc.1 boot order; 3080 production 2026-09-27). The
 * declared inject pends the row until the core provides, then the body
 * applies. The tools registry and the prompt assembly still join through
 * deferred injection so their mount order cannot strand the registrations.
 */
export const inject = ['library']

/** The narrow prompt registry surface this plugin uses. */
interface PromptRegistry {
  section(section: { name: string; order: number; text: string }): () => void
  context(context: { name: string; order: number; text: (context: { agent?: { session?: { id: unknown } } }) => string }): () => void
}

/** The narrow tools-registry surface for masking root tools. */
interface ToolMask {
  restrict(filter: { deny: string[] }): () => void
}

/**
 * The coach's guidance, registered beside the tools it describes (order 114,
 * the eval line). Per-`what` payloads are in the tool descriptions.
 */
export const LIBRARY_PROMPT = `The library holds the learner's projects, textbooks, paths and quizzes — record them there, never only in the chat. A refusal says what to fix: fix it and resend. Quote with 「」 inside any text you pass.

The learner leads; follow this order and stop where it says:
1. A goal → ask one or two questions (level, direction), then library_project.
2. Textbooks → library_textbook: the learner's book (verify edition and contents online), one you pick, or one you author.
3. A path → library_roadmap. Then describe it in two lines and STOP: the learner reviews and adopts it in the sidebar. Before that: no 讲义, no teaching, no quiz.
4. A station starts only when the learner says so (「开始学这一站」 or naming it). Then write its 讲义 for this learner (library_notes), say in one line that they are ready, and wait: the learner reads first and asks. Answer in the chat; if a question shows the 讲义 missed or got something wrong, fix that section.
5. Stuck on the material → library_cards on that point. A quiz when asked → library_quiz, then one line. Grade → library_assess.
6. A station passed → name the next one and ask whether to start it.

The per-turn "Library:" context is the current state; trust it over the chat.`

/** The bound-context line's order: right after the sandbox / approval snapshots. */
const CONTEXT_ORDER = 650

/** How many weak cards the per-turn context names. */
const CONTEXT_CARDS = 12

/**
 * Render the per-turn context for one session: its binding and the weakest
 * cards there. Kept short — it rides every turn.
 */
export function renderBindingContext(service: LibraryService, sessionId: string): string {
  const summary = service.bindingSummary(sessionId, CONTEXT_CARDS)
  if (summary.binding === undefined) return 'Library: this session is not bound to a project yet.'
  if (summary.project === undefined) return 'Library: this session\'s bound project no longer exists — ask the learner which one to use.'
  const { project, resource, textbooks, weakCards } = summary
  const lines = [
    `Library: bound to project 「${project.name}」 (${project.id}, template ${project.template})`
      + (resource === undefined ? '.' : `, textbook 《${resource.title}》 (${resource.id}).`),
  ]
  if (summary.binding.previousProjectId !== undefined && summary.binding.previousProjectId !== project.id) {
    const previous = service.projectName(summary.binding.previousProjectId)
    lines.push(`This session worked on another project${previous === undefined ? '' : ` 「${previous}」`} before switching here: nothing said about it is 「${project.name}」's material — never quiz, teach or note from it here.`)
  }
  if (textbooks.length === 0) {
    lines.push('Textbooks: none yet — shelve them first (library_textbook).')
  } else {
    lines.push('Textbooks (study order):')
    for (const textbook of textbooks) {
      const state = textbook.roadmap === undefined
        ? (textbook.hasDraft ? `draft ${textbook.draftTotal ?? 0} stations, waiting for the learner to adopt` : 'no path yet')
        : `path adopted, ${textbook.roadmap.done}/${textbook.roadmap.total} done`
          + (textbook.current === undefined ? '' : `, current: ${textbook.current.title} (${textbook.current.id})`)
          + (textbook.hasDraft ? `; a new draft (${textbook.draftTotal ?? 0} stations) waits to replace it` : '')
      lines.push(` ${textbook.seq ?? '-'}. 《${textbook.title}》 (${textbook.id}) ${state}`)
    }
  }
  const profile = profileOf(project.template)
  if (profile.pointsDriven && summary.station !== undefined) {
    const { station } = summary
    lines.push(`Current station ${station.title} (${station.id}) — its points:`)
    for (const point of station.mastery.points) {
      const reason = masteryReason(point)
      lines.push(` - ${point.title} (${point.id}): ${point.state}${reason === '' ? '' : ` — ${reason}`}`)
    }
    if (station.mastery.open.length > 0) lines.push(`Open misses here: ${station.mastery.open.length} (the learner retakes them in the sidebar; they count for points, not for passing).`)
  }
  if (weakCards.length > 0) lines.push(`Weak cards: ${weakCards.map(card => `${card.term} [${card.weakness}]`).join('; ')}.`)
  lines.push(`Subject: ${profile.coachHint}`)
  return lines.join('\n')
}

/**
 * Plugin body: register the three tools, their guidance, and the per-turn
 * bound context; quiet the scope when configured. The declared `library`
 * inject pends the row until the core provides; the in-body guard stays as
 * the defensive direct-call path.
 * @param ctx - Cordis context (the preset's agent-plane mount).
 * @param config - validated plugin config.
 */
export function apply(ctx: Context, config: LibraryToolConfig = {}): void {
  const service = ctx.get('library')
  if (service === undefined) {
    ctx.logger.info(`${PACKAGE_NAME}: the global library service is absent — the library tools are not registered`)
    return
  }
  // `none` grants nothing at all (guidance about an absent tool is a wrong
  // instruction, not a harmless one).
  if ((config.tools ?? 'all') === 'none') return
  // Deferred injection, NOT an apply-time probe: `ctx.get('tools')` races the
  // tools registry's own mount order on the real composition tree.
  // Photos: remember each session's image references as they are committed,
  // so a recorded page carries the whole reference the model cannot see.
  const images = new ImageRefCache()
  ctx.on('session/event' as never, ((session: { id: unknown }, event: { type?: unknown; data?: unknown }) => {
    images.observe(String(session.id), event)
  }) as never)
  ctx.inject(['tools'], (toolsCtx) => {
    for (const definition of libraryToolDefinitions(service, images)) {
      toolsCtx.effect(
        () => toolsCtx.tools.register(definePluginTool(definition)),
        `${PACKAGE_NAME}: ${definition.name} tool`,
      )
    }
    for (const toolName of config.denyTools ?? []) {
      try {
        toolsCtx.effect(() => (toolsCtx.tools as unknown as ToolMask).restrict({ deny: [toolName] }), `${PACKAGE_NAME}: mask ${toolName}`)
      } catch (error) {
        ctx.logger.info(`${PACKAGE_NAME}: could not mask ${toolName} here — ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  })
  ctx.inject(['systemPrompt'], (promptCtx) => {
    const prompt = promptCtx.get('systemPrompt') as PromptRegistry | undefined
    if (prompt === undefined) return
    prompt.section({ name: 'tool:library', order: 114, text: LIBRARY_PROMPT })
    for (const sectionName of config.hideSections ?? []) {
      try {
        prompt.section({ name: sectionName, order: 0, text: '' })
      } catch (error) {
        ctx.logger.info(`${PACKAGE_NAME}: could not blank ${sectionName} — ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    // The callback is synchronous; the store's reads are too, and small.
    prompt.context({
      name: 'library:binding',
      order: CONTEXT_ORDER,
      text: (context) => {
        const id = context.agent?.session?.id
        if (id === undefined) return ''
        try {
          return renderBindingContext(service, String(id))
        } catch {
          return ''
        }
      },
    })
  })
}

export { libraryToolDefinitions, LIBRARY_TOOL_NAMES } from './tool-definition.ts'
