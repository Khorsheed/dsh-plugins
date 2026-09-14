import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EvalService } from '../src/service.ts'
import { probeRunsOf, summarizeAnnotations } from '../src/cell-detail.ts'
import { cleanupTmp, tmpTree } from './helpers.ts'

afterEach(cleanupTmp)

/**
 * I5·T35b — the cell drawer's projection and the three human gestures the
 * drawer forwards. The gestures are the interesting half: eval must forward
 * mission's demands (an auditable retry reason, the fail-closed export gate)
 * without re-implementing or relaxing either.
 */

const ANNOTATIONS = [
  {
    ns: 'orchestrator',
    attempt: 1,
    createdAt: 10,
    by: 'eval-orchestrator',
    payload: { kind: 'delegation', stage: 'stage1', childSessionId: 'child-early' },
  },
  {
    ns: 'orchestrator',
    attempt: 1,
    createdAt: 20,
    by: 'eval-orchestrator',
    payload: {
      kind: 'probes',
      where: 'unit',
      probes: [
        { probe: 'checks/p0.sh', origin: 'item', exitCode: 0, outcome: 'probe-ok', ok: true, verdicts: 3, durationMs: 120 },
        { probe: 'checks/p1.sh', origin: 'dataset', exitCode: 2, outcome: 'probe-skipped', ok: false, verdicts: 0, durationMs: 8, reason: 'not applicable this round' },
      ],
    },
  },
  { ns: 'script', attempt: 1, createdAt: 21, by: 'eval-orchestrator', payload: [{ criterion: 'C1' }, { criterion: 'C2' }] },
  { ns: 'llm-draft', attempt: 1, createdAt: 30, by: 'judge:t31-judge-twin', payload: { criterion: 'C1', pass: true } },
]

/** A mission face over one two-cell run, with the drawer's fields filled in. */
function missionFace(options: { dataDir?: string; releasable?: boolean } = {}) {
  const attempts = [
    {
      attempt: 1,
      state: 'halted',
      refs: { resource: 'unit-a', fingerprint: 'lab-env:aaaa', sessions: ['child-a'] },
      enteredAt: { pending: 1, 'stage-1': 4 },
      checkpoints: [{ name: 'stage1', at: 6 }],
      artifacts: [{ path: 'materialization.json', kind: 'materialization', addedAt: 5 }],
      history: [{ from: 'pending', to: 'ws-ready', at: 2 }],
    },
    {
      attempt: 2,
      state: 'archived',
      retry: { reason: 'the container died mid-round', category: 'infrastructure', at: 40, by: 'tab:s1' },
      refs: { resource: 'unit-b', fingerprint: 'lab-env:aaaa', sessions: ['child-b', 'child-c'] },
      enteredAt: { pending: 41, archived: 60 },
      checkpoints: [{ name: 'stage1', at: 50 }, { name: 'archive', at: 58 }],
      artifacts: [{ path: 'archive/workspace', kind: 'archive', addedAt: 59 }],
      history: [{ from: 'judged', to: 'archived', at: 60 }],
    },
  ]
  return {
    ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
    runList: () => [{ id: 'run-1' }],
    runStatus: (runId: string) => {
      if (runId !== 'run-1') throw new Error(`unknown run: ${runId}`)
      return {
        run: {
          id: 'run-1',
          state: 'active',
          createdAt: 1,
          meta: {
            evalVersion: '0.1.0-rc.1',
            datasetId: 'harness-comparison',
            conditions: [{ id: 'codex-a', sha: 'c'.repeat(64), condition: { harness: { name: 'codex' } } }],
          },
        },
        rows: [
          { id: 'p0-codex-a-rep1', labels: { task: 'P0', condition: 'codex-a', rep: '1' }, state: 'archived', bucket: 'done', currentAttempt: 2, enteredCurrentAt: 60 },
          { id: 'p0-codex-a-rep2', labels: { task: 'P0', condition: 'codex-a', rep: '2' }, state: 'pending', bucket: 'ready', currentAttempt: 1 },
        ],
        buckets: { ready: ['p0-codex-a-rep2'], scheduled: [], blocked: [], active: [], done: ['p0-codex-a-rep1'] },
        unreleased: ['p0-codex-a-rep1'],
      }
    },
    get: (missionId: string) => ({
      mission: missionId === 'p0-codex-a-rep1'
        ? { currentAttempt: 2, attempts, annotations: ANNOTATIONS, title: '整理内容包', labels: { task: 'P0' } }
        : { currentAttempt: 1, attempts: [{ attempt: 1, state: 'pending', refs: {}, enteredAt: { pending: 1 }, checkpoints: [] }], annotations: [] },
    }),
    retry: vi.fn(async () => ({ attempt: 3 })),
    isReleasable: () => options.releasable ?? false,
  }
}

