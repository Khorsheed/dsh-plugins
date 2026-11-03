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
 *
 * A member in a room also carries its DESK on the stand-in: the
 * `Symbol.for('dsh.agent.desk')`-keyed `{ session, role, member }`, where
 * `session` is the room session. A plugin whose sidebar follows what the agent
 * opens (the canvas a session has open) reads it to land that on the room —
 * the coordinator acting on the room's sidebar, a member opening beside it —
 * while everything else (execution identity, approvals, the recorded mode,
 * plugin state) stays on the member's own session. Refreshed on every list and
 * call, so a coordinator handoff moves the role with it; absent outside rooms.
 *
 * A stand-in is not an agent, so `agent/created` never names it. Entries that
 * grant tools per agent (the novel tools, which appear only for bound
 * sessions) hear `local-agent/stand-in-created` / `-disposed` instead —
 * scoped like `agent/created`, so a preset plane's listener sees only the
 * stand-ins composed under it.
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
import { createScope, scopeTarget } from '@deepseek-ai/dsh-scope'
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
/** The desk mark's key on a stand-in (see the module comment). */
export const DESK = Symbol.for('dsh.agent.desk')

/** What the room says about a member's desk (local-agent's MemberDesk). */
export interface DeskInfo {
  readonly sessionId: string
  readonly role: 'coordinator' | 'member'
  readonly member: string
  /** The member's run in progress: a desk event naming it renders in that run's card. */
  readonly runId?: string
}

interface SessionLike {
  readonly id: string
  readonly header: { readonly agentPreset?: string | null }
  snapshotEvents(): readonly { readonly type: string; readonly data?: unknown }[]
  append(type: 'agent-preset/selected', data: { agentPreset: string }): unknown
}
/** The model-less stand-in a member's mode tools run as. */
interface AgentLike {
  readonly id: string
  readonly session: SessionLike
  ctx?: Context
  [DESK]?: { readonly session: SessionLike; readonly role: 'coordinator' | 'member'; readonly member: string; readonly runId?: string }
}
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
/** One member's stand-in: its preset, the scoped agent, and the wait for a fresh mount's tools to settle. */
interface HostEntry {
  readonly preset: string
  readonly agent: Promise<{ readonly agent: AgentLike; dispose(): Promise<void> }>
  /** Set by the first reader after the mount; every later reader shares it. */
  settled?: Promise<void>
}

export class PresetToolHost {
  private readonly hosts = new Map<string, HostEntry>()
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
      const carrier = scopeTarget(member, member)
      const serial = this.ctx.serial.bind(this.ctx) as unknown as (target: object, name: string, payload: { agent: AgentLike }) => Promise<unknown>
      try {
        await serial(carrier, 'local-agent/stand-in-created', { agent: member })
      } catch (error) {
        this.ctx.logger.warn(`localAgent: a stand-in listener failed for ${childSessionId}: ${String(error)}`)
      }
      return {
        agent: member,
        dispose: async () => {
          try { await serial(carrier, 'local-agent/stand-in-disposed', { agent: member }) } catch { /* the scope goes regardless */ }
          await scope.dispose()
        },
      }
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
   * @param desk - the member's desk in its room, when the room names one.
   * @returns the tools, empty when the host lacks the capabilities.
   */
  async list(childSessionId: string, preset: string, cwd?: string, desk?: DeskInfo): Promise<BridgedTool[]> {
    const tools = this.probe<ToolsLike>('tools')
    const agent = await this.agentFor(childSessionId, preset, cwd)
    if (tools === undefined || agent === undefined) {
      this.note({ childSessionId, preset, tools: tools !== undefined, agent: agent !== undefined })
      return []
    }
    this.markDesk(agent, desk)
    const schemas = await this.settledSchemas(childSessionId, agent, tools)
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
   * The names of the preset's plugin tools for a member, as a list would
   * give them: the edit dialog's "what the mode has". Writes no diagnostics
   * line. Waits for a freshly mounted preset to settle exactly as a list
   * does (after a host restart the first read mounts the scope, and its
   * deferred registrations would otherwise read as 0).
   * @param childSessionId - the member's child session.
   * @param preset - the member's mode.
   * @param cwd - the member's working directory.
   * @returns the names, or undefined when the host lacks the capabilities or the member's session is not live.
   */
  async names(childSessionId: string, preset: string, cwd?: string): Promise<string[] | undefined> {
    const tools = this.probe<ToolsLike>('tools')
    if (tools === undefined) return undefined
    const agent = await this.agentFor(childSessionId, preset, cwd)
    if (agent === undefined) return undefined
    return (await this.settledSchemas(childSessionId, agent, tools)).filter(schema => isPluginTool(tools.get(schema.name, agent))).map(schema => schema.name)
  }

  /**
   * The stand-in's scoped tool schemas once its preset finished registering.
   * A preset mounted for the first time registers some rows' tools a moment
   * later (deferred injects): the first reader after a mount waits until the
   * scope stops growing, and every concurrent or later reader (a list, the
   * dialog's names) shares that one wait.
   */
  private async settledSchemas(childSessionId: string, agent: AgentLike, tools: ToolsLike): Promise<ReturnType<ToolsLike['schemas']>> {
    const entry = this.hosts.get(childSessionId)
    if (entry !== undefined && (await entry.agent).agent === agent) {
      entry.settled ??= (async () => {
        let count = tools.schemas(agent).length
        for (let waited = 0; waited < SETTLE_MS; waited += SETTLE_STEP_MS) {
          await new Promise(resolve => setTimeout(resolve, SETTLE_STEP_MS))
          const next = tools.schemas(agent).length
          if (next === count && waited >= SETTLE_STEP_MS * 3) break
          count = next
        }
      })()
      await entry.settled
    }
    return tools.schemas(agent)
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
   * @param desk - the member's desk in its room, when the room names one.
   * @returns the MCP result.
   */
  async call(childSessionId: string, preset: string, name: string, args: unknown, signal: AbortSignal, cwd?: string, desk?: DeskInfo): Promise<BridgedToolResult> {
    const tools = this.probe<ToolsLike>('tools')
    const agent = await this.agentFor(childSessionId, preset, cwd)
    if (tools === undefined || agent === undefined) return { content: [{ type: 'text', text: 'Mode tools are unavailable on this host' }], isError: true }
    this.markDesk(agent, desk)
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

  /**
   * Put the member's desk on its stand-in, or take it off: the room session
   * must be live here, else the plugins simply see no desk.
   */
  private markDesk(agent: AgentLike, desk: DeskInfo | undefined): void {
    const session = desk === undefined || desk.sessionId === agent.session.id ? undefined : this.probe<SessionsLike>('sessions')?.get(SessionId(desk.sessionId))
    if (desk === undefined || session === undefined) delete agent[DESK]
    else agent[DESK] = { session, role: desk.role, member: desk.member, ...desk.runId === undefined ? {} : { runId: desk.runId } }
  }

  /** Dispose every preset agent. */
  async dispose(): Promise<void> {
    const hosts = [...this.hosts.values()]
    this.hosts.clear()
    await Promise.all(hosts.map(host => host.agent.then(handle => handle.dispose()).catch(() => {})))
  }
}
