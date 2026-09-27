import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { DatasetsFace } from '../src/faces.ts'
import {
  classifyMaterials, listItemMaterials, previewJudgePrompt, readDatasetFile, readJudgePrompt, rubricRows,
} from '../src/item-materials.ts'
import { judgedCriteria } from '../src/judge.ts'

const RUBRIC = `schema_version: dataseek.rubric/2
task_id: F2
items:
  - {id: A1, weight: 3, kind: llm-draft, criterion: design, evidence: "stage1.md"}
  - {id: B1, weight: 2, kind: llm-draft, criterion: plan, evidence: "stage2.json:iterations"}
  - {id: B2, weight: 4, kind: human, criterion: judgement, evidence: "stage2.md"}
  - {id: C1, weight: 18, kind: objective, criterion: core, evidence: "<格子>/verify.json 里 must_satisfy.core"}
  - {id: D1, weight: 5, kind: llm-draft, criterion: delivered, evidence: "<格子>/verify.json"}
  - {id: X, weight: 0, kind: objective, veto: true, criterion: no patch, evidence: "git status"}
`
const RUN_IN = ['stage3', 'stage4']
const COMMIT = 'c'.repeat(40)

function face(over: Partial<DatasetsFace> = {}): DatasetsFace {
  return {
    snapshot: async () => { throw new Error('unused') },
    worktreePath: async () => { throw new Error('unused') },
    show: async () => ({
      items: [{
        id: 'F2',
        layers: {
          visible: ['task.md', 'standards.yml'],
          verify: ['probes/a.mjs', 'checklist.yml'],
          grading: ['rubric.yml', 'rubric.md', 'oracle/notes.md'],
        },
        metadata: { title: 'room', phasesUsed: ['stage1', 'stage2', 'stage3', 'stage4'], runIn: RUN_IN },
      }],
      datasetLayers: { visible: ['prompts/stage1.md', 'prompts/stage2.md'], verify: ['helpers/x.mjs'] },
    }),
    read: async (_scope, query) => ({ content: query.path === 'rubric.yml' ? RUBRIC : `# ${query.path}`, commit: COMMIT }),
    readPassthrough: async (_scope, _id, path) => {
      if (path === 'schemas/stage1.json' || path === 'schemas/stage2.json') return { content: '{}', commit: COMMIT }
      throw new Error('not found')
    },
    ...over,
  }
}
const pin = (datasets: DatasetsFace | undefined = face()) => ({ datasets, repo: '/repo', datasetId: 'ds', commit: COMMIT })

describe('item materials drawer (T84 §三)', () => {
  it('sorts every file into who reads it', () => {
    const files = classifyMaterials({
      itemLayers: { visible: ['task.md', 'prompts/extra.md'], verify: ['probes/a.mjs'], grading: ['rubric.yml', 'oracle/notes.md'] },
      datasetLayers: { visible: ['prompts/stage1.md', 'README.md'], verify: ['helpers/x.mjs'] },
      rubricPath: 'rubric.yml',
      phases: ['stage1'],
      schemas: ['schemas/stage1.json'],
    })
    const tab = (path: string) => files.find(file => file.path === path)
    expect(tab('task.md')?.tab).toBe('task')
    expect(tab('prompts/extra.md')?.tab).toBe('stages')
    expect(tab('prompts/stage1.md')).toMatchObject({ tab: 'stages', source: 'dataset' })
    // A set-level visible file that is not a stage prompt is not an item material.
    expect(tab('README.md')).toBeUndefined()
    expect(tab('schemas/stage1.json')).toMatchObject({ tab: 'stages', source: 'passthrough' })
    expect(tab('helpers/x.mjs')).toMatchObject({ tab: 'probes', source: 'dataset' })
    expect(tab('rubric.yml')?.tab).toBe('rubric')
    expect(tab('oracle/notes.md')?.tab).toBe('reference')
  })

  it('marks the rubric leaves a stage1/2 run does not score', () => {
    const rows = new Map(rubricRows(RUBRIC, { runIn: RUN_IN, planStages: ['stage1', 'stage2'] }).map(row => [row.id, row]))
    expect(rows.get('A1')?.inScope).toBe(true)
    expect(rows.get('C1')).toMatchObject({ inScope: false, stages: RUN_IN })
    expect(rows.get('X')).toMatchObject({ inScope: true, veto: true, stages: null })
    expect(rubricRows(RUBRIC, { runIn: RUN_IN, planStages: null }).every(row => row.inScope)).toBe(true)
  })

  it('lists the materials at the pinned commit, schemas through the passthrough', async () => {
    const view = await listItemMaterials(pin(), { experimentId: 'e', item: 'F2', planStages: ['stage1', 'stage2'] })
    expect(view.runStages).toEqual(['stage1', 'stage2'])
    expect(view.files.filter(file => file.source === 'passthrough').map(file => file.path)).toEqual(['schemas/stage1.json', 'schemas/stage2.json'])
    expect(view.rubric?.rows.filter(row => !row.inScope).map(row => row.id)).toEqual(['C1', 'D1'])
    const bare = await listItemMaterials(pin(face({ readPassthrough: undefined })), { experimentId: 'e', item: 'F2', planStages: null })
    expect(bare.files.some(file => file.source === 'passthrough')).toBe(false)
    expect(bare.notes.join(' ')).toContain('schemas/')
    await expect(listItemMaterials({ ...pin(), datasets: undefined }, { experimentId: 'e', item: 'F2', planStages: null })).rejects.toThrow(/datasets service/)
  })

  it('reads text inline, refuses binaries and anything past schemas/ outside the layers', async () => {
    const base = { experimentId: 'e', item: 'F2', source: 'item' as const, layer: 'visible' }
    expect((await readDatasetFile(pin(), { ...base, path: 'task.md' })).text).toBe('# task.md')
    expect((await readDatasetFile(pin(), { ...base, path: 'shot.png' })).kind).toBe('binary')
    await expect(readDatasetFile(pin(), { ...base, source: 'passthrough', layer: 'schemas', path: '../secret.json' })).rejects.toThrow(/schemas/)
    await expect(readDatasetFile(pin(), { ...base, layer: 'private', path: 'a.md' })).rejects.toThrow(/unknown layer/)
    await expect(readDatasetFile(pin(), { ...base, item: null, path: 'a.md' })).rejects.toThrow(/item id/)
    const big = face({ read: async () => ({ content: 'x'.repeat(3_000_000), commit: COMMIT }) })
    const cut = await readDatasetFile(pin(big), { ...base, path: 'task.md' })
    expect(cut.truncated).toBe(true)
  })
})