/** A service over that face, plus an optional mission Remote for the export pair. */
function service(options: { dataDir?: string; releasable?: boolean; exportRemote?: unknown } = {}): EvalService {
  const mission = missionFace(options)
  return new EvalService({
    get: (name) => {
      if (name === 'mission') return mission
      if (name === 'missionRemote') return options.exportRemote
      return undefined
    },
  })
}

describe('summarizeAnnotations', () => {
  it('counts each namespace and digests its newest entry', () => {
    expect(summarizeAnnotations(ANNOTATIONS)).toEqual([
      { ns: 'llm-draft', count: 1, latestAt: 30, latest: '{ criterion, pass }', by: 'judge:t31-judge-twin' },
      { ns: 'orchestrator', count: 2, latestAt: 20, latest: 'probes', by: 'eval-orchestrator' },
      { ns: 'script', count: 1, latestAt: 21, latest: '[2]', by: 'eval-orchestrator' },
    ])
  })
})

describe('probeRunsOf', () => {
  it('carries the verify output whole — exit codes and skip reasons included', () => {
    const runs = probeRunsOf(ANNOTATIONS)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ at: 20, where: 'unit' })
    expect(runs[0]?.probes).toEqual([
      { probe: 'checks/p0.sh', origin: 'item', exitCode: 0, outcome: 'probe-ok', ok: true, verdicts: 3, durationMs: 120, error: null, reason: null },
      { probe: 'checks/p1.sh', origin: 'dataset', exitCode: 2, outcome: 'probe-skipped', ok: false, verdicts: 0, durationMs: 8, error: null, reason: 'not applicable this round' },
    ])
    // The raw block is the payload itself, not a re-rendering of the list.
    expect(JSON.parse(runs[0]?.raw ?? '{}')).toMatchObject({ kind: 'probes', where: 'unit' })
  })

  it('keeps a failed probe round too — that is the one a reader opens the drawer for', () => {
    const runs = probeRunsOf([
      { ns: 'orchestrator', attempt: 1, createdAt: 5, payload: { kind: 'probes-failed', error: 'verify layer missing' } },
    ])
    expect(runs).toHaveLength(1)
    expect(runs[0]?.raw).toContain('verify layer missing')
  })
})

