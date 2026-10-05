/**
 * The `./agent` composition entry: the canvas-novel's main-session surface,
 * made for preset-scoped mounting (the canvas ./agent precedent, documented
 * in this package's cordis.patch.yml). The preset grant decides which
 * sessions MAY write novels; the session's canvas binding decides which
 * actually do: the three novel_* tools are registered on an agent's own
 * scope only while its session is bound to a 长篇小说 canvas, and are absent
 * — not denied, absent — everywhere else. `novel_bind` (the model's way to
 * that binding), the `novel` skill and the pointer FUNCTION section register
 * once for the mounting scope.
 *
 * The grant is re-evaluated on `agent/created` (scope-filtered: only the
 * agents composed under this entry's scope arrive), on
 * `agent-preset/selected` (a blank session switched presets: the host
 * recomposes the live agent into another preset's plane WITHOUT a second
 * `agent/created`, so the grant adopts — or drops — it by ownership), on
 * `canvas/binding-changed` for that session, and on `canvas/genre-changed`
 * for every tracked agent (a canvas whose genre was cleared unbinds its
 * sessions, but a re-check is cheap and the order of those two events is the
 * canvas's business).
 *
 * The pointer is synchronous by contract, so it reads only the in-memory
 * title the grant evaluation caches; every unreadable path (no agent on the
 * assemble context, no sessionId, no binding) degrades to ''.
 *
 * @module @khorsheed/dsh-canvas-novel/agent
 */
import type { Context } from '@deepseek-ai/cordis'
import { scopeChainOf, scopeOf } from '@deepseek-ai/dsh-scope'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { NovelService } from './store.ts'
import { NOVEL_SKILL_CONTENT, NOVEL_SKILL_DESCRIPTION, NOVEL_SKILL_NAME } from './skill.ts'
import { NOVEL_BIND_TOOL, novelBindDefinition, novelToolDefinitions } from './tools.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'canvas-novel-agent'

/**
 * No hard injects: `canvasNovel` belongs to this package's core row and is
 * PROBED at apply time (a preset or profile that mounts this entry without
 * the core still loads — the tools simply stay absent), and the registries
 * join through deferred injection so mount order can never strand the row.
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

/** An agent as the grant sees it: its session and its own scope's context. */
export interface NovelAgent {
  readonly session: { readonly id: unknown }
  readonly ctx: Context
}

/** The tool registry as an agent's scope sees it (registrations land in that scope's layer). */
interface ToolsSlice {
  register(definition: ToolDefinition): () => void
}

/** The slice of `ctx.agents` the grant seeds from. */
interface AgentsSlice {
  list(): Iterable<NovelAgent>
  get(id: string): NovelAgent | undefined
}

/** The lifecycle and canvas events the grant listens to (cordis `on`, typed loosely). */
type Listen = (name: string, listener: (...args: never[]) => unknown) => () => void

/**
 * The pointer section's placement: after the deliverable-file references
 * (9000) and before structured output (9900) — a guidance line, not a tool
 * contract.
 */
export const NOVEL_POINTER_ORDER = 9500

/**
 * The per-session grant: which agents hold the novel tools, and the bound
 * canvas title each one's pointer names.
 */
export class NovelToolGrant {
  private readonly agents = new Map<string, { agent: NovelAgent; generation: number; disposers: Array<() => void> }>()
  private readonly titles = new Map<string, string>()

  /**
   * @param store - the engine; its `boundWork` is the whole criterion.
   * @param definitions - the tool definitions, built once and shared by every agent.
   */
  constructor(private readonly store: NovelService, private readonly definitions: readonly ToolDefinition[]) {}

  /** Whether a session's agent was composed under this grant's scope. */
  tracks(sessionId: string): boolean {
    return this.agents.has(sessionId)
  }

  /** The bound canvas title of a granted session (the pointer's input). */
  titleOf(sessionId: string): string | undefined {
    return this.titles.get(sessionId)
  }

  /** Track an agent and grant it the tools if its session is bound to a novel canvas. */
  async track(agent: NovelAgent): Promise<void> {
    const sessionId = String(agent.session.id)
    if (!this.agents.has(sessionId)) this.agents.set(sessionId, { agent, generation: 0, disposers: [] })
    await this.evaluate(sessionId)
  }

  /** Forget an agent (its scope is going away, and its registrations with it). */
  forget(agent: NovelAgent): void {
    const sessionId = String(agent.session.id)
    const entry = this.agents.get(sessionId)
    if (entry?.agent !== agent) return
    this.revoke(sessionId)
    this.agents.delete(sessionId)
  }

  /** Re-check one session (a binding moved); untracked sessions are not this scope's. */
  async evaluate(sessionId: string): Promise<void> {
    const entry = this.agents.get(sessionId)
    if (entry === undefined) return
    const generation = ++entry.generation
    let work: Awaited<ReturnType<NovelService['boundWork']>>
    try {
      work = await this.store.boundWork(sessionId)
    } catch {
      work = undefined
    }
    // A later evaluation (or a forget) superseded this one while it read.
    if (this.agents.get(sessionId) !== entry || entry.generation !== generation) return
    if (work === undefined) {
      this.revoke(sessionId)
      return
    }
    this.titles.set(sessionId, work.title)
    if (entry.disposers.length > 0) return
    // `get`, not the property: the agent's fiber, not this entry's, owns the inject.
    const tools = entry.agent.ctx.get('tools') as ToolsSlice | undefined
    if (tools === undefined) return
    for (const definition of this.definitions) entry.disposers.push(tools.register(definition))
  }

  /** Re-check every tracked session (a canvas's genre moved). */
  async evaluateAll(): Promise<void> {
    await Promise.all([...this.agents.keys()].map(sessionId => this.evaluate(sessionId)))
  }

