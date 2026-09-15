/**
 * Read-only Remote channel for the local-agent family: roster, per-harness
 * auth status, and scoped session records. The web client polls these through
 * Typert Gateway instead of the slash-command channel, so UI refreshes never
 * leave `command/run`/`command/done` lifecycle nodes in the session log.
 * Sign-out and login stay on the command channel: they are user-initiated
 * actions whose visible command node is the expected feedback.
 * @module @khorsheed/dsh-local-agent/gateway
 */

import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type {
  LocalAgentDelegationView,
  LocalAgentModelInfo,
  LocalAgentModelBroker,
  LocalAgentModelDirectory,
  LocalAgentPromptResult,
  LocalAgentSessionRecord,
  LocalAgentStreamFrame,
} from './types.ts'
import type { LocalAgentRosterRow, LocalAgentStatus } from './types.ts'
import { extendModelDirectory } from './model-directory.ts'

/**
 * Remote-only projection of the local-agent registry, exposed to the browser
 * through Typert Gateway under the `localAgentGateway` service key.
 */

/**
 * Fold a model surface's `lastObserved` into its pick list: a member (or
 * harness) whose only named model is what it was observed running still gets
 * a one-item menu instead of an empty one. The observation appends LAST —
 * the broker's own choices keep their ranking — and an already-listed value
 * leaves the list untouched (choices arrive deduped from the broker).
 */
function withObservedChoice(info: LocalAgentModelInfo): LocalAgentModelInfo {
  const observed = info.lastObserved
  if (observed === undefined) return info
  return {
    ...info,
    choices: info.choices.includes(observed) ? info.choices : [...info.choices, observed],
    ...info.directory === undefined ? {} : { directory: extendModelDirectory(info.directory, [], [observed]) },
  }
}

export default class LocalAgentGateway extends TypertRemoteService {
  static inject = ['localAgent', 'sessions']

  constructor(ctx: Context) {
    super(ctx, 'localAgentGateway')
  }

  /**
   * Follow one member's transient output with a complete reconnect baseline.
   * @param childSessionId - mirrored session identity.
   * @param signal - Remote-owned cancellation, including browser disconnects.
   * @returns bounded incremental updates; final content remains in session history.
   */
  @Remote({ mode: 'stream' })
  followMemberOutput(childSessionId: string, signal: AbortSignal): AsyncIterable<LocalAgentStreamFrame> {
    return this.ctx.localAgent.liveStreams.follow(childSessionId, signal)
  }

  private directoryBroker(name: string, childSessionId: string | undefined): LocalAgentModelBroker | undefined {
    const harness = this.ctx.localAgent.get(name)
    if (childSessionId !== undefined) {
      const record = this.ctx.localAgent.getDelegation(childSessionId)
      if (record === undefined || record.provider !== harness?.delegationProvider) return undefined
    }
    return harness?.modelBroker
  }

  /**
   * Read or explicitly refresh native model discovery, without changing a member.
   * @param name - owning harness.
   * @param childSessionId - member context, or undefined for the harness default.
   * @param refresh - bypass the discovery TTL.
   * @returns source-labelled discovery state, or null for an unavailable broker.
   */
  @Remote('modelDirectory')
  async modelDirectory(name: string, childSessionId: string | undefined, refresh: boolean): Promise<LocalAgentModelDirectory | null> {
    const broker = this.directoryBroker(name, childSessionId)
    return await broker?.modelDirectory?.(childSessionId, refresh) ?? null
  }

  /**
   * Keep a currently open model picker synchronized with discovery completion.
   * @param name - owning harness.
   * @param childSessionId - member context, or undefined for the harness default.
   * @param signal - Remote-owned cancellation.
   * @returns directory baselines and subsequent snapshots.
   */
  @Remote({ mode: 'stream' })
  async *followModelDirectory(name: string, childSessionId: string | undefined, signal: AbortSignal): AsyncIterable<LocalAgentModelDirectory> {
    const broker = this.directoryBroker(name, childSessionId)
    if (broker?.followModelDirectory !== undefined) yield* broker.followModelDirectory(childSessionId, signal)
    else {
      const directory = await broker?.modelDirectory?.(childSessionId)
      if (directory !== undefined && !signal.aborted) yield directory
    }
  }