describe('EvalService.cell', () => {
  it('projects one cell in full, with the current attempt\'s refs, checkpoints and child session', async () => {
    const detail = await service().cell('run-1', 'p0-codex-a-rep1', { now: 1_060 })
    expect(detail).toMatchObject({
      runId: 'run-1',
      missionId: 'p0-codex-a-rep1',
      title: '整理内容包',
      task: 'P0',
      condition: 'codex-a',
      rep: 1,
      state: 'archived',
      bucket: 'done',
      attempt: 2,
      inStateMs: 1_000,
      // The CURRENT attempt's unit, not attempt 1's.
      refs: { resource: 'unit-b', fingerprint: 'lab-env:aaaa' },
      childSessionId: 'child-c',
      releasable: false,
    })
    expect(detail.attempts.map(attempt => attempt.attempt)).toEqual([1, 2])
    expect(detail.attempts[1]?.retry).toMatchObject({ reason: 'the container died mid-round', category: 'infrastructure' })
    expect(detail.attempts[1]?.checkpoints.map(checkpoint => checkpoint.name)).toEqual(['stage1', 'archive'])
    expect(detail.attempts[0]?.artifacts).toEqual([{ path: 'materialization.json', kind: 'materialization', addedAt: 5 }])
    expect(detail.annotations.map(ns => ns.ns)).toEqual(['llm-draft', 'orchestrator', 'script'])
    expect(detail.probes).toHaveLength(1)
  })

  it('reads the material digest from the run-data tree the run loop wrote it into', async () => {
    const dataDir = tmpTree()
    const attemptDir = join(dataDir, 'runs', 'run-1', 'data', 'p0-codex-a-rep1', 'attempt-2')
    mkdirSync(attemptDir, { recursive: true })
    writeFileSync(join(attemptDir, 'materialization.json'), JSON.stringify({ sha256: 'deadbeef', files: [] }))
    const detail = await service({ dataDir }).cell('run-1', 'p0-codex-a-rep1')
    expect(detail.materializationSha).toBe('deadbeef')
  })

  it('a face with no data root reports the digest as unknown rather than guessing', async () => {
    expect((await service().cell('run-1', 'p0-codex-a-rep1')).materializationSha).toBeNull()
  })

  it('reports the release answer the ledger gives', async () => {
    expect((await service({ releasable: true }).cell('run-1', 'p0-codex-a-rep1')).releasable).toBe(true)
  })

  it('refuses a cell the run does not hold, and a composition with no mission service', async () => {
    await expect(service().cell('run-1', 'nope')).rejects.toThrow(/no cell "nope"/)
    await expect(new EvalService({ get: () => undefined }).cell('run-1', 'x')).rejects.toThrow(/no mission service/)
  })
})

describe('EvalService.cellRows', () => {
  it('narrows the table to the columns the cells page shows, from the one cells projection', () => {
    const rows = service().cellRows('run-1', { bucket: 'done' })
    expect(rows).toMatchObject({ runId: 'run-1', total: 2, matched: 1, filter: { bucket: 'done' } })
    expect(rows.rows[0]).toMatchObject({
      missionId: 'p0-codex-a-rep1', task: 'P0', condition: 'codex-a', rep: 1,
      state: 'archived', bucket: 'done', attempt: 2, childSessionId: 'child-c',
    })
    // The whole run's shape stays whole under a filter.
    expect(rows.buckets).toEqual({ done: 1, ready: 1 })
  })
})

describe('EvalService.retryCell', () => {
  it('forwards to mission with the reason, the category, and the caller tag', async () => {
    const mission = missionFace()
    const svc = new EvalService({ get: name => (name === 'mission' ? mission : undefined) })
    await expect(svc.retryCell('run-1', 'p0-codex-a-rep1', {
      reason: 'the container died mid-round',
      category: 'infrastructure',
      by: 'tab:s1',
    })).resolves.toEqual({ attempt: 3 })
    expect(mission.retry).toHaveBeenCalledWith('p0-codex-a-rep1', {
      runId: 'run-1',
      reason: 'the container died mid-round',
      category: 'infrastructure',
      by: 'tab:s1',
    })
  })

  it('refuses a blank reason — an attempt nobody can account for is worse than none', async () => {
    const mission = missionFace()
    const svc = new EvalService({ get: name => (name === 'mission' ? mission : undefined) })
    await expect(svc.retryCell('run-1', 'p0-codex-a-rep1', { reason: '   ', category: 'operator' }))
      .rejects.toThrow(/retry needs a reason/)
    expect(mission.retry).not.toHaveBeenCalled()
  })

  it('says so in words when the composition mounts no mission service', async () => {
    await expect(new EvalService({ get: () => undefined })
      .retryCell('run-1', 'c', { reason: 'x', category: 'operator' })).rejects.toThrow(/no mission service/)
  })
})