describe('judge prompt, before and after (T84 §四)', () => {
  it('sends the judge only the in-scope judge criteria', () => {
    const scoped = judgedCriteria(RUBRIC, { task: 'F2', runIn: RUN_IN, planStages: ['stage1', 'stage2'] })
    expect(scoped.criteria.map(c => c.id)).toEqual(['A1', 'B1'])
    expect(scoped.outOfScope).toEqual(['D1'])
    expect(judgedCriteria(RUBRIC, { task: 'F2', runIn: RUN_IN }).criteria.map(c => c.id)).toEqual(['A1', 'B1', 'D1'])
  })

  it('previews the prompt with a slot for each player material file', async () => {
    const view = await previewJudgePrompt(pin(), { experimentId: 'e', item: 'F2', judge: 'judge-a', planStages: ['stage1'] })
    expect(view.criteria).toEqual(['A1'])
    expect(view.outOfScope).toEqual(['B1', 'D1'])
    const text = view.segments.map(segment => (segment.kind === 'text' ? segment.text : '')).join('\n')
    expect(text).toMatch(/^## 判据/m)
    expect(text).toMatch(/^## 材料/m)
    expect(text).toMatch(/^## 输出要求/m)
    // The player's material is a slot, not placeholder text in a fence (T85).
    expect(view.segments.filter(segment => segment.kind === 'material')).toEqual([{ kind: 'material', path: 'stage1.json' }, { kind: 'material', path: 'stage1.md' }])
    expect(text).not.toContain('选手提交')
    expect(text).not.toContain('stage2.md')
  })

  describe('reading the prompt.md a cell received', () => {
    let root = ''
    afterEach(async () => { if (root !== '') await rm(root, { recursive: true, force: true }) })

    it('lists the samples, reads the chosen one, refuses escapes', async () => {
      root = await mkdtemp(join(tmpdir(), 'eval-judge-prompt-'))
      const cell = join(root, 'judge', 'run-1', 'm-1', 'attempt-1')
      for (const sample of ['sample-1', 'sample-2']) {
        await mkdir(join(cell, 'judge-a', sample), { recursive: true })
        await writeFile(join(cell, 'judge-a', sample, 'prompt.md'), `# 盲评任务 ${sample}`)
      }
      const first = await readJudgePrompt(root, { runId: 'run-1', missionId: 'm-1', attempt: 1 })
      expect(first.samples.map(s => s.sample)).toEqual(['sample-1', 'sample-2'])
      expect(first.text).toBe('# 盲评任务 sample-1')
      const second = await readJudgePrompt(root, { runId: 'run-1', missionId: 'm-1', attempt: 1, sample: 'sample-2' })
      expect(second.text).toContain('sample-2')
      expect((await readJudgePrompt(root, { runId: 'run-1', missionId: 'm-2', attempt: 1 })).note).toMatch(/没有判官目录/)
      await expect(readJudgePrompt(root, { runId: '..', missionId: 'm-1', attempt: 1 })).rejects.toThrow(/plain path segment/)
      await expect(readJudgePrompt(root, { runId: 'run-1', missionId: 'm-1', attempt: 0 })).rejects.toThrow(/attempt/)

      // A prompt.md that links out of the run's judge tree is refused.
      const outside = join(root, 'outside')
      await mkdir(outside, { recursive: true })
      await writeFile(join(outside, 'prompt.md'), 'secret')
      await mkdir(join(cell, 'judge-a', 'sample-3'), { recursive: true })
      await symlink(join(outside, 'prompt.md'), join(cell, 'judge-a', 'sample-3', 'prompt.md'))
      await expect(readJudgePrompt(root, { runId: 'run-1', missionId: 'm-1', attempt: 1, sample: 'sample-3' })).rejects.toThrow(/越出/)
    })
  })
})
