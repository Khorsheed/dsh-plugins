import { describe, expect, it } from 'vitest'
import { planItemFacts, rubricFacts } from '../src/plan-items.ts'
import { buildRubricWeightTable, inStageScope, leafStages, rubricWeightRows } from '../src/weights.ts'
import type { DatasetsFace } from '../src/faces.ts'

/**
 * A rubric with the SHAPE of harness-comparison's F2 — the same leaf ids,
 * weights, kinds and evidence pointers (the evidence is what binds a leaf to
 * a stage), with the criterion text replaced: stage1 30, stage2 35 (two
 * leaves read both stage files), stage3/4 35 through the cell's verify.json,
 * negatives, and a stage-free veto and repo probe.
 */
const F2_SHAPED = `schema_version: dataseek.rubric/2
task_id: F2-multi-agent-room
items:
  - {id: A1-1, weight: 3, kind: llm-draft, criterion: c, evidence: "stage1.json:design_decisions | stage1.md"}
  - {id: A1-2, weight: 3, kind: llm-draft, criterion: c, evidence: "stage1.md"}
  - {id: A1-3, weight: 2, kind: llm-draft, criterion: c, evidence: "stage1.md"}
  - {id: A1-4, weight: 1, kind: llm-draft, criterion: c, evidence: "stage1.md"}
  - {id: A1-5, weight: 1, kind: llm-draft, criterion: c, evidence: "stage1.md"}
  - {id: A1-6, weight: 2, kind: llm-draft, criterion: c, evidence: "stage1.md"}
  - {id: A1-7, weight: 2, kind: llm-draft, criterion: c, evidence: "stage1.md"}
  - {id: A1-8, weight: 1, kind: llm-draft, criterion: c, evidence: "stage1.md"}
  - {id: A2-1, weight: 3, kind: objective, criterion: c, evidence: "stage1.json:out_of_scope"}
  - {id: A2-2, weight: 2, kind: human, criterion: c, evidence: "stage1.json:out_of_scope"}
  - {id: A3-1, weight: 2, kind: objective, criterion: c, evidence: "stage1.json:host_change_risks"}
  - {id: A3-2, weight: 4, kind: human, criterion: c, evidence: "stage1.json:host_change_risks + stage2.json:stage1_risks_resolved"}
  - {id: A3-3, weight: 2, kind: objective, criterion: c, evidence: "stage1.json:host_change_risks[].tradeoff"}
  - {id: A3-4, weight: 2, kind: human, criterion: c, evidence: "stage1.md"}
  - {id: A-N1, weight: -3, kind: human, negative: true, criterion: c, evidence: "stage1.md vs stage1.json:host_change_risks"}
  - {id: A-N2, weight: -2, kind: objective, negative: true, criterion: c, evidence: "stage1.json:host_change_risks[].tradeoff"}
  - {id: B1-1, weight: 5, kind: objective, criterion: c, evidence: "stage2.json:feasible"}
  - {id: B2-1, weight: 2, kind: human, criterion: c, evidence: "stage2.json:mechanisms_considered"}
  - {id: B2-2, weight: 2, kind: human, criterion: c, evidence: "stage2.json:mechanisms_considered"}
  - {id: B2-3, weight: 2, kind: human, criterion: c, evidence: "stage2.json:mechanisms_considered"}
  - {id: B2-4, weight: 1, kind: human, criterion: c, evidence: "stage2.json:mechanisms_considered"}
  - {id: B2-5, weight: 2, kind: objective, criterion: c, evidence: "stage2.json:mechanisms_considered[]"}
  - {id: B3-1, weight: 3, kind: human, criterion: c, evidence: "stage2.json:mechanisms_considered | stage2.md"}
  - {id: B3-2, weight: 5, kind: human, criterion: c, evidence: "stage2.json:mechanisms_considered[].verdict"}
  - {id: B3-3, weight: 3, kind: human, criterion: c, evidence: "stage2.json:mechanisms_considered | stage2.md"}
  - {id: B4-1, weight: 3, kind: objective, criterion: c, evidence: "stage1.json:host_change_risks vs stage2.json:stage1_risks_resolved"}
  - {id: B4-2, weight: 2, kind: human, criterion: c, evidence: "stage2.json:stage1_risks_resolved + 判定结果"}
  - {id: B5-1, weight: 2, kind: objective, criterion: c, evidence: "stage2.json:iterations[].standards_covered vs standards.yml:must_satisfy.core"}
  - {id: B5-2, weight: 2, kind: llm-draft, criterion: c, evidence: "stage2.json:iterations[].deliverable"}
  - {id: B5-3, weight: 1, kind: objective, criterion: c, evidence: "stage2.json:iterations[].estimated_effort"}
  - {id: B-N1, weight: -3, kind: human, negative: true, criterion: c, evidence: "stage2.md"}
  - {id: B-N2, weight: -2, kind: human, negative: true, criterion: c, evidence: "stage2.md"}
  - {id: B-N4, weight: -2, kind: objective, negative: true, criterion: c, evidence: "../verify/probes/stats-crosscheck.mjs 的 verdict"}
  - {id: B-N3, weight: -2, kind: objective, negative: true, criterion: c, evidence: "stage2.md 全文，脚本核对"}
  - {id: C1, weight: 18, kind: objective, criterion: c, evidence: "<格子>/verify.json 里 must_satisfy.core 各条的判定"}
  - {id: C2, weight: 7, kind: objective, criterion: c, evidence: "<格子>/verify.json 里 must_satisfy.bonus 各条的判定"}
  - {id: C3, weight: 6, kind: objective, criterion: c, evidence: "<格子>/verify.json 里 must_not_break 各条的判定"}
  - {id: C4, weight: 4, kind: objective, criterion: c, evidence: "<格子>/verify.json 里 self_test 的判定"}
  - {id: X-no-patch, weight: 0, kind: objective, veto: true, criterion: c, evidence: "git status --porcelain"}
`
const RUN_IN = ['stage3', 'stage4']

