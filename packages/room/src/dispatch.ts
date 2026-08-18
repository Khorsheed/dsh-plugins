/**
 * Dispatch engine: turns `room/dispatch` journal records into member runs.
 * Same-member dispatches serialize on an in-process FIFO (the family resume
 * lock allows one in-flight resume per child session anyway); different
 * members run in parallel. Every lifecycle edge lands in the journal
 * (`room/run-state` running → done/cancelled/failed, plus `room/speech` for a
 * CLI member's reply), so a reload replays the exact dispatch history.
 *
 * The prompt every member receives is uniform: role instructions (first
 * dispatch, or an edit carried as an update) + the blackboard increment since
 * the member's previous dispatch + this dispatch's text. Phase 1 carries the
 * FULL increment with no window/summary policy — a known quadratic-context
 * risk the design note flags for later.
 * @module @khorsheed/dsh-room/dispatch
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
// Type-only: pulls the `agents` registry merge onto Context.
import type {} from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { probeLocalAgent, runOutputText } from './adapter.ts'
import { pendingInstructions, previousCursor, replay } from './journal.ts'
import type { RoomBlackboardEntry, RoomMember } from './types.ts'

/** Plugin tag carried by the main-agent followup's message source. */
export const ROOM_PLUGIN = '@khorsheed/dsh-room'

/** One blackboard entry as a prompt line: `人: …` / `@ada @bill: …` / `[ada]: …`. */
function formatEntry(entry: RoomBlackboardEntry): string {
  switch (entry.kind) {
    case 'note': return `人: ${entry.text}`
    case 'dispatch': return `@${entry.targets.join(' @')}: ${entry.text}`
    case 'speech': return `[${entry.member}]: ${entry.text}`
  }
}

/**
 * Assemble the uniform member prompt: role-instructions carry, then the
 * blackboard increment (entries after the member's previous dispatch and
 * before this one), then this dispatch's text.
 */
function assemblePrompt(
  room: Session,
  member: RoomMember,
  cursor: number | undefined,
  dispatchSeq: number,
  text: string,
): string {
  const sections: string[] = []
  const pending = pendingInstructions(room.events, member.name, cursor)
  if (pending?.kind === 'initial') sections.push(`你的角色指令：${pending.instructions}`)
  if (pending?.kind === 'update') sections.push(`你的角色指令更新为：${pending.instructions}`)
  const increment = replay(room.events).blackboard.filter(entry =>
    (cursor === undefined || entry.seq > cursor) && entry.seq < dispatchSeq)
  if (increment.length > 0) {
    sections.push(['【房间黑板（自你上次被派发以来）】', ...increment.map(formatEntry)].join('\n'))
  }
  sections.push(text)
  return sections.join('\n\n')
}

/**
 * The per-room dispatch engine. Owned by the RoomService; all state lives in
 * the journal except the in-process FIFO queues (a restart simply has no
 * in-flight runs).
 */
export class DispatchEngine {
  /** memberKey → the queue tail promise. */
  private readonly queues = new Map<string, Promise<void>>()

  /**
   * @param ctx - host context carrying the session store and agents registry.
   */
  constructor(private readonly ctx: Context) {}

  /**
   * Enqueue a dispatch record for execution. Fire-and-forget: the outcome is
   * journaled as run-state/speech events, never returned to the caller.
   * @param room - the room session.
   * @param memberName - the dispatch target.
   * @param text - the dispatch text.
   * @param dispatchSeq - the appended `room/dispatch` event's seq.
   */
  dispatch(room: Session, memberName: string, text: string, dispatchSeq: number): void {
    const key = `${room.id} ${memberName}`
    const tail = this.queues.get(key) ?? Promise.resolve()
    // A failing run settles inside run(); the chain itself never rejects, so
    // one member's failure cannot strand their later dispatches.
    const next = tail
      .then(() => this.run(room, memberName, text, dispatchSeq))
      .catch((error: unknown) => {
        this.ctx.logger.warn(`room: dispatch to "${memberName}" faulted: ${String(error)}`)
      })
    this.queues.set(key, next)
  }

  /** Resolve when every queued dispatch has settled (test/ops drain hook). */
  async idle(): Promise<void> {
    await Promise.all([...this.queues.values()])
  }

