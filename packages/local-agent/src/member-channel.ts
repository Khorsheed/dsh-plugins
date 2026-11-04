/**
 * Member channel, host side: the loopback listener the bridge MCP servers call
 * back on, and the member-to-member delivery chain. One newline-delimited JSON
 * request per line (`{ token, to, text }`), one response line
 * (`{ ok: true, receipt } | { ok: false, error }`).
 *
 * Delivery chain for one `member_message` call:
 *
 * 1. token → the registered in-flight run (sender A's identity; never
 *    self-reported). The per-run token is the SOLE credential (host 0.1.5
 *    removed the child pid the parentage cross-check used): minted at run
 *    start, delivered through the CLI's scoped MCP config (0700 scoped home),
 *    invalidated the moment the run settles. The residual exposure — a
 *    same-host same-user sibling CLI replaying a token it read — is
 *    documented in the package README and tracked by the auth-hardening
 *    proposal;
 * 2. resolve B (`to` = a member's dsh child session id; member NAMES resolve
 *    only through a claiming room's roster);
 * 3. same-parent check: B's delegation must share A's parent session;
 * 4. gate handoff: probe `ctx.get('room')` for the duck-typed
 *    {@link RoomMemberMessageGate} (NO import of any room package — room
 *    absent or declining is invisible); a claiming room owns the dispatch and
 *    its receipt passes back verbatim;
 * 5. room absent/declining → family direct-send: B's resume lock busy →
 *    `busy`; else the facade `resume` with a provenance-tagged prompt.
 * @module @khorsheed/dsh-local-agent/member-channel
 */

import { createServer, type Server, type Socket } from 'node:net'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { LocalAgentRegistry } from './index.ts'
import type { BridgedTool, BridgedToolResult, PresetToolHost } from './preset-tool-host.ts'
import { harnessSkillsDir, installModeSkills } from './mode-skills.ts'
import { MemberToolsTracker } from './member-tools.ts'
import type {
  LocalAgentDelegationView,
  LocalAgentMemberRun,
  LocalAgentMemberToolsStatus,
  MemberRoomCommand,
  LocalAgentMemberMessage,
  MemberMessageOutcome,
  RoomMemberMessageGate,
} from './types.ts'

/** One bridge callback on the wire. */
export interface MemberBridgeRequest {
  /** The per-run token injected into the bridge's environment (the sole credential). */
  token: string
  /** The raw `to` argument: a member child session id, or a room-roster name. */
  to: string
  /** The notification text. */
  text: string
  /** `task` (default) or `notify`; passed to a claiming room. */
  kind?: 'task' | 'notify'
  /** The message id this one answers (e.g. `m12`); passed to a claiming room. */
  inReplyTo?: string
  /** What the sender waits for before acting on the result; passed to a claiming room. */
  note?: string
  /** `new` or a task number; passed to a claiming room. */
  task?: string
}

export interface MemberCommandBridgeRequest {
  token: string
  command: MemberRoomCommand
}

/**
 * The bridge asking for (`list`), calling (`call`) or reporting on (`report`)
 * the member's mode tools. `probe` marks a background recovery fetch: the CLI
 * still holds the placeholder, so it is not a served list. Bridges from before
 * the report existed send only `list` and `call`.
 */
export interface MemberModeToolsBridgeRequest {
  token: string
  modeTools:
    | { readonly list: true; readonly probe?: boolean }
    | { readonly call: { readonly name: string; readonly arguments?: unknown } }
    | { readonly report: { readonly served: 'placeholder'; readonly reason?: string } }
}

/** A mode-tools answer: the list, one call's MCP result, or a report's receipt. */
export type MemberModeToolsOutcome =
  | { readonly ok: true; readonly tools: readonly BridgedTool[] }
  | { readonly ok: true; readonly result: BridgedToolResult }
  | { readonly ok: true; readonly recorded: true }
  | { readonly ok: false; readonly error: string }

/**
 * What one member process (one bridge token) was last served as its mode-tool
 * list: the host's own answer (`complete`, with how many mode tools), or the
 * bridge's placeholder (it could not ask).
 */
export type ServedModeTools =
  | { readonly served: 'complete'; readonly count: number; readonly names?: readonly string[]; readonly at: number }
  | { readonly served: 'placeholder'; readonly reason: string; readonly at: number }

