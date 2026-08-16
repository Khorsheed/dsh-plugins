/**
 * message-tools host half: appends edit/withdraw events to the session log
 * and captures a file snapshot on withdrawal (for "withdraw undo").
 * Events carry `ignorable: true` — the official guard for out-of-repo plugin
 * vocabulary (known-event-types defers a registration surface for downstream
 * events; ignorable lets the read path skip them safely).
 * @module @khorsheed/dsh-client-message-tools/host
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session'
import { editEvent, withdrawEvent } from './events.ts'
import { readFileContent, saveSnapshot, type SnapshotEntry } from './snapshot.ts'

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Edit: replace the content of a prior user message. */
    'user/message/edited': {
      targetSeq: number
      content: Array<{ type: 'text'; text: string }>
      ts?: number
    }
    /** Withdraw: hide a prior user message from the model view. */
    'user/message/withdrawn': {
      targetSeq: number
      ts?: number
    }
  }
}

/** Session append surface (structural subset the host reads). */
export interface AppendSession {
  append(type: string, data: unknown, opts?: { ignorable?: boolean }): { seq: number }
}

/** Public face: durable edit/withdraw on a session. */
export interface MessageToolsHost {
  /**
   * Append a user/message/edited event.
   * @param session - the session to append to.
   * @param targetSeq - original user message seq.
   * @param text - replacement text.
   * @returns the appended event's seq.
   */
  edit(session: AppendSession, targetSeq: number, text: string): { seq: number }
  /**
   * Append a user/message/withdrawn event and snapshot the affected files.
   * @param session - the session to append to.
   * @param targetSeq - original user message seq.
   * @param options - state dir for the snapshot + files captured at withdrawal.
   * @returns the appended event's seq.
   */
  withdraw(
    session: AppendSession,
    targetSeq: number,
    options: { stateDir: string; files: Array<{ path: string; op: 'write' | 'edit'; resolve: (p: string) => string }> },
  ): { seq: number }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    messageTools: MessageToolsHost
  }
}

/** cordis plugin name. */
export const name = 'message-tools'

/** Apply the host half: provide the durable edit/withdraw + snapshot service. */
export function apply(ctx: Context): void {
  ctx.provide('messageTools', {
    edit: (session, targetSeq, text) =>
      session.append('user/message/edited', editEvent(targetSeq, text, Date.now()).data, { ignorable: true }),
    withdraw: (session, targetSeq, options) => {
      const appended = session.append('user/message/withdrawn', withdrawEvent(targetSeq, Date.now()).data, { ignorable: true })
      // Snapshot the affected files at withdrawal time, so "withdraw undo"
      // can restore them to this state.
      const entries: SnapshotEntry[] = []
      for (const file of options.files) {
        const content = readFileContent(file.resolve(file.path))
        if (content !== undefined) entries.push({ path: file.path, content, op: file.op })
      }
      if (entries.length > 0) {
        saveSnapshot(options.stateDir, {
          withdrawalSeq: appended.seq,
          takenAt: Date.now(),
          entries,
        })
      }
      return appended
    },
  })
}
