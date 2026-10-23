/**
 * Preset tool host: lets an external CLI member use the plugin tools of a
 * host agent preset (a mode), through its member bridge. For each member with
 * a mode, the host keeps one dsh agent composed with that preset that never
 * runs a model turn — it exists so the preset's plugin tools have their scope
 * (the tool registry keys scoped tools by agent) and an executing identity.
 * The bridge lists the preset's PLUGIN tools (those tagged with
 * `Symbol.for('dsh.tool.origin')` channel `plugin`; the CLI brings its own
 * shell, files and todo) and forwards calls to the registry's normal
 * execution pipeline, policies and approvals included.
 *
 * Everything host-side is probed, never injected: without `agents`,
 * `agentPresets` or `tools` the member simply gets no extra tools.
 * @module @khorsheed/dsh-local-agent/preset-tool-host
 */
import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
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

/** Owners whose tools the bridge already serves itself, or that only make sense inside dsh. */
const SKIPPED_OWNERS = new Set(['@khorsheed/dsh-room', '@khorsheed/dsh-local-agent'])

const ORIGIN = Symbol.for('dsh.tool.origin')

interface AgentLike { readonly id: string }
interface ToolsLike {
  schemas(scope?: object): readonly { readonly name: string; readonly description?: string; readonly parameters?: unknown }[]
  get(name: string, scope?: object): object | undefined
  execute(exec: { callId: never; name: string; arguments: unknown; agent: AgentLike; signal: AbortSignal }): Promise<{ readonly isError: boolean; readonly content: readonly { readonly type: string; readonly text?: string; readonly data?: string; readonly mediaType?: string; readonly mimeType?: string }[] }>
}
interface PresetsLike {
  resolve(id?: string): Promise<{ readonly id: string }>
  mount(ctx: Context, id?: string): Promise<unknown>
}
interface AgentsLike {
  create(options: Record<string, unknown>): Promise<{ readonly agent: AgentLike; dispose(): Promise<void> }>
}

/** Whether a definition is a plugin tool the bridge may forward. */
function isPluginTool(definition: object | undefined): boolean {
  const origin = (definition as { [ORIGIN]?: { channel?: unknown; owner?: unknown } } | undefined)?.[ORIGIN]
  return origin?.channel === 'plugin' && !SKIPPED_OWNERS.has(String(origin.owner))
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

  /**
   * @param ctx - the local-agent plugin context.
   * @param diagnostics - optional JSONL file each listing appends a summary to
   *   (what the preset agent's scope saw and which tools passed the filter).
   */
  constructor(private readonly ctx: Context, private readonly diagnostics?: string) {}

  private note(entry: Record<string, unknown>): void {
    if (this.diagnostics === undefined) return
    try { appendFileSync(this.diagnostics, `${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`) } catch { /* diagnostics never fail a call */ }
  }

  private probe<T>(name: string): T | undefined {
    return (this.ctx.get as (key: string) => unknown).call(this.ctx, name) as T | undefined
  }

  /** The member's preset agent, created on first use (and recreated when its preset changed). */
  private async agentFor(childSessionId: string, preset: string, cwd: string | undefined): Promise<AgentLike | undefined> {
    const agents = this.probe<AgentsLike>('agents')
    const presets = this.probe<PresetsLike>('agentPresets')
    if (agents?.create === undefined || presets?.mount === undefined) return undefined
    const current = this.hosts.get(childSessionId)
    if (current !== undefined && current.preset === preset) return (await current.agent).agent
    if (current !== undefined) {
      this.hosts.delete(childSessionId)
      void current.agent.then(handle => handle.dispose()).catch(() => {})
    }
    const resolved = await presets.resolve(preset)
    const agent = agents.create({
      sessionId: SessionId(randomUUID()),
      meta: { origin: 'subagent', agentPreset: resolved.id, ...cwd === undefined ? {} : { cwd } },
      setup: async (agentCtx: Context) => { await presets.mount(agentCtx, resolved.id) },
    })
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
    const agent = await this.agentFor(childSessionId, preset, cwd)
    if (tools === undefined || agent === undefined) {
      this.note({ childSessionId, preset, tools: tools !== undefined, agent: agent !== undefined })
      return []
    }
    const schemas = tools.schemas(agent)
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

  /** Dispose every preset agent. */
  async dispose(): Promise<void> {
    const hosts = [...this.hosts.values()]
    this.hosts.clear()
    await Promise.all(hosts.map(host => host.agent.then(handle => handle.dispose()).catch(() => {})))
  }
}
