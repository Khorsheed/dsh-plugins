/**
 * Preset tool host: lets an external CLI member use the plugin tools of a
 * host agent preset (a mode), through its member bridge, ON THE MEMBER'S OWN
 * SESSION. The tool registry keys scoped tools by an agent identity, and
 * plugin tools read only `agent.id` and `agent.session` from it — so the
 * member gets a model-less stand-in: `{ id, session }` over its own child
 * session, given a scope (`createScope`) with the preset mounted. Calls run
 * through the registry's normal pipeline (policies, approvals, timeouts) as
 * that stand-in, so plugin state (a video project) belongs to the member's
 * session and the mode's panels show there; the session also records the mode
 * (`agent-preset/selected`), so per-session plugin visibility follows it.
 * Only PLUGIN tools are offered (`Symbol.for('dsh.tool.origin')` channel
 * `plugin`; the CLI brings its own shell, files and todo).
 *
 * Everything host-side is probed, never injected: without `sessions`,
 * `agentPresets` or `tools` the member simply gets no extra tools.
 * @module @khorsheed/dsh-local-agent/preset-tool-host
 */
import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import { SessionId } from '@deepseek-ai/dsh-session'

/** One plugin tool as the bridge lists it (MCP `tools/list` shape). */
export interface BridgedTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
}

/** One bridged call's outcome (MCP `tools/call` result shape). */
export interface BridgedToolResult {
  readonly content: readonly Record<string, unknown>[]
  readonly isError: boolean
}

/** Owners whose tools the bridge already serves itself (room), or that delegate from dsh (the local-agent family). */
const skippedOwner = (owner: string): boolean => owner === '@khorsheed/dsh-room' || owner.startsWith('@khorsheed/dsh-local-agent')

/** How long a freshly mounted preset may take to finish registering its tools, and how often to look. */
const SETTLE_MS = 3_000
const SETTLE_STEP_MS = 150

const ORIGIN = Symbol.for('dsh.tool.origin')

interface SessionLike {
  readonly id: string
  readonly header: { readonly agentPreset?: string | null }
  snapshotEvents(): readonly { readonly type: string; readonly data?: unknown }[]
  append(type: 'agent-preset/selected', data: { agentPreset: string }): unknown
}
/** The model-less stand-in a member's mode tools run as. */
interface AgentLike { readonly id: string; readonly session: SessionLike; ctx?: Context }
interface ToolsLike {
  schemas(scope?: object): readonly { readonly name: string; readonly description?: string; readonly parameters?: unknown }[]
  get(name: string, scope?: object): object | undefined
  execute(exec: { callId: never; name: string; arguments: unknown; agent: AgentLike; signal: AbortSignal }): Promise<{ readonly isError: boolean; readonly content: readonly { readonly type: string; readonly text?: string; readonly data?: string; readonly mediaType?: string; readonly mimeType?: string }[] }>
}
interface PresetsLike {
  resolve(id?: string): Promise<{ readonly id: string }>
  mount(ctx: Context, id?: string): Promise<unknown>
}
interface SkillsLike {
  list(options?: { scope?: object }): Promise<readonly { readonly name: string; readonly description: string }[]>
  get(name: string, options?: { scope?: object }): Promise<{ readonly name: string; readonly description: string; readonly content: string } | undefined>
}

/** One skill the mode itself contributes (absent from the global view). */
export interface ModeSkill {
  readonly name: string
  readonly description: string
  readonly content: string
}

interface SessionsLike {
  get(id: ReturnType<typeof SessionId>): SessionLike | undefined
}

/** The mode a session records: its header, overridden by the latest selection. */
function sessionPreset(session: SessionLike): string | undefined {
  let preset = session.header.agentPreset ?? undefined
  for (const event of session.snapshotEvents()) {
    if (event.type === 'agent-preset/selected') preset = (event.data as { agentPreset?: string } | undefined)?.agentPreset ?? preset
  }
  return preset
}