  /** Execute one dispatch: run-state running → member turn → settle edges. */
  private async run(room: Session, memberName: string, text: string, dispatchSeq: number): Promise<void> {
    const state = replay(room.events)
    const member = state.members.find(entry => entry.name === memberName)
    // Removed between the dispatch and its execution: nothing to run, and the
    // removal event is already the journal's answer.
    if (member === undefined) return
    const cursor = previousCursor(room.events, memberName, dispatchSeq)
    const startedAt = Date.now()
    room.append('room/run-state', { member: memberName, state: 'running', startedAt })
    await this.ctx.sessions.flush(room)
    try {
      if (member.kind === 'main-agent') {
        await this.runMainAgent(room, member, cursor, dispatchSeq, text, startedAt)
      } else {
        await this.runCliMember(room, member, cursor, dispatchSeq, text, startedAt)
      }
    } catch (error: unknown) {
      // Any engine-level fault (adapter throw, followup throw) fails the run
      // loud in the journal; the queue chain continues.
      this.ctx.logger.warn(`room: dispatch to "${memberName}" failed: ${String(error)}`)
      await this.settle(room, memberName, startedAt, 'failed')
    }
  }

  /** Main-agent member turn: a plugin-sourced followup on the room's own agent. */
  private async runMainAgent(
    room: Session, member: RoomMember, cursor: number | undefined,
    dispatchSeq: number, text: string, startedAt: number,
  ): Promise<void> {
    const agent = this.ctx.agents.get(room.id)
    if (agent === undefined) {
      // Fail loud: the room's own agent is not live, the message goes nowhere.
      await this.settle(room, member.name, startedAt, 'failed')
      return
    }
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: assemblePrompt(room, member, cursor, dispatchSeq, text) }],
      source: { kind: 'plugin', plugin: ROOM_PLUGIN },
    }))
    // Phase-1 simplicity: the followup's own turn converging to idle IS the
    // run; the main agent's reply is its ordinary assistant speech (no
    // room/speech projection — speech mirrors CLI members only).
    await agent.whenIdle()
    await this.settle(room, member.name, startedAt, 'done')
  }

  /** CLI member turn: facade start (first round) or resume, then the speech mirror. */
  private async runCliMember(
    room: Session, member: RoomMember, cursor: number | undefined,
    dispatchSeq: number, text: string, startedAt: number,
  ): Promise<void> {
    const facade = probeLocalAgent(this.ctx)
    if (facade === undefined) {
      this.ctx.logger.warn(`room: cannot dispatch to "${member.name}": local-agent facade unavailable`)
      await this.settle(room, member.name, startedAt, 'failed')
      return
    }
    // Roster invariant: cli members always carry a provider (invite enforces).
    const provider = member.provider ?? ''
    const prompt = [{ type: 'text' as const, text: assemblePrompt(room, member, cursor, dispatchSeq, text) }]
    const run = member.childSessionId === undefined
      ? await facade.start(room.id, provider, prompt)
      : await facade.resume(room.id, provider, member.childSessionId, prompt)
    if (member.childSessionId === undefined) {
      // Persist the delegation handle: the run id IS the child session id,
      // and journaling it lets a reload reattach the member (resume path).
      room.append('room/member-updated', { name: member.name, childSessionId: run.id })
      await this.ctx.sessions.flush(room)
    }
    const result = await run.result
    if (result.stopReason === 'completed') {
      room.append('room/speech', {
        member: member.name,
        text: runOutputText(result.output),
        childSessionId: run.id,
        durationMs: Date.now() - startedAt,
      })
      await this.ctx.sessions.flush(room)
      await this.settle(room, member.name, startedAt, 'done')
    } else if (result.stopReason === 'aborted') {
      await this.settle(room, member.name, startedAt, 'cancelled')
    } else {
      await this.settle(room, member.name, startedAt, 'failed')
    }
  }

  /**
   * Append a terminal run-state edge, unless a cancel() already moved THIS
   * run (same startedAt) to a terminal state — the first terminal edge wins.
   */
  private async settle(
    room: Session, memberName: string, startedAt: number,
    state: 'done' | 'cancelled' | 'failed',
  ): Promise<void> {
    const current = replay(room.events).runs.find(entry => entry.member === memberName)
    if (current !== undefined && current.startedAt === startedAt && current.state !== 'running') return
    room.append('room/run-state', {
      member: memberName, state, startedAt, elapsedMs: Date.now() - startedAt,
    })
    await this.ctx.sessions.flush(room)
  }
}
