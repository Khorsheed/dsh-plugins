import { describe, expect, it } from 'vitest'
import { pickTaskPath, planEstimate, planItemFacts, rubricFacts, TASK_TEXT_CAP } from '../src/plan-items.ts'
import type { DatasetsFace, MissionRunListFace } from '../src/faces.ts'

const RUBRIC = `task_id: P0
items:
  - {id: A1, axis: x, weight: 30, kind: objective, criterion: a}
  - {id: B2, axis: x, weight: 10, kind: llm-draft, criterion: b}
  - {id: C2, axis: x, weight: 5, kind: human, criterion: c}
  - {id: D1, axis: x, weight: 0, kind: llm-draft, criterion: d}
  - {id: N1, axis: x, weight: -6, kind: objective, negative: true, criterion: n}
`

function datasetsFace(overrides: Partial<{ task: string; failRubric: boolean }> = {}): DatasetsFace & { scopes: unknown[] } {
  const scopes: unknown[] = []
  return {
    scopes,
    snapshot: async () => { throw new Error('unused') },
    worktreePath: async () => { throw new Error('unused') },
    show: async (scope) => {
      scopes.push(scope)
      return {
        items: [
          {
            id: 'P0',
            layers: { visible: ['task.md', 'notes/extra.md'], verify: ['checks/checklist.yml'], grading: ['answers/rubric.yml'] },
            metadata: { title: 'count files', taxonomy: { level: 'P0' }, phasesUsed: ['stage1', 'stage2'], runIn: ['stage2'] },
          },
          { id: 'F2', layers: { visible: ['brief.md'], verify: ['probes/a.mjs', 'probes/b.sh'], grading: [] } },
        ],
        datasetLayers: { verify: ['helpers/lib.mjs'] },
      }
    },
    read: async (_scope, query) => {
      if (query.layer === 'grading') {
        if (overrides.failRubric === true) throw new Error('layer refused')
        return { content: RUBRIC, commit: 'c1' }
      }
      return { content: overrides.task ?? `# ${query.item}`, commit: 'c1' }
    },
  }
}

describe('用哪些题 per-item facts', () => {
  it('picks task.md first, else the shortest markdown file', () => {
    expect(pickTaskPath(['a/long.md', 'task.md'])).toBe('task.md')
    expect(pickTaskPath(['brief.md', 'notes/extra.md'])).toBe('brief.md')
    expect(pickTaskPath(['data.json'])).toBeNull()
  })

  it('counts rubric leaves by kind; the full score is Σ positive weights', () => {
    expect(rubricFacts(RUBRIC, 'P0')).toEqual({
      criteria: { total: 5, objective: 2, judge: 2, human: 1 },
      fullScore: 45,
    })
  })

  it('reads title, shape, rubric, probes and task text through the face, all three layers named', async () => {
    const face = datasetsFace()
    const view = await planItemFacts({ datasets: face, repo: '/repo', datasetId: 'ds', commit: 'c'.repeat(40), items: ['P0', 'F2', 'X9'] })
    expect(face.scopes).toEqual([{ repo: '/repo', layers: ['visible', 'verify', 'grading'] }])
    expect(view.items[0]).toEqual({
      id: 'P0', title: 'count files', level: 'P0', stages: 2, container: true,
      criteria: { total: 5, objective: 2, judge: 2, human: 1 }, probes: 0, fullScore: 45,
      task: '# P0', taskPath: 'task.md',
    })
    // Its own two probes; the shared library is not a probe.
    expect(view.items[1]).toMatchObject({ id: 'F2', title: null, probes: 2, criteria: null, task: '# F2', taskPath: 'brief.md' })
    expect(view.items[2]).toMatchObject({ id: 'X9', title: null, criteria: null, task: null })
    expect(view.notes).toEqual([
      'item F2 ships no rubric in its grading layer',
      'item X9 is not in the dataset at ccccccc',
    ])
  })

  it('degrades: no face, an unreadable rubric, a task text over the cap', async () => {
    const none = await planItemFacts({ datasets: undefined, repo: '/r', datasetId: 'ds', commit: 'c1', items: ['P0'] })
    expect(none.items[0]).toMatchObject({ id: 'P0', title: null })
    expect(none.notes[0]).toMatch(/no datasets service/)

    const view = await planItemFacts({
      datasets: datasetsFace({ failRubric: true, task: 'x'.repeat(TASK_TEXT_CAP + 10) }),
      repo: '/r', datasetId: 'ds', commit: 'c1', items: ['P0'],
    })
    expect(view.items[0]?.criteria).toBeNull()
    expect(view.items[0]?.task?.length).toBe(TASK_TEXT_CAP + 3)
    expect(view.notes).toEqual(['the rubric of P0 could not be read: layer refused'])
  })
})

function delegation(durationMs: number, outputTokens: number) {
  return { kind: 'delegation', durationMs, usage: { outputTokens } }
}

