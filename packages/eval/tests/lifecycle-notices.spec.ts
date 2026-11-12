import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { appendPluginRecord, pluginRecordOf, SessionId } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { createExperiment } from '../src/design/experiment-store.ts'
import { EvalLifecycleNotifier, evalLifecycleNoticeOf, EVAL_LIFECYCLE_RECORD } from '../src/lifecycle-notices.ts'
import type { RunReport } from '../src/run/run.ts'

const contexts: Context[] = []
const dirs: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

function report(overrides: Partial<RunReport> = {}): RunReport {
  return {
    runId: 'run-alpha',
    dryRun: false,
    meta: { experimentId: 'alpha', judge: { conditions: ['judge'], samples: 1 } },
    cells: [{
      missionId: 'cell-1', task: 'P0', condition: 'c', rep: 1, attempts: 1,
      finalState: 'archived', childSessionIds: [], promptShas: {}, activeMs: 1,
      verdicts: { script: 0, llmDraft: 1 },
    }],
    readiness: [],
    subset: { only: null, maxCells: null, totalCells: 1, selectedCells: 1 },
    template: {} as never,
    ...overrides,
  }
}

async function fixture(persistenceRoot?: string) {
  const stateRoot = await mkdtemp(join(tmpdir(), 'eval-lifecycle-state-'))
  dirs.push(stateRoot)
  const experiment = await createExperiment(stateRoot, {
    name: 'Alpha comparison',
    dataset: { registry: 'local', set: 'qa', commit: 'a'.repeat(40) },
    plan: '{}',
  })
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  if (persistenceRoot !== undefined) await ctx.plugin(JsonlSessionPersistence, { root: persistenceRoot, compression: 'none' })
  const session = ctx.sessions.create(SessionId('origin-session'))
  const handle = persistenceRoot === undefined ? undefined : await ctx.sessionPersistence.create(session.header)
  const notifier = new EvalLifecycleNotifier({ get: name => name === 'sessions' ? ctx.sessions : undefined }, stateRoot)
  return { ctx, session, notifier, experimentId: experiment.id, handle }
}

describe('EvalLifecycleNotifier', () => {
  it('writes run, judge and human notifications once with the experiment title', async () => {
    const { session, notifier, experimentId } = await fixture()
    const current = report({ meta: { experimentId, judge: { conditions: ['judge'], samples: 1 } } })
    await notifier.runCompleted(current, session.id)
    await notifier.runCompleted(current, session.id)
    await notifier.humanFinal({ runId: current.runId, ticket: 'ticket-1', experimentId, originSession: session.id, duplicate: false })
    await notifier.humanFinal({ runId: current.runId, ticket: 'ticket-1', experimentId, originSession: session.id, duplicate: false })
    await notifier.humanFinal({ runId: current.runId, ticket: 'ticket-2', experimentId, originSession: session.id, duplicate: true })
    const records = session.snapshotEvents().map(evalLifecycleNoticeOf).filter(value => value !== undefined)
    expect(records.map(record => record.stage)).toEqual(['run-completed', 'judge-completed', 'human-final'])
    expect(records.map(record => record.title)).toEqual(['Alpha comparison', 'Alpha comparison', 'Alpha comparison'])
    expect(records.every(record => record.experimentId === experimentId)).toBe(true)
  })

  it('does not invent judging or completion for an unjudged or cancelled run', async () => {
    const { session, notifier, experimentId } = await fixture()
    await notifier.runCompleted(report({ meta: { experimentId, judge: { conditions: [], samples: 0 } } }), session.id)
    expect(session.snapshotEvents().map(evalLifecycleNoticeOf).filter(value => value !== undefined).map(value => value.stage)).toEqual(['run-completed'])
    await notifier.runCompleted(report({ runId: 'run-cancelled', meta: { experimentId, cancelled: true } }), session.id)
    expect(session.snapshotEvents().map(evalLifecycleNoticeOf).filter(value => value !== undefined)).toHaveLength(1)
    await notifier.humanFinal({ runId: 'run-alpha', ticket: 'ticket-1', experimentId, originSession: null, duplicate: false })
    expect(session.snapshotEvents().map(evalLifecycleNoticeOf).filter(value => value !== undefined)).toHaveLength(1)
  })

  it('rejects malformed notices without hiding valid ones', async () => {
    const { session } = await fixture()
    appendPluginRecord(session, EVAL_LIFECYCLE_RECORD, { version: 1, stage: 'unknown' } as never)
    expect(session.snapshotEvents().map(evalLifecycleNoticeOf)).toEqual([undefined])
  })

  it('reads the same notifications back through real JSONL persistence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eval-lifecycle-jsonl-'))
    dirs.push(root)
    const { ctx, session, notifier, experimentId, handle } = await fixture(root)
    await notifier.runCompleted(report({ meta: { experimentId, judge: { conditions: ['judge'], samples: 1 } } }), session.id)
    await notifier.humanFinal({ runId: 'run-alpha', ticket: 'ticket-1', experimentId, originSession: session.id, duplicate: false })
    await ctx.sessions.flush(session)
    await handle!.close()
    await ctx.fiber.dispose()

    const reopened = new Context()
    contexts.push(reopened)
    await reopened.plugin(SessionStore)
    await reopened.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    const reader = await reopened.sessionPersistence.open(session.id, 'read')
    const events = (await reader.read(0)).events
    await reader.close()
    expect(events.filter(event => event.ignorable === true)).toHaveLength(3)
    expect(events.map(pluginRecordOf).filter(value => value !== undefined)).toHaveLength(3)
    expect(events.map(evalLifecycleNoticeOf).filter(value => value !== undefined).map(value => value.stage))
      .toEqual(['run-completed', 'judge-completed', 'human-final'])
    await reopened.fiber.dispose()
  })
})
