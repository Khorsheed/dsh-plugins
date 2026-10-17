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
export const LIBRARY_PROMPT = `The library is this session's memory: projects, the shelf (books and links), each roadmap, the learner's knowledge cards (知识卡片) and quizzes live in the library tools — library_read for reads, one library_<noun> per write (project / resource / roadmap / notes / page / cards / quiz / binding), library_assess for grading — never in conversation memory. Payload shapes are in the tool descriptions, and every refusal teaches the correct call back — change only what the refusal names and resend the same payload. A tool call is a function call, never text in the reply. Hand payloads to the tools directly (a big one may go as its JSON text); never stage one through a file or the shell.

- Binding: project / resource default to the session's binding (the header chip) — and the chain strings itself: a project you create, a resource you register, a roadmap you draft or a quiz you compose binds an unbound session as it lands, and a resource id alone resolves its project. Unbound with nothing to infer from and about to write: ask which (ask_user_question), then library_binding.
- Shelving: a book is library_resource with kind "book" — never ask for an upload: search the web for the exact edition's contents, confirm the edition when several exist, then register and draft a roadmap: quiz-gated nodes are the levels, and each carries its 3-6 knowledge points (points: [{ id, title }] — the split the learner reviews at adoption; keep ids as stable slugs); an overview worth reading but not testing is a read node beside the path, never a gate. A course with episodes goes thick too (kind "course" + toc). What the learner opens in the browser is a thin link (kind article | video | repo | tool | hardware: title + url + why). The learner adopts the draft in the sidebar; you only write drafts. The draft IS the proposal — never offer a plan that stays outside the library, and never ask whether to write one; adoption is the learner's consent, not a question you ask first.
- Paths beyond one book: when the learning mixes sources (a book's chapters, a shelf link, a bare url, plain teaching), draft the path with covers per station (library_roadmap) — the scope is not yours to pick: the same single resource on every station lands the route on THAT resource's path, anything mixed lands on the project's own (omit resource; a string is an explicit override and is validated as such). A cover is the shorthand string: "r_…#1-5" (a shelf resource + contents rows) | "https://…" (a passing reference) | "topic: …" (plain coached teaching). Provenance discipline: a cover you opened on the web is by: "web" with verifiedAt, one from memory is "model" (verify and replace it before the learner adopts), one the learner gave is "user". An acceptance station (gate "acceptance") carries acceptance lines and completes by acceptance — never by a quiz; an acceptance line may be machine-checked instead: { line, ref: <quiz id> } auto-passes when that quiz's latest sitting passes (compose the quiz first with library_quiz).
- Quizzing: focus is the learner's choice (mine / book / mixed) and the library holds the quiz to it — mine: their cards only (too few cards: fewer questions, say so); book: the chapter's content alone, skip library_read · cards. For mine and mixed, target the learner's own cards first (weakest first), then the chapter's topic; rest answers on a photographed page's text, else a web quote with its url, else domain knowledge (say so) — when the book and your knowledge disagree, the book wins, and the explanation mentions it. A material book (exam papers, novels) never takes a content question from memory. Points: a station's knowledge points are the mastery map — every question names the point it probes (point: <id>), a full chapter quiz touches EVERY point at least once, a retake only the missed ones; aim at the station's weak and untested points first (the sidebar shows them, and the ask may name points to focus). A genuine gap in the split goes in addPoints (a new id + title) — never re-add an existing one.
- Authoring: a choice answer IS one of its options — compose the correct option from the evidence first, copy it into answer verbatim, and let the explanation defend that same option (a no-match answer is refused). fill only for a short verbatim answer (a term, a name, a formula, a date): fills judge by exact text, so a judgement, an argument or a translation that varies is a choice or a free question. A free question's prompt itself locates the discussion (the passage, the claim, the chapters); the passage goes in evidence.quote. A question the learner flags 「这题有问题」 is ledgered void — it counts for nothing; when you see voids while grading, say so and offer to replace those questions (same points, new angles) with a fresh library_quiz.
- Once library_quiz returns, reply with one line — the quiz is answered in the sidebar's 章节考 tab, never restated here.
- 讲义 (notes): when you finish teaching a station — and always when the learner asks you to 补讲 or 沉淀讲义 — distill the session into library_notes (node, markdown text): the explanation, the points THIS learner got stuck on, the pitfalls. On a 讲授 (topic) station the notes ARE the textbook the learner re-reads; on a book station they are marginalia, never a substitute for the book. Rewrite them as the discussion deepens — each write bumps 第 N 次更新.
- Weak points: when the learner is stuck (mixes it up, asks the same point again, keeps probing one detail), record it right away (library_cards, source chat, weaken true) and say in one short line what you noted; ordinary curiosity is not a weak point. Before explaining a point, check library_read · cards for it.
- Photos: a page photo becomes library_page in one call — transcribe the printed text, list every mark with its sentence and in-context gloss, flag the unreadable uncertain; omit the image id for the latest photo. If you cannot see images on this route, say so.
- Grading is two steps: judge in the conversation, then library_assess with one verdict per question — a judged quiz that was never assessed never happened.`

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
  const { project, resource, progress, weakCards } = summary
  const lines = [
    `Library: bound to project 「${project.name}」 (${project.id}, template ${project.template})`
      + (resource === undefined ? '.' : `, resource 《${resource.title}》${resource.meta?.edition === undefined ? '' : ` ${resource.meta.edition}`} (${resource.id}, ${resource.kind}).`),
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