  /**
   * Registered harnesses in registration order.
   * @returns the roster rows.
   */
  @Remote('roster')
  roster(): readonly LocalAgentRosterRow[] {
    return this.ctx.localAgent.roster()
  }

  /**
   * The child session ids with an in-flight delegation run (the
   * active-delegation registry's key set). Surfaces that render one-shot
   * subagent rows poll this to mark a row as actually running — the official
   * session summary's `running` flag is agent-based and stays false for
   * external CLI one-shots, which have no live agent — and to offer the
   * stop verb that dispatches `/local-agent stop <childSessionId>`.
   * @returns the in-flight child session ids.
   */
  @Remote('activeDelegations')
  activeDelegations(): readonly string[] {
    return this.ctx.localAgent.activeDelegations()
  }

  /**
   * One harness's auth status, in the default scope or in a named one.
   * @param name - the harness name.
   * @param scope - the named scope to report on; absent means the default
   *   scope, so a client written before scopes existed gets exactly the
   *   snapshot it always got.
   * @returns the status snapshot.
   */
  @Remote('status')
  status(name: string, scope?: string): Promise<LocalAgentStatus> {
    return this.ctx.localAgent.statusOf(name, scope)
  }

  /**
   * One harness's scoped session records, optionally narrowed to the sessions
   * whose working directory is a given dsh session's cwd — the delegations a
   * session's workspace actually produced, so one project's kimi sessions do
   * not surface in another project's session.
   * @param name - the harness name.
   * @param sessionId - optional dsh session whose cwd filters the records.
   * @returns the matching session records.
   */
  @Remote('sessions')
  async sessions(name: string, sessionId?: string): Promise<readonly LocalAgentSessionRecord[]> {
    const records = await this.ctx.localAgent.sessionsOf(name)
    if (sessionId === undefined) return records
    const cwd = this.ctx.sessions.get(SessionId(sessionId))?.header.cwd
    if (cwd === undefined) return records
    return records.filter(record => record.workDir === cwd)
  }

  /**
   * The member channel's membership check: the delegation view for one dsh
   * child session, or null when the family never delegated it. The composer
   * chain elects on the session snapshot alone (one-shot subagent), then
   * confirms membership through this Remote — a null answer renders the same
   * read-only panel the official composer shows, never a writable box.
   * The CLI-session resume handle (`cliSessionId`) deliberately stays off the
   * wire: the resume facade resolves it host-side from the record.
   * @param childSessionId - the dsh child session id being viewed.
   * @returns the delegation view, or null for a non-member session.
   */
  @Remote('memberOf')
  memberOf(childSessionId: string): LocalAgentDelegationView | null {
    const registry = this.ctx.localAgent
    const record = registry.getDelegation(childSessionId)
    if (record === undefined) return null
    const harness = registry.harnessForProvider(record.provider)
    return {
      childSessionId: record.childSessionId,
      provider: record.provider,
      parentSessionId: record.parentSessionId,
      ...harness === undefined ? {} : { harnessDisplayName: harness.displayName },
    }
  }

  /**
   * The model surface of one harness without a member — the settings card's
   * "what would a round run with" read. Null when the harness is unknown or
   * exposes no model broker: the card then keeps its free-text field exactly
   * as before brokers existed. The core fills `lastObserved` from the
   * delegation records (the harness's own provider) when the broker's answer
   * carries none — display context for the cli-builtin layer, never a layer —
   * and appends it to `choices` when no broker choice lists it, so the card's
   * menu offers what last ran instead of staying empty.
   * @param name - the harness name.
   * @returns the layer-by-layer surface, or null.
   */
  @Remote('harnessModel')
  async harnessModel(name: string): Promise<LocalAgentModelInfo | null> {
    const harness = this.ctx.localAgent.get(name)
    if (harness?.modelBroker === undefined) return null
    const info = await harness.modelBroker.modelInfo()
    // A harness without a delegation provider has no records to observe from.
    const observed = harness.delegationProvider === undefined
      ? undefined
      : this.ctx.localAgent.latestObservedModel(harness.delegationProvider)
    return withObservedChoice(info.lastObserved !== undefined || observed === undefined
      ? info
      : { ...info, lastObserved: observed })
  }