/** Whether a definition is a plugin tool the bridge may forward. */
function isPluginTool(definition: object | undefined): boolean {
  const origin = (definition as { [ORIGIN]?: { channel?: unknown; owner?: unknown } } | undefined)?.[ORIGIN]
  return origin?.channel === 'plugin' && !skippedOwner(String(origin.owner))
}

/** Map registry content blocks to MCP content (text and images; anything else as text). */
function mcpContent(blocks: readonly { readonly type: string; readonly text?: string; readonly data?: string; readonly mediaType?: string; readonly mimeType?: string }[]): Record<string, unknown>[] {
  return blocks.map((block) => {
    if (block.type === 'text') return { type: 'text', text: block.text ?? '' }
    if (block.type === 'image' && typeof block.data === 'string') return { type: 'image', data: block.data, mimeType: block.mediaType ?? block.mimeType ?? 'image/png' }
    return { type: 'text', text: JSON.stringify(block) }
  })
}

/** The per-member preset agents and the list/call operations the bridge forwards. */
export class PresetToolHost {
  private readonly hosts = new Map<string, { readonly preset: string; readonly agent: Promise<{ readonly agent: AgentLike; dispose(): Promise<void> }> }>()
  /** Stand-in → the member's child session, for routing approvals its calls raise. */
  private readonly standIns = new WeakMap<object, string>()

  /** The member a stand-in agent acts for, if it is one of ours. */
  memberOf(agent: unknown): string | undefined {
    return typeof agent === 'object' && agent !== null ? this.standIns.get(agent) : undefined
  }

  /**
   * @param ctx - the local-agent plugin context.
   * @param diagnostics - optional JSONL file each listing appends a summary to
   *   (what the preset agent's scope saw and which tools passed the filter).
   */
  constructor(private readonly ctx: Context, private readonly diagnostics?: string) {}

  /** Append one diagnostics line (best-effort). */
  note(entry: Record<string, unknown>): void {
    if (this.diagnostics === undefined) return
    try { appendFileSync(this.diagnostics, `${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`) } catch { /* diagnostics never fail a call */ }
  }

  private probe<T>(name: string): T | undefined {
    return (this.ctx.get as (key: string) => unknown).call(this.ctx, name) as T | undefined
  }

  /** The member's stand-in, scoped with its preset on first use (and re-scoped when the preset changed). */
  private async agentFor(childSessionId: string, preset: string, _cwd: string | undefined): Promise<AgentLike | undefined> {
    const sessions = this.probe<SessionsLike>('sessions')
    const presets = this.probe<PresetsLike>('agentPresets')
    const session = sessions?.get(SessionId(childSessionId))
    if (presets?.mount === undefined || session === undefined) return undefined
    const current = this.hosts.get(childSessionId)
    if (current !== undefined && current.preset === preset && (await current.agent).agent.session === session) return (await current.agent).agent
    if (current !== undefined) {
      this.hosts.delete(childSessionId)
      void current.agent.then(handle => handle.dispose()).catch(() => {})
    }
    const agent = (async () => {
      const resolved = await presets.resolve(preset)
      const member: AgentLike = { id: childSessionId, session }
      this.standIns.set(member, childSessionId)
      const scope = createScope(this.ctx, member)
      member.ctx = scope.ctx
      try {
        await presets.mount(scope.ctx, resolved.id)
      } catch (error) {
        await scope.dispose()
        throw error
      }
      // The member's session runs this mode now: the host's per-session
      // plugin visibility reads it from here.
      if (sessionPreset(session) !== resolved.id) session.append('agent-preset/selected', { agentPreset: resolved.id })
      return { agent: member, dispose: () => scope.dispose() }
    })()
    this.hosts.set(childSessionId, { preset, agent })
    try {
      return (await agent).agent
    } catch (error) {
      this.hosts.delete(childSessionId)
      throw error
    }
  }