describe('stage scope — which rubric leaves a run scores (T84)', () => {
  it('binds a leaf to the stage files its evidence names, verify.json to runIn, else to no stage', () => {
    const rows = new Map(rubricWeightRows(F2_SHAPED, undefined, { runIn: RUN_IN }).map(row => [row.id, row.stages]))
    expect(rows.get('A1-2')).toEqual(['stage1'])
    expect(rows.get('A3-2')).toEqual(['stage1', 'stage2'])
    expect(rows.get('B1-1')).toEqual(['stage2'])
    expect(rows.get('C1')).toEqual(['stage3', 'stage4'])
    expect(rows.get('B-N4')).toBeNull()
    expect(rows.get('X-no-patch')).toBeNull()
  })

  it('lets an explicit leaf stage win over its evidence', () => {
    expect(leafStages({ stage: 'stage4', evidence: 'stage1.md' })).toEqual(['stage4'])
    expect(leafStages({ stages: ['stage2', 'stage1'], evidence: 'x' })).toEqual(['stage1', 'stage2'])
    // verify.json without a runIn binds to nothing — it cannot be placed.
    expect(leafStages({ evidence: '<格子>/verify.json' })).toBeNull()
  })

  it('scopes a leaf in only when every stage it judges runs', () => {
    expect(inStageScope(['stage1', 'stage2'], ['stage1', 'stage2'])).toBe(true)
    expect(inStageScope(['stage1', 'stage2'], ['stage1'])).toBe(false)
    expect(inStageScope(null, ['stage1'])).toBe(true)
    expect(inStageScope(['stage3'], null)).toBe(true)
    expect(inStageScope(['stage3'], [])).toBe(true)
  })

  it('F2 at stage1/2 has a full score of 65', () => {
    const facts = rubricFacts(F2_SHAPED, 'F2-multi-agent-room', { runIn: RUN_IN, planStages: ['stage1', 'stage2'] })
    expect(facts.fullScore).toBe(65)
    expect(facts.fullScoreAll).toBe(100)
    // C1–C4 are the out-of-scope leaves; the veto and the repo probe stay.
    expect(facts.outOfScope).toBe(4)
    expect(facts.criteria.total).toBe(35)
    expect(facts.criteria.objective).toBe(12)
  })

  it('F2 over all four stages has a full score of 100', () => {
    const facts = rubricFacts(F2_SHAPED, 'F2-multi-agent-room', { runIn: RUN_IN, planStages: ['stage1', 'stage2', 'stage3', 'stage4'] })
    expect(facts.fullScore).toBe(100)
    expect(facts.outOfScope).toBe(0)
    expect(facts.criteria.total).toBe(39)
  })

  it('falls back to every criterion when the plan names no stages', () => {
    for (const planStages of [null, [], undefined]) {
      const facts = rubricFacts(F2_SHAPED, 'F2-multi-agent-room', { runIn: RUN_IN, planStages })
      expect(facts.fullScore).toBe(100)
      expect(facts.outOfScope).toBe(0)
    }
    expect(rubricFacts(F2_SHAPED, 'F2-multi-agent-room').fullScore).toBe(100)
  })

  it('carries the scope into the design page facts: 65/100 and the stages this run executes', async () => {
    const face: DatasetsFace = {
      snapshot: async () => { throw new Error('unused') },
      worktreePath: async () => { throw new Error('unused') },
      show: async () => ({
        items: [{
          id: 'F2-multi-agent-room',
          layers: { visible: ['task.md'], verify: [], grading: ['grading/rubric.yml'] },
          metadata: { title: 'room', phasesUsed: ['stage1', 'stage2', 'stage3', 'stage4'], runIn: RUN_IN },
        }],
      }),
      read: async (_scope, query) => ({ content: query.layer === 'grading' ? F2_SHAPED : '# task', commit: 'c1' }),
    }
    const scoped = await planItemFacts({
      datasets: face, repo: '/repo', datasetId: 'ds', commit: 'c'.repeat(40), items: ['F2-multi-agent-room'], planStages: ['stage1', 'stage2'],
    })
    expect(scoped.items[0]).toMatchObject({
      fullScore: 65, fullScoreAll: 100, criteriaOutOfScope: 4,
      phases: ['stage1', 'stage2', 'stage3', 'stage4'], runStages: ['stage1', 'stage2'],
    })
    const unscoped = await planItemFacts({
      datasets: face, repo: '/repo', datasetId: 'ds', commit: 'c'.repeat(40), items: ['F2-multi-agent-room'],
    })
    expect(unscoped.items[0]).toMatchObject({ fullScore: 100, fullScoreAll: 100, criteriaOutOfScope: 0, runStages: null })
  })

  it('records the leaf stages and the plan scope on the derived bundle table', () => {
    const table = buildRubricWeightTable({
      rubrics: [{ task: 'F2', rubricText: F2_SHAPED, runIn: RUN_IN }], planStages: ['stage1', 'stage2'],
    })
    expect(table.planStages).toEqual(['stage1', 'stage2'])
    expect(table.criteria.find(row => row.id === 'C3')?.stages).toEqual(['stage3', 'stage4'])
  })
})
