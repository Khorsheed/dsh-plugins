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
  LocalAgentPromptResult,
  LocalAgentSessionRecord,
} from './types.ts'
import type { LocalAgentRosterRow, LocalAgentStatus } from './types.ts'

/**
 * Remote-only projection of the local-agent registry, exposed to the browser
 * through Typert Gateway under the `localAgentGateway` service key.
 */
export default class LocalAgentGateway extends TypertRemoteService {
  static inject = ['localAgent', 'sessions']

  constructor(ctx: Context) {
    super(ctx, 'localAgentGateway')
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
    const harness = registry.list()
      .map(harnessName => registry.get(harnessName))
      .find(candidate => candidate?.delegationProvider === record.provider)
    return {
      childSessionId: record.childSessionId,
      provider: record.provider,
      parentSessionId: record.parentSessionId,
      ...harness === undefined ? {} : { harnessDisplayName: harness.displayName },
    }
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
