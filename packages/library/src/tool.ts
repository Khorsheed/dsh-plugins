/**
 * The session-granted library tools AND the coach's prompt — this package's
 * `./tool` composition entry for agent-preset compositions. The row provides
 * NO service (the preset-mount isolate-realm rule forbids service rows); it
 * registers the three model tools, their guidance section, and a per-turn
 * context line naming the session's bound book and its weakest cards, all
 * delegating to the global `ctx.library` service core the core row provides
 * at the profile root — the official tool-row shape (the evaluation-family
 * fold, T88). Granting is therefore per-session: a preset names the row, its
 * sessions get all of it; every other preset's sessions get none.
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
export const LIBRARY_PROMPT = `The library is this session's memory: projects, books, each book's roadmap, the learner's knowledge cards (知识卡片) and quizzes live in library_read / library_write / library_assess — never in conversation memory.

- Binding: the session header binds this session to a project or one of its books, and project / book default to it. Unbound and about to write: ask which (ask_user_question), then library_write · binding. When you add the book the learner is about to read, bind the session to that book.
- Adding a book: never ask for an upload. Search the web for the exact edition and its contents (publisher, library-catalog or retailer pages — never a full-text copy), confirm the edition with the learner when several exist, then library_write · book (cite the contents url) and draft a roadmap. The learner adopts the draft in the sidebar; you only write drafts.
- What to quiz, in order: the learner's own cards (marked in photos, asked about, missed before — library_read · cards, weakest first), then the chapter's topic. What it rests on, in order: a photographed page's text, a web quote with its url, domain knowledge (say so). When the book and your knowledge disagree, the book wins — mention the difference in the explanation. A material book (exam papers, novels) never takes a question about its content from memory.
- Weak points: when the learner shows they are stuck — says they mix something up, asks the same point again, keeps probing one detail — record it right away (library_write · cards, source chat, weaken true) and say in one short line what you noted. Ordinary curiosity is not a weak point. Before explaining a point, check library_read · cards for it.
- Photos: a page photo becomes library_write · page in one call — transcribe the printed text, list every mark (underline, margin note) with its sentence and in-context gloss, flag the ones you cannot read as uncertain. The tool finds the photo itself: pass the image id, or omit it for the latest photo. If you cannot see images on this route, say so.
- Grading is two steps: judge in the conversation, then library_assess with one verdict per question — a judged quiz that was never assessed never happened.
- Every refusal says how to fix the call; follow it rather than guessing.`

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
  const { project, book, progress, weakCards } = summary
  const lines = [
    `Library: bound to project 「${project.name}」 (${project.id}, template ${project.template})`
      + (book === undefined ? '.' : `, book 《${book.title}》${book.edition === undefined ? '' : ` ${book.edition}`} (${book.id}, ${book.bookKind}).`),
  ]
  if (progress?.current !== undefined) lines.push(`Current node: ${progress.current.title} (${progress.current.id}).`)
  if (progress?.hasDraft === true) lines.push('A roadmap draft is waiting for the learner to adopt it in the sidebar.')
  if (weakCards.length > 0) lines.push(`Weak cards: ${weakCards.map(card => `${card.term} [${card.weakness}]`).join('; ')}.`)
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