function missionFace(runs: Record<string, {
  meta: Record<string, unknown>
  rows: Array<{ id: string; condition: string; task: string; state: string; attempt?: number; payload: unknown[] }>
}>): MissionRunListFace {
  return {
    runList: () => Object.keys(runs).map(id => ({ id })),
    runStatus: (runId) => {
      const run = runs[runId]
      if (run === undefined) throw new Error('no run')
      return {
        run: { id: runId, state: 'open', createdAt: 0, meta: run.meta },
        rows: run.rows.map(row => ({
          id: row.id, labels: { condition: row.condition, task: row.task }, state: row.state, bucket: 'x', currentAttempt: row.attempt ?? 1,
        })),
        buckets: {},
        unreleased: [],
      }
    },
    get: (missionId, runId) => {
      const row = runs[runId as string]?.rows.find(entry => entry.id === missionId)
      if (row === undefined) throw new Error('no mission')
      return {
        mission: {
          currentAttempt: row.attempt ?? 1,
          annotations: [
            { ns: 'orchestrator', attempt: row.attempt ?? 1, payload: row.payload, createdAt: 0 },
            // A superseded attempt's spend is not the cell's.
            { ns: 'orchestrator', attempt: 99, payload: [delegation(1e9, 1e9)], createdAt: 0 },
          ],
        },
      }
    },
  }
}

describe('规模与花费 estimate', () => {
  it('one rep = Σ over the items every group answered, each pair its own mean', async () => {
    const mission = missionFace({
      r1: {
        meta: { evalVersion: 1 },
        rows: [
          { id: 'm1', condition: 'a', task: 'P0', state: 'judged', payload: [delegation(60_000, 1000), delegation(60_000, 1000)] },
          { id: 'm2', condition: 'b', task: 'P0', state: 'released', payload: [delegation(240_000, 4000)] },
          { id: 'm3', condition: 'a', task: 'P0', state: 'halted', payload: [delegation(9e9, 9e9)] },
          { id: 'm4', condition: 'z', task: 'P0', state: 'judged', payload: [delegation(9e9, 9e9)] },
          { id: 'm7', condition: 'a', task: 'F3', state: 'judged', payload: [delegation(600_000, 9000)] },
          { id: 'm8', condition: 'b', task: 'F3', state: 'judged', payload: [delegation(900_000, 11000)] },
        ],
      },
      r2: {
        meta: { evalVersion: 1 },
        rows: [{ id: 'm5', condition: 'a', task: 'P0', state: 'archived', payload: [delegation(360_000, 6000)] }],
      },
      foreign: { meta: {}, rows: [{ id: 'm6', condition: 'a', task: 'P0', state: 'judged', payload: [delegation(9e9, 9e9)] }] },
    })
    const estimate = planEstimate({ mission, conditions: ['a', 'b'], items: ['P0', 'F3'] })
    // P0: a mean (120k, 360k) = 240k + b 240k; F3: 600k + 900k.
    expect(estimate?.perRep).toEqual({ activeMs: 1_980_000, outputTokens: 28_000 })
    expect(estimate?.covered).toEqual({ activeMs: ['P0', 'F3'], outputTokens: ['P0', 'F3'] })
    expect(estimate?.samples.map(sample => `${sample.runId}/${sample.condition}/${sample.task}`))
      .toEqual(['r1/a/P0', 'r1/b/P0', 'r1/a/F3', 'r1/b/F3', 'r2/a/P0'])
  })

  it('a partial coverage is a floor: unanswered items are left out, never filled from other items', () => {
    const mission = missionFace({
      r1: {
        meta: { evalVersion: 1 },
        rows: [
          { id: 'm1', condition: 'a', task: 'P0', state: 'judged', payload: [delegation(240_000, 4000)] },
          { id: 'm2', condition: 'b', task: 'P0', state: 'judged', payload: [delegation(300_000, 5000)] },
          // Only ONE group answered F2: the item is not covered either.
          { id: 'm3', condition: 'a', task: 'F2', state: 'judged', payload: [delegation(1_200_000, 20000)] },
        ],
      },
    })
    const estimate = planEstimate({ mission, conditions: ['a', 'b'], items: ['P0', 'F2', 'F3'] })
    // P0 alone — no 3 × P0 guess for F2 and F3, and a's F2 answer is not half an item.
    expect(estimate?.perRep).toEqual({ activeMs: 540_000, outputTokens: 9000 })
    expect(estimate?.covered).toEqual({ activeMs: ['P0'], outputTokens: ['P0'] })
    expect(estimate?.items).toEqual(['P0', 'F2', 'F3'])
  })

  it('a group with no past answer means no estimate, never a partial sum', () => {
    const mission = missionFace({
      r1: { meta: { evalVersion: 1 }, rows: [{ id: 'm1', condition: 'a', task: 'P0', state: 'judged', payload: [delegation(1, 1)] }] },
    })
    expect(planEstimate({ mission, conditions: ['a', 'b'], items: ['P0'] })).toBeNull()
    expect(planEstimate({ mission: undefined, conditions: ['a'], items: ['P0'] })).toBeNull()
    expect(planEstimate({ mission: { ...mission, runList: undefined }, conditions: ['a'], items: ['P0'] })).toBeNull()
  })
})