  /**
   * The model surface of one member — the composer's picker read. The
   * delegation record's requested model rides in from the core so the broker
   * can rank it between the override and the settings layer; the record's
   * OBSERVED model fills `lastObserved` when the broker's answer carries none
   * (a broker that names one itself always wins — spread order: the broker's
   * answer first, the core's fill only over an absent field) and joins
   * `choices` as the last entry when no broker choice lists it, so a member
   * that ran once has a one-item pick list instead of an empty menu. Null for a
   * non-member session or a brokerless harness.
   * @param childSessionId - the dsh child session id of the member.
   * @returns the layer-by-layer surface, or null.
   */
  @Remote('memberModel')
  async memberModel(childSessionId: string): Promise<LocalAgentModelInfo | null> {
    const registry = this.ctx.localAgent
    const record = registry.getDelegation(childSessionId)
    if (record === undefined) return null
    const broker = registry.harnessForProvider(record.provider)?.modelBroker
    if (broker === undefined) return null
    const info = await broker.modelInfo(childSessionId, record.model)
    return withObservedChoice(info.lastObserved !== undefined || record.observedModel === undefined
      ? info
      : { ...info, lastObserved: record.observedModel })
  }

  /**
   * Switch a member's session-level model (the composer's picker write). The
   * override outranks the delegation's recorded model and the settings
   * layer; with the live driver on it retires the member's resident runtime
   * so the NEXT round respawns onto the new model — the CLI session itself
   * (its rollout) carries over. Failures arrive structured, never raw.
   * @param childSessionId - the dsh child session id of the member.
   * @param model - the model identifier, or undefined to clear the override
   *   (the member then follows the settings layer again).
   * @returns `{ ok: true }` once applied, or a structured error.
   */
  @Remote('setMemberModel')
  async setMemberModel(childSessionId: string, model?: string): Promise<LocalAgentPromptResult> {
    const registry = this.ctx.localAgent
    const record = registry.getDelegation(childSessionId)
    if (record === undefined) {
      return { ok: false, error: `localAgent: no delegation recorded for child session ${childSessionId}` }
    }
    const broker = registry.harnessForProvider(record.provider)?.modelBroker
    if (broker === undefined) {
      return { ok: false, error: `localAgent: ${record.provider} exposes no model broker` }
    }
    try {
      await broker.setMemberModel(childSessionId, model)
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    return { ok: true }
  }

  /**
   * Send one human-authored follow-up to a family member: continue the
   * member's SAME CLI session inside the SAME dsh child session. The child
   * session id is the membership proof — the user opened the real child
   * session, and the recorded delegation is the authorization source — so
   * there is no model-forged handle surface; the resume handle never enters
   * the prompt text. The prompt goes through the facade
   * ({@link LocalAgentRegistry.resume}) unchanged: ownership check, resume
   * lock, reattach, and run tracking all apply.
   * @param childSessionId - the dsh child session id of the member.
   * @param text - the human's follow-up message.
   * @returns `{ ok: true }` once the run started, or a structured error
   *   (unknown member, parent not live, resume in flight) for the composer to
   *   render inline — raw exceptions never cross the wire.
   */
  @Remote('promptMember')
  async promptMember(childSessionId: string, text: string): Promise<LocalAgentPromptResult> {
    const record = this.ctx.localAgent.getDelegation(childSessionId)
    if (record === undefined) {
      return { ok: false, error: `localAgent: no delegation recorded for child session ${childSessionId}` }
    }
    try {
      await this.ctx.localAgent.resume(
        record.parentSessionId,
        record.provider,
        childSessionId,
        [{ type: 'text', text }],
        // The recorded scope is the member's own: a follow-up continues the
        // CLI session in the scoped home its earlier rounds ran in, and the
        // record is where that fact lives (the resume refuses any other).
        record.scope === undefined ? undefined : { scope: record.scope },
      )
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    return { ok: true }
  }

  /**
   * Interrupt a member's in-flight run (the composer's Stop).
   * @param childSessionId - the dsh child session id of the member.
   * @returns whether an in-flight run was found and signalled.
   */
  @Remote('stopMember')
  stopMember(childSessionId: string): boolean {
    return this.ctx.localAgent.cancel(childSessionId)
  }
}