  /**
   * The preset's plugin tools, for a member's `tools/list`.
   * @param childSessionId - the member's child session.
   * @param preset - the member's mode.
   * @param cwd - the member's working directory.
   * @returns the tools, empty when the host lacks the capabilities.
   */
  async list(childSessionId: string, preset: string, cwd?: string): Promise<BridgedTool[]> {
    const tools = this.probe<ToolsLike>('tools')
    const fresh = this.hosts.get(childSessionId)?.preset !== preset
    const agent = await this.agentFor(childSessionId, preset, cwd)
    if (tools === undefined || agent === undefined) {
      this.note({ childSessionId, preset, tools: tools !== undefined, agent: agent !== undefined })
      return []
    }
    // A preset mounted for the first time registers some rows' tools a
    // moment later (deferred injects): wait until the scope stops growing.
    let schemas = tools.schemas(agent)
    if (fresh) {
      for (let waited = 0; waited < SETTLE_MS; waited += SETTLE_STEP_MS) {
        await new Promise(resolve => setTimeout(resolve, SETTLE_STEP_MS))
        const next = tools.schemas(agent)
        if (next.length === schemas.length && waited >= SETTLE_STEP_MS * 3) break
        schemas = next
      }
    }
    const listed = schemas.filter(schema => isPluginTool(tools.get(schema.name, agent)))
    this.note({ childSessionId, preset, agent: agent.id, scope: schemas.map(schema => {
      const origin = (tools.get(schema.name, agent) as { [ORIGIN]?: { channel?: unknown; owner?: unknown } } | undefined)?.[ORIGIN]
      return origin === undefined ? schema.name : `${schema.name}<${String(origin.channel)}:${String(origin.owner)}>`
    }), listed: listed.map(schema => schema.name) })
    return listed
      .map(schema => ({
        name: schema.name,
        description: schema.description ?? '',
        inputSchema: (schema.parameters ?? { type: 'object', properties: {} }) as Record<string, unknown>,
      }))
  }

  /**
   * Run one plugin tool for a member through the registry's execution
   * pipeline (policies, approvals, timeouts), as the member's preset agent.
   * @param childSessionId - the member's child session.
   * @param preset - the member's mode.
   * @param name - the tool name.
   * @param args - the tool arguments.
   * @param signal - cancellation.
   * @param cwd - the member's working directory.
   * @returns the MCP result.
   */
  async call(childSessionId: string, preset: string, name: string, args: unknown, signal: AbortSignal, cwd?: string): Promise<BridgedToolResult> {
    const tools = this.probe<ToolsLike>('tools')
    const agent = await this.agentFor(childSessionId, preset, cwd)
    if (tools === undefined || agent === undefined) return { content: [{ type: 'text', text: 'Mode tools are unavailable on this host' }], isError: true }
    if (!isPluginTool(tools.get(name, agent))) return { content: [{ type: 'text', text: `Unknown tool ${name} in mode ${preset}` }], isError: true }
    const result = await tools.execute({ callId: `bridge-${randomUUID()}` as never, name, arguments: args, agent, signal })
    return { content: mcpContent(result.content), isError: result.isError }
  }

  /**
   * The skills the member's mode contributes: visible in its scope, absent
   * from the global view (installed skills every CLI already sees stay out).
   * @param childSessionId - the member's child session.
   * @param preset - the member's mode.
   * @returns the mode's skills with their content; empty without a skill registry.
   */
  async skills(childSessionId: string, preset: string): Promise<ModeSkill[]> {
    const registry = this.probe<SkillsLike>('skills')
    const agent = await this.agentFor(childSessionId, preset, undefined)
    if (registry?.list === undefined || agent === undefined) return []
    const global = new Set((await registry.list()).map(skill => skill.name))
    const own = (await registry.list({ scope: agent })).filter(skill => !global.has(skill.name))
    const loaded = await Promise.all(own.map(skill => registry.get(skill.name, { scope: agent })))
    return loaded.flatMap(skill => skill === undefined ? [] : [{ name: skill.name, description: skill.description, content: skill.content }])
  }

  /** Dispose every preset agent. */
  async dispose(): Promise<void> {
    const hosts = [...this.hosts.values()]
    this.hosts.clear()
    await Promise.all(hosts.map(host => host.agent.then(handle => handle.dispose()).catch(() => {})))
  }
}
