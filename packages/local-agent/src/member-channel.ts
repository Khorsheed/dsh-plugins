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
import type {
  LocalAgentDelegationView,
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
}

/**
 * The member-channel host: owns the loopback unix-socket listener and the
 * delivery chain. Mounted by the plugin's `apply` and disposed with its fiber.
 */
export class MemberChannel {
  private server: Server | undefined

  constructor(
    private readonly ctx: Context,
    private readonly registry: LocalAgentRegistry,
    private readonly socketPath: string,
  ) {}

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
    let outcome: MemberMessageOutcome
    try {
      outcome = await this.handle(JSON.parse(line) as MemberBridgeRequest)
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
  async handle(request: MemberBridgeRequest): Promise<MemberMessageOutcome> {
    const run = this.registry.resolveMemberRun(request.token)
    if (run === undefined) {
      return { ok: false, error: 'localAgent: unknown or expired member token' }
    }
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
    if (this.registry.isResumeLocked(target.childSessionId)) {
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
      provenance: {
        childSessionId: from.childSessionId,
        provider: from.provider,
        parentSessionId: from.parentSessionId,
        ...from.harnessDisplayName === undefined ? {} : { harnessDisplayName: from.harnessDisplayName },
      },
    }
    try {
      const receipt = await room.receiveMemberMessage(message)
      return { ok: true, receipt }
    } catch (error: unknown) {
      // A declining (or broken) gate must not break the channel; the family
      // direct-sends.
      this.ctx.logger.warn(`localAgent: room gate declined (${error instanceof Error ? error.message : String(error)}); direct-sending the member message`)
      return undefined
    }
  }
}
