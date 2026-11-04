/**
 * The child log as a comparable event sequence for the mirror snapshot specs:
 * every event's type, data and append options, in log order. Wall-clock
 * fields are frozen by the specs (fake `Date`), so only the random message
 * ids are normalized — a changed event shape, order, or step coordinate shows
 * in the diff.
 */
import type { Session } from '@deepseek-ai/dsh-session'
import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import { ExecutionRecorder, executionOutcome, type LocalAgentUnrecordedDeclaration } from '@khorsheed/dsh-local-agent'

/** A fixed wall clock for the snapshot specs (2026-01-01T00:00:00Z). */
export const SNAPSHOT_NOW = 1_767_225_600_000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The child session's events; seq stays (sourceEventSeqs reference it), random message ids read `<uuid>`. */
export function mirrorSnapshot(session: Session): unknown[] {
  return JSON.parse(JSON.stringify(session.snapshotEvents()), (_key, value: unknown) =>
    typeof value === 'string' && UUID.test(value) ? '<uuid>' : value) as unknown[]
}

/**
 * Poll a condition without touching the frozen clock: `vi.waitFor` advances
 * fake timers (the Date included) on every poll, which would make the
 * snapshot's times depend on how many polls a run took.
 */
export async function until(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = performance.now() + timeoutMs
  while (!check()) {
    if (performance.now() > deadline) throw new Error('condition not met before the deadline')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

/**
 * Open a member execution around a snapshot round the way the core does at
 * its admission point (batch 5 S1). The child is not live to the recorder
 * until after admission — a first round, whose session the provider creates
 * — so the start record lands through the provider's own turn opener, and
 * `settle` writes the end record once the provider's writes are in.
 * @param child - the round's child session.
 * @param unrecorded - the harness's static declaration (locked by the snapshot).
 */
export function snapshotExecution(child: Session, unrecorded: LocalAgentUnrecordedDeclaration): { settle(result: SubagentResult): void } {
  let admitted = false
  const recorder = new ExecutionRecorder({ session: () => admitted ? child : undefined, persist: () => {}, settleWaitMs: 0, onError: (error) => { throw error } })
  const open = recorder.admit({
    childSessionId: String(child.id), parentSessionId: 'room-snapshot', operation: 'prompt', unrecorded,
    execution: {
      caller: 'room', callerRef: 'run-1',
      cause: { kind: 'human', sessionId: 'room-snapshot', messageId: 'msg-1', via: 'room' },
      task: { sessionId: 'room-snapshot', id: 'task-1' },
    },
  })
  admitted = true
  return { settle: (result) => { open.settle(executionOutcome(result)) } }
}