/** How long one bridged mode-tool call may run before it is cancelled. */
const MODE_TOOL_TIMEOUT_MS = 30 * 60_000

/**
 * The member-channel host: owns the loopback unix-socket listener and the
 * delivery chain. Mounted by the plugin's `apply` and disposed with its fiber.
 */
export class MemberChannel {
  private server: Server | undefined
  /** Per bridge token: what that member process was last served (see {@link ServedModeTools}). */
  private readonly served = new Map<string, ServedModeTools>()
  /** Per member: reloads and what the room was told (the edit dialog's 模式工具 line). */
  private readonly tools = new MemberToolsTracker()

  constructor(
    private readonly ctx: Context,
    private readonly registry: LocalAgentRegistry,
    private readonly socketPath: string,
    private readonly modeTools?: PresetToolHost,
  ) {
    // The live drivers ask the registry before each round; the answer lives here.
    if (typeof registry.setMemberToolsCheck === 'function') registry.setMemberToolsCheck(token => this.staleModeTools(token))
    if (typeof registry.setMemberToolsFace === 'function') {
      registry.setMemberToolsFace({
        status: childSessionId => this.memberToolsStatus(childSessionId),
        autoReloaded: (childSessionId, oldToken) => { this.autoReloaded(childSessionId, oldToken) },
        reloadPending: childSessionId => this.tools.reloadPending(childSessionId),
        reloadAccepted: (childSessionId, when) => { this.tools.reloadAccepted(childSessionId, when) },
        reloadStarted: (childSessionId) => { this.tools.reloadStarted(childSessionId) },
        reloadDone: (childSessionId, outcome, oldToken, error) => { this.reloadDone(childSessionId, outcome, oldToken, error) },
        seated: async (childSessionId) => {
          const binding = this.registry.memberBinding(childSessionId)
          if (binding === undefined) return false
          const run: LocalAgentMemberRun = { childSessionId, parentSessionId: binding.parentSessionId, provider: binding.provider }
          return await this.probeRoom()?.memberMode?.(run) !== undefined
        },
      })
    }
  }

  /** What the member process behind a token was last served, if it listed since spawn. */
  servedModeTools(token: string): ServedModeTools | undefined {
    return this.served.get(token)
  }

  /**
   * Record a served list, dropping entries whose run is gone (tokens die with
   * their process). A reloaded process that still could not get its tools is
   * told to the room.
   */
  private recordServed(token: string, state: ServedModeTools, probe = false): void {
    for (const known of [...this.served.keys()]) {
      if (this.registry.resolveMemberRun(known) === undefined) this.served.delete(known)
    }
    this.served.set(token, state)
    // A probe is the bridge recovering behind a placeholder already reported.
    if (probe) return
    const run = this.registry.resolveMemberRun(token)
    if (run === undefined) return
    const verdict = this.tools.served(run.childSessionId, token, state.served)
    if (verdict.unavailable !== undefined) void this.tellRoom(run, 'unavailable', verdict.unavailable.during)
  }

  /** One line in the member's room about its mode tools (best-effort; no room, no mode = nothing). */
  private async tellRoom(run: LocalAgentMemberRun, kind: 'reloaded' | 'unavailable', during: 'round' | 'idle'): Promise<void> {
    try {
      const room = this.probeRoom()
      if (room?.noteMemberTools === undefined) return
      const mode = await room.memberMode?.(run)
      if (mode === undefined) return
      await room.noteMemberTools({ childSessionId: run.childSessionId, parentSessionId: run.parentSessionId, provider: run.provider }, { kind, preset: mode.preset, during })
    } catch (error) {
      this.ctx.logger.warn(`localAgent: the room notice about ${run.childSessionId}'s mode tools failed: ${String(error)}`)
    }
  }