  /** Drop every registration (the entry is being disposed). */
  dispose(): void {
    for (const sessionId of this.agents.keys()) this.revoke(sessionId)
    this.agents.clear()
  }

  private revoke(sessionId: string): void {
    this.titles.delete(sessionId)
    const entry = this.agents.get(sessionId)
    if (entry === undefined) return
    for (const dispose of entry.disposers.splice(0).reverse()) dispose()
  }
}

/**
 * The pointer's text, evaluated per assembly. One line in a bound session
 * (ideation chats route to the skill's stage-and-role model, drafting starts
 * from novel_read(brief)); in an unbound session of this scope, one line
 * saying how to bind (the model binds by the conversation's subject,
 * 2026-10-05); '' elsewhere — the full brief never auto-injects, and the
 * `novel` skill carries the workflow.
 * @param grant - the per-session grant whose cached state is the whole input.
 * @returns the section text for this assembly.
 */
export function novelPointerText(grant: Pick<NovelToolGrant, 'titleOf' | 'tracks'>): (context: { agent?: { sessionId?: string } }) => string {
  return (context) => {
    try {
      const sessionId = context.agent?.sessionId
      if (sessionId === undefined || sessionId === '') return ''
      const title = grant.titleOf(sessionId)
      if (title === undefined) {
        return grant.tracks(sessionId)
          ? `本会话还没绑定长篇小说作品：对话涉及某部作品（立意/写作/设定/章节）时，先 ${NOVEL_BIND_TOOL} 绑定——不带参数列出作品，拿不准是哪部就问用户。`
          : ''
      }
      return `本会话绑定长篇小说画布《${title}》：涉及立意/写作/续写/设定/章节时按 novel skill 的工作流走（构思期做主线梳理，动笔前先 novel_read(brief)）。`
    } catch {
      // Degrade, never explode: a prompt assembly must not fail on a pointer.
      return ''
    }
  }
}

/**
 * Whether an agent was composed under the scope `ctx` belongs to (an
 * unscoped mount owns every agent). The seed needs this; the lifecycle
 * events are already scope-filtered by the host.
 */
function ownsAgent(ctx: Context, agent: NovelAgent): boolean {
  const own = scopeOf(ctx)
  return own === undefined || scopeChainOf(scopeOf(agent.ctx)).includes(own)
}

/**
 * Composition entry body: the per-session tool grant, the pointer section
 * and the `novel` skill, or nothing when the core service is absent.
 * @param ctx - the mounting scope's context (profile root or a preset's plane).
 */
export function apply(ctx: Context): void {
  const store = ctx.get('canvasNovel') as NovelService | undefined
  if (store === undefined) {
    // Degrade, don't explode: the core row is not mounted here, so there is
    // nothing to delegate to. The composition still loads.
    ctx.logger.warn('canvas-novel-agent: the canvasNovel service is absent — the novel tools are not registered')
    return
  }
  const grant = new NovelToolGrant(store, novelToolDefinitions(store))
  ctx.effect(() => () => { grant.dispose() }, 'canvas-novel-agent: per-session novel tools')
  const listen = ctx.on.bind(ctx) as unknown as Listen
  listen('agent/created', async ({ agent }: { agent: NovelAgent }) => { await grant.track(agent) })
  listen('agent/disposed', ({ agent }: { agent: NovelAgent }) => { grant.forget(agent) })
  // A preset switch moves a live agent between planes and announces only this
  // (unscoped) event: adopt the agent if it now composes under this scope,
  // drop it if it left (its own scope must not keep this plane's tools).
  listen('agent-preset/selected', (sessionId: string) => {
    const agent = (ctx.get('agents') as AgentsSlice | undefined)?.get(sessionId)
    if (agent === undefined) return
    if (ownsAgent(ctx, agent)) void grant.track(agent)
    else grant.forget(agent)
  })
  listen('canvas/binding-changed', (sessionId: string) => { void grant.evaluate(sessionId) })
  listen('canvas/genre-changed', () => { void grant.evaluateAll() })
  // The agents already live when this entry mounts (a reload, a late grant).
  ctx.inject(['agents'], (agentsCtx) => {
    const agents = agentsCtx.get('agents') as AgentsSlice | undefined
    for (const agent of agents?.list() ?? []) {
      if (ownsAgent(ctx, agent)) void grant.track(agent)
    }
  })
  // novel_bind lives on the mounting scope, not per session: it is how an
  // unbound session gets bound. Deferred, for the canvas ./agent's reason.
  ctx.inject(['tools'], (toolsCtx) => {
    const tools = toolsCtx.get('tools') as ToolsSlice | undefined
    if (tools === undefined) return
    const definition = novelBindDefinition(store, async (agent) => { await grant.track(agent) })
    toolsCtx.effect(() => tools.register(definition), `canvas-novel-agent: ${NOVEL_BIND_TOOL} tool`)
  })
  ctx.inject(['systemPrompt'], (promptCtx) => {
    const sections = promptCtx.get('systemPrompt') as PromptSections | undefined
    sections?.section({
      name: 'novel:pointer',
      order: NOVEL_POINTER_ORDER,
      text: novelPointerText(grant),
    })
  })
  ctx.inject(['skills'], (skillCtx) => {
    const skills = skillCtx.get('skills') as SkillRegistrySlice | undefined
    if (skills === undefined) return
    skillCtx.effect(() => skills.register({
      name: NOVEL_SKILL_NAME,
      description: NOVEL_SKILL_DESCRIPTION,
      content: NOVEL_SKILL_CONTENT,
      source: 'runtime',
      provider: '@khorsheed/dsh-canvas-novel',
    }), `canvas-novel-agent: ${NOVEL_SKILL_NAME} skill`)
  })
}
