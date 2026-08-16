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
import type { LocalAgentSessionRecord } from './index.ts'
import type { LocalAgentRosterRow, LocalAgentStatus } from './index.ts'

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
   * One harness's auth status.
   * @param name - the harness name.
   * @returns the status snapshot.
   */
  @Remote('status')
  status(name: string): Promise<LocalAgentStatus> {
    return this.ctx.localAgent.statusOf(name)
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
}