  /**
   * A requested reload (or start) ran. The fresh process usually lists while
   * it is being prepared, before this point: settle the reload on that list
   * now instead of waiting for one that already came.
   */
  private reloadDone(childSessionId: string, outcome: 'respawned' | 'no-process' | 'failed', oldToken: string | undefined, error?: string): void {
    this.tools.reloadDone(childSessionId, outcome, oldToken, error)
    if (outcome !== 'respawned' || typeof this.registry.currentMemberToken !== 'function') return
    const token = this.registry.currentMemberToken(childSessionId)
    const state = token === undefined || token === oldToken ? undefined : this.served.get(token)
    if (token === undefined || state === undefined) return
    const verdict = this.tools.served(childSessionId, token, state.served)
    const run = this.registry.resolveMemberRun(token)
    if (verdict.unavailable !== undefined && run !== undefined) void this.tellRoom(run, 'unavailable', verdict.unavailable.during)
  }

  /** A live driver replaced the member's process at round start (it lacked its tools): remember it and tell the room. */
  private autoReloaded(childSessionId: string, oldToken: string | undefined): void {
    this.tools.autoReloaded(childSessionId, oldToken)
    const binding = this.registry.memberBinding(childSessionId)
    if (binding === undefined) return
    void this.tellRoom({ childSessionId, parentSessionId: binding.parentSessionId, provider: binding.provider }, 'reloaded', 'round')
  }

  /**
   * The edit dialog's read: what the member's current process holds of its
   * mode tools, against what its mode has now. Null = no mode (or no room,
   * no tool host, an unknown member): the dialog shows no line.
   * @param childSessionId - the member's child session.
   * @returns the status, or null.
   */
  async memberToolsStatus(childSessionId: string): Promise<LocalAgentMemberToolsStatus | null> {
    const binding = this.registry.memberBinding(childSessionId)
    if (binding === undefined || this.modeTools === undefined) return null
    const run: LocalAgentMemberRun = { childSessionId, parentSessionId: binding.parentSessionId, provider: binding.provider }
    const mode = await this.probeRoom()?.memberMode?.(run)
    if (mode === undefined) return null
    const token = typeof this.registry.currentMemberToken === 'function' ? this.registry.currentMemberToken(childSessionId) : undefined
    const state = token === undefined ? undefined : this.served.get(token)
    const received = state?.served === 'complete' ? state.names ?? [] : []
    const listed = await this.modeTools.names(childSessionId, mode.preset, mode.cwd).catch(() => undefined)
    // What the mode has, when the host can tell; else what a full process
    // got. Neither = unknown (「—」 in the dialog, never 0).
    const expected = listed ?? (state?.served === 'complete' ? received : undefined)
    const process: LocalAgentMemberToolsStatus['process'] = token === undefined ? 'none'
      : state === undefined ? 'unreported'
        : state.served === 'placeholder' ? 'placeholder'
          : state.count === 0 && (expected?.length ?? 0) > 0 ? 'empty'
            : 'full'
    const harness = this.registry.harnessForProvider(binding.provider)
    const startable = token === undefined && typeof this.registry.canStartMemberProcess === 'function' && this.registry.canStartMemberProcess(childSessionId)
    return {
      preset: mode.preset,
      expected: expected ?? [],
      ...expected === undefined ? { expectedUnknown: true as const } : {},
      process,
      received,
      ...state === undefined ? {} : { loadedAt: state.at },
      ...this.tools.reloadState(childSessionId),
      reloadable: harness?.reloadMember !== undefined && token !== undefined,
      ...startable ? { startable } : {},
    }
  }

  /**
   * The round-start check: whether the member process behind a token must be
   * replaced before its next round because its CLI lacks the mode tools.
   * Undefined = keep it. A reason when
   * - the token no longer resolves (a live process nobody can authenticate);
   * - the process was last served the placeholder (the bridge could not ask);
   * - it was served an empty list but the member's mode has tools now (the
   *   room or the session was not ready when it listed).
   * A process that never listed (a bridge from before reports existed, or a
   * CLI that lists lazily at its first prompt) is kept: its list is either
   * coming now or unknowable, and replacing every such process would respawn
   * the whole room for nothing.
   * Called only between rounds (the drivers' serialized round start).
   * @param token - the member process's bridge token.
   * @returns why to respawn, or undefined.
   */
  async staleModeTools(token: string): Promise<string | undefined> {
    const run = this.registry.resolveMemberRun(token)
    if (run === undefined) return 'its member token is no longer registered'
    const state = this.served.get(token)
    if (state === undefined) return undefined
    let reason: string | undefined
    if (state.served === 'placeholder') reason = `it was served the mode-tools placeholder (${state.reason})`
    else if (state.count === 0 && this.modeTools !== undefined) {
      const mode = await this.probeRoom()?.memberMode?.(run)
      if (mode !== undefined) {
        const tools = await this.modeTools.list(run.childSessionId, mode.preset, mode.cwd, mode.desk).catch(() => [])
        if (tools.length > 0) reason = `it listed no mode tools, but mode ${mode.preset} has ${tools.length} now`
      }
    }
    if (reason !== undefined) this.modeTools?.note({ childSessionId: run.childSessionId, provider: run.provider, respawn: reason })
    return reason
  }