describe('EvalService.releaseCheck', () => {
  it('answers with the ledger\'s own gate', () => {
    expect(service({ releasable: true }).releaseCheck('run-1', 'p0-codex-a-rep1'))
      .toEqual({ missionId: 'p0-codex-a-rep1', releasable: true })
    expect(service().releaseCheck('run-1', 'p0-codex-a-rep1').releasable).toBe(false)
  })

  it('says so in words when the composition mounts no mission service', () => {
    expect(() => new EvalService({ get: () => undefined }).releaseCheck('run-1', 'c')).toThrow(/no mission service/)
  })
})

describe('EvalService export forwarding', () => {
  /** A stand-in for mission's Remote, with its own fail-closed gate. */
  function exportRemote() {
    const guarded = ['grading']
    return {
      exportPlan: vi.fn(async () => ({ bundleDir: '/out/run-1-bundle', guardedLayers: guarded, expectedNs: ['script'], missions: 2, attempts: 3 })),
      exportRun: vi.fn(async (_agent: unknown, request: { confirmed: string[] }) => {
        const unconfirmed = guarded.filter(layer => !request.confirmed.includes(layer))
        if (unconfirmed.length > 0) throw new Error(`mission: export refused — guarded (modelFacing: false) layer(s) not confirmed: ${unconfirmed.join(', ')}`)
        return { bundleDir: '/out/run-1-bundle', files: 9 }
      }),
    }
  }

  it('relays the plan step verbatim — the guarded set is mission\'s to decide', async () => {
    const remote = exportRemote()
    const plan = await service({ exportRemote: remote }).exportPlan({ id: 'agent' }, {
      runId: 'run-1', outDir: '/out', layers: ['visible', 'grading'],
    })
    expect(plan.guardedLayers).toEqual(['grading'])
    expect(remote.exportPlan).toHaveBeenCalledWith({ id: 'agent' }, { runId: 'run-1', outDir: '/out', layers: ['visible', 'grading'] })
  })

  it('cannot widen the gate: an unconfirmed guarded layer is still refused through eval', async () => {
    const remote = exportRemote()
    const svc = service({ exportRemote: remote })
    await expect(svc.exportRun({ id: 'agent' }, { runId: 'run-1', outDir: '/out', layers: ['grading'], confirmed: [] }))
      .rejects.toThrow(/export refused — guarded/)
    await expect(svc.exportRun({ id: 'agent' }, { runId: 'run-1', outDir: '/out', layers: ['grading'], confirmed: ['grading'] }))
      .resolves.toEqual({ bundleDir: '/out/run-1-bundle', files: 9 })
  })

  it('refuses both steps when mission\'s Remote is not mounted', async () => {
    const svc = service()
    await expect(svc.exportPlan({}, { runId: 'run-1', outDir: '/out' })).rejects.toThrow(/no mission Remote face/)
    await expect(svc.exportRun({}, { runId: 'run-1', outDir: '/out', confirmed: [] })).rejects.toThrow(/no mission Remote face/)
  })
})

describe('EvalService.itemRuns', () => {
  it('lists every eval run that answered one item, with the per-namespace verdict counts', () => {
    const answer = service().itemRuns('harness-comparison', 'P0')
    expect(answer.runs).toHaveLength(1)
    expect(answer.runs[0]).toMatchObject({ runId: 'run-1', name: 'run-1' })
    expect(answer.runs[0]?.cells.map(cell => cell.missionId)).toEqual(['p0-codex-a-rep1', 'p0-codex-a-rep2'])
    // orchestrator is bookkeeping, not a verdict source; the arrays count by length.
    expect(answer.runs[0]?.cells[0]?.verdicts).toEqual({ script: 2, 'llm-draft': 1 })
  })

  it('answers nothing for another dataset, and says why with no ledger at all', () => {
    expect(service().itemRuns('another-suite', 'P0').runs).toEqual([])
    const bare = new EvalService({ get: () => undefined }).itemRuns('harness-comparison', 'P0')
    expect(bare.runs).toEqual([])
    expect(bare.notes.some(note => note.includes('no mission service'))).toBe(true)
  })
})