  /**
   * Start listening. A listener failure (e.g. a socket path beyond the
   * platform limit) degrades the whole member channel to absent — the run
   * itself is never at risk, so this warns instead of throwing.
   */
  async start(): Promise<void> {
    try {
      mkdirSync(dirname(this.socketPath), { recursive: true })
      // A stale socket from a crashed host is safe to replace: the path is
      // per-homes-root, and only this plugin instance binds it.
      rmSync(this.socketPath, { force: true })
      const server = createServer((socket) => { this.serve(socket) })
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(this.socketPath, () => { resolve() })
      })
      server.removeAllListeners('error')
      this.server = server
      this.registry.setMemberBridgeAvailable(true)
    } catch (error: unknown) {
      this.ctx.logger.warn(
        `localAgent: member channel listener unavailable (${error instanceof Error ? error.message : String(error)}); member_message calls will fail`,
      )
    }
  }

  /** Close the listener and remove the socket file. */
  async dispose(): Promise<void> {
    const server = this.server
    this.server = undefined
    this.registry.setMemberBridgeAvailable(false)
    if (typeof this.registry.setMemberToolsCheck === 'function') this.registry.setMemberToolsCheck(undefined)
    this.served.clear()
    this.tools.clear()
    if (typeof this.registry.setMemberToolsFace === 'function') this.registry.setMemberToolsFace(undefined)
    if (server === undefined) return
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    rmSync(this.socketPath, { force: true })
  }

  /** Serve one bridge connection: newline-delimited JSON request lines. */
  private serve(socket: Socket): void {
    let buffer = ''
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      for (;;) {
        const newline = buffer.indexOf('\n')
        if (newline < 0) break
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (line.trim() === '') continue
        void this.answer(socket, line)
      }
    })
    socket.on('error', () => { /* a dying bridge is unremarkable */ })
  }

  /** Handle one raw request line and write the one-line response. */
  private async answer(socket: Socket, line: string): Promise<void> {
    let outcome: MemberMessageOutcome | MemberModeToolsOutcome
    try {
      const request = JSON.parse(line) as MemberBridgeRequest | MemberCommandBridgeRequest | MemberModeToolsBridgeRequest
      outcome = request !== null && typeof request === 'object' && 'modeTools' in request
        ? await this.handleModeTools(request)
        : await this.handle(request as MemberBridgeRequest | MemberCommandBridgeRequest)
    } catch (error: unknown) {
      outcome = { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    if (!socket.destroyed) socket.end(`${JSON.stringify(outcome)}\n`)
  }

  /**
   * The delivery chain documented in the module header. Exposed for tests and
   * for the listener loop; never throws — every failure is a structured
   * outcome.
   * @param request - the bridge callback.
   * @returns the delivery outcome.
   */
  async handle(request: MemberBridgeRequest | MemberCommandBridgeRequest): Promise<MemberMessageOutcome> {
    if (request === null || typeof request !== 'object' || typeof request.token !== 'string') return { ok: false, error: 'Malformed member bridge request' }
    const run = this.registry.resolveMemberRun(request.token)
    if (run === undefined) {
      return { ok: false, error: 'localAgent: unknown or expired member token' }
    }
    if ('command' in request) {
      const room = this.probeRoom()
      if (room?.receiveMemberCommand === undefined) return { ok: false, error: 'Room coordination tools are unavailable' }
      try {
        const round = this.registry.memberConfiguration(run.childSessionId).round
        if (round === undefined || round.id.startsWith('prepare:')) return { ok: false, error: 'Room commands require an active member turn' }
        return await room.receiveMemberCommand(run, request.command)
      } catch (error) { return { ok: false, error: String(error) } }
    }
    if (typeof request.to !== 'string' || typeof request.text !== 'string' || request.text.trim() === '') return { ok: false, error: 'member_message requires a target and non-empty text' }
    const harness = this.registry.list()
      .map(name => this.registry.get(name))
      .find(candidate => candidate?.delegationProvider === run.provider)
    const from = {
      childSessionId: run.childSessionId,
      provider: run.provider,
      parentSessionId: run.parentSessionId,
      ...harness === undefined ? {} : { harnessDisplayName: harness.displayName },
    }
    const room = this.probeRoom()
    const target = this.registry.getDelegation(request.to)
    if (target === undefined) {
      // The family registry cannot resolve B — a member NAME resolves only
      // through room's roster, so the gate gets the raw argument first.
      if (room !== undefined) {
        const handed = await this.handToGate(room, from, request)
        if (handed !== undefined) return handed
      }
      return { ok: false, error: `localAgent: unknown member ${JSON.stringify(request.to)} (room absent: pass the member's child session id)` }
    }
    if (target.parentSessionId !== run.parentSessionId) {
      return { ok: false, error: `localAgent: member ${request.to} belongs to another parent session; cross-room notification is rejected` }
    }
    if (room !== undefined) {
      const handed = await this.handToGate(room, from, request)
      if (handed !== undefined) return handed
    }
    // Family direct-send: the resume lock doubles as the busy signal.
    if (this.registry.isResumeLocked(target.childSessionId) && !this.registry.supportsMemberConfiguration(target.provider)) {
      return { ok: true, receipt: 'busy' }
    }
    const label = from.harnessDisplayName ?? from.provider
    try {
      await this.registry.resume(target.parentSessionId, target.provider, target.childSessionId, [{
        type: 'text',
        text: `成员 ${label}（会话 ${from.childSessionId}）转告：\n${request.text}\n\n（回复请调用 member_message 工具，to 填 "${from.childSessionId}"）`,
      }])
    } catch (error: unknown) {
      return { ok: true, receipt: `error: ${error instanceof Error ? error.message : String(error)}` }
    }
    return { ok: true, receipt: 'sent' }
  }

  /**
   * The member's mode tools: the room says which mode the member has; the
   * preset tool host lists or runs that mode's plugin tools. No room, no mode
   * or no host = an empty list.
   * @param request - the bridge callback.
   * @returns the list or the call result.
   */
  async handleModeTools(request: MemberModeToolsBridgeRequest): Promise<MemberModeToolsOutcome> {
    const token = request.token
    const run = typeof token === 'string' ? this.registry.resolveMemberRun(token) : undefined
    if (run === undefined) return { ok: false, error: 'localAgent: unknown or expired member token' }
    if ('report' in request.modeTools) {
      // The bridge could not fetch the list and served its placeholder: the
      // member works without its mode tools until its process is replaced.
      const reason = typeof request.modeTools.report.reason === 'string' ? request.modeTools.report.reason : 'unknown'
      this.recordServed(token, { served: 'placeholder', reason, at: Date.now() })
      this.ctx.logger.warn(`localAgent: member ${run.childSessionId} (${run.provider}) is running without its mode tools (${reason}); its process is replaced at its next round`)
      this.modeTools?.note({ childSessionId: run.childSessionId, provider: run.provider, placeholder: reason })
      return { ok: true, recorded: true }
    }
    const mode = this.modeTools === undefined ? undefined : await this.probeRoom()?.memberMode?.(run)
    if ('list' in request.modeTools) {
      const probe = request.modeTools.probe === true
      // A probe is the bridge recovering while its CLI still holds the
      // placeholder: whatever it finds, the CLI was not served it.
      if (probe) this.recordServed(token, { served: 'placeholder', reason: 'the bridge recovered after serving the placeholder', at: Date.now() }, true)
      if (mode === undefined) {
        // Visible in the diagnostics: a member whose room gave it no mode.
        this.modeTools?.note({ childSessionId: run.childSessionId, provider: run.provider, mode: false })
        if (!probe) this.recordServed(token, { served: 'complete', count: 0, names: [], at: Date.now() })
        return { ok: true, tools: [] }
      }
      try {
        const tools = await this.modeTools!.list(run.childSessionId, mode.preset, mode.cwd, mode.desk)
        await this.installSkills(run, mode.preset)
        if (!probe) this.recordServed(token, { served: 'complete', count: tools.length, names: tools.map(tool => tool.name), at: Date.now() })
        return { ok: true, tools }
      } catch (error) {
        // Not "no mode": the member has one and the host failed to list it, so
        // the bridge must not mistake this for an empty mode (it retries, then
        // serves its placeholder).
        this.ctx.logger.warn(`localAgent: mode tools for ${run.childSessionId} unavailable: ${String(error)}`)
        return { ok: false, error: `mode ${mode.preset} tools could not be listed: ${error instanceof Error ? error.message : String(error)}` }
      }
    }
    if (mode === undefined) return { ok: false, error: 'This member has no mode tools' }
    const { name, arguments: args } = request.modeTools.call
    try {
      return { ok: true, result: await this.modeTools!.call(run.childSessionId, mode.preset, name, args ?? {}, AbortSignal.timeout(MODE_TOOL_TIMEOUT_MS), mode.cwd, mode.desk) }
    } catch (error) { return { ok: false, error: String(error) } }
  }

  /** Install the mode's skills into the member's harness skill directory (best-effort). */
  private async installSkills(run: { readonly childSessionId: string; readonly provider: string }, preset: string): Promise<void> {
    try {
      const harness = this.registry.list().map(name => this.registry.get(name)).find(candidate => candidate?.delegationProvider === run.provider)
      const dir = harness === undefined ? undefined : harnessSkillsDir(harness.name, this.registry.homeDir(harness.name))
      if (dir === undefined) return
      installModeSkills(dir, preset, await this.modeTools!.skills(run.childSessionId, preset))
    } catch (error) {
      this.ctx.logger.warn(`localAgent: mode skills for ${run.childSessionId} not installed: ${String(error)}`)
    }
  }

  /** Probe the optional room gate without importing any room package. */
  private probeRoom(): RoomMemberMessageGate | undefined {
    const room = (this.ctx.get as (key: string) => unknown).call(this.ctx, 'room')
    if (typeof room !== 'object' || room === null) return undefined
    const gate = room as Partial<RoomMemberMessageGate>
    return typeof gate.receiveMemberMessage === 'function' ? gate as RoomMemberMessageGate : undefined
  }

  /**
   * Offer the notification to the room gate. A returned receipt means room
   * owns the dispatch (passed back verbatim); a THROW declines (the parent
   * session is not a room this instance manages) and the family path
   * continues. The message is the frozen contract: `from`/`to` as plain
   * strings (the sender's child session id; room resolves roster names),
   * the delegation view as provenance.
   */
  private async handToGate(
    room: RoomMemberMessageGate,
    from: LocalAgentDelegationView,
    request: MemberBridgeRequest,
  ): Promise<MemberMessageOutcome | undefined> {
    const message: LocalAgentMemberMessage = {
      from: from.childSessionId,
      to: request.to,
      content: request.text,
      parentSessionId: from.parentSessionId,
      ...request.kind === 'task' || request.kind === 'notify' ? { kind: request.kind } : {},
      ...typeof request.inReplyTo === 'string' ? { inReplyTo: request.inReplyTo } : {},
      ...typeof request.note === 'string' ? { note: request.note } : {},
      ...typeof request.task === 'string' ? { task: request.task } : {},
      provenance: {
        childSessionId: from.childSessionId,
        provider: from.provider,
        parentSessionId: from.parentSessionId,
        ...from.harnessDisplayName === undefined ? {} : { harnessDisplayName: from.harnessDisplayName },
      },
    }
    let ownsRoom = false
    try {
      if (room.isRoom !== undefined) {
        ownsRoom = true // An unreadable ownership check also fails closed.
        if (!await room.isRoom({ sessionId: from.parentSessionId })) return undefined
      }
      const receipt = await room.receiveMemberMessage(message)
      return { ok: true, receipt }
    } catch (error: unknown) {
      if (ownsRoom) return { ok: false, error: `Room rejected member message: ${String(error)}` }
      // Legacy gates have no ownership probe; preserve their decline contract. The family
      // direct-sends.
      this.ctx.logger.warn(`localAgent: room gate declined (${error instanceof Error ? error.message : String(error)}); direct-sending the member message`)
      return undefined
    }
  }
}
