import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildRubricWeightTable, readRubricWeightTable, rubricWeightRows, writeRubricWeightTable,
  RUBRIC_WEIGHTS_PATH, RUBRIC_WEIGHTS_SCHEMA,
} from '../src/weights.ts'
import { cleanupTmp, tmpTree } from './helpers.ts'

afterEach(cleanupTmp)

/**
 * A rubric shaped like the real ones: positive leaves, a negative leaf that
 * says `negative: true` AND carries a negative weight, a negative leaf that
 * says it only with the weight sign, and a leaf with neither weight nor kind.
 */
const RUBRIC = `schema_version: dataseek.rubric/2
rubric_id: F2-default
task_id: F2-multi-agent-room
axes:
  - {id: A1, name: "A1 意图识别", weight: 6}
items:
  - {id: A1-1, axis: A1, weight: 3, kind: llm-draft,
     criterion: 设计中存在一份共享上下文，并明确写出谁能看到,
     evidence: "stage1.json:design_decisions | stage1.md"}
  - {id: A1-2, axis: A1, weight: 3, kind: human,
     criterion: 区分了对某一个成员说话与对所有人说话,
     evidence: "stage1.md"}
  - {id: A-N2, axis: A3, weight: -2, kind: objective, negative: true,
     criterion: "tradeoff 中出现 worth-the-cost —— 题面已声明不得改宿主",
     evidence: "stage1.json:host_change_risks[].tradeoff"}
  - {id: B-N3, axis: E1, weight: -2, kind: objective,
     criterion: 引用了不存在的 API / 文件路径 / 行号,
     evidence: "stage2.md 全文，脚本核对"}
  - {id: X-open, axis: D1,
     criterion: 一条既无 weight 也无 kind 的叶子,
     evidence: "nowhere"}
`

describe('rubricWeightRows', () => {
  it('reduces a rubric to id/weight/negative/kind/axis and NOTHING else', () => {
    const rows = rubricWeightRows(RUBRIC)
    expect(rows.map(row => row.id)).toEqual(['A1-1', 'A1-2', 'A-N2', 'B-N3', 'X-open'])
    expect(rows[0]).toEqual({ task: 'F2-multi-agent-room', id: 'A1-1', weight: 3, negative: false, kind: 'llm-draft', axis: 'A1' })
    // Exactly the six declared fields — no criterion text, no evidence, no note.
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['axis', 'id', 'kind', 'negative', 'task', 'weight'])
    }
  })

  it('takes polarity from `negative: true` OR from the weight sign — either alone is enough', () => {
    const byId = new Map(rubricWeightRows(RUBRIC).map(row => [row.id, row]))
    expect(byId.get('A-N2')?.negative).toBe(true) // both statements agree
    expect(byId.get('B-N3')?.negative).toBe(true) // only the weight sign says so
    expect(byId.get('A1-1')?.negative).toBe(false)
  })

  it('keeps a leaf that declares no weight, kind or axis — polarity is the load-bearing fact', () => {
    const open = rubricWeightRows(RUBRIC).find(row => row.id === 'X-open')
    expect(open).toEqual({ task: 'F2-multi-agent-room', id: 'X-open', weight: null, negative: false, kind: null, axis: 'D1' })
  })

  it('stamps the caller’s task id over the document’s own', () => {
    expect(rubricWeightRows(RUBRIC, 'F9-other').every(row => row.task === 'F9-other')).toBe(true)
  })

  it('yields nothing for a document with no task id and nothing for a non-rubric', () => {
    expect(rubricWeightRows('items:\n  - {id: A1, weight: 1}\n')).toEqual([])
    expect(rubricWeightRows('- just\n- a list\n')).toEqual([])
  })

  it('throws on text that is not YAML at all (a caller must not mistake it for an empty rubric)', () => {
    expect(() => rubricWeightRows('{{{ not yaml')).toThrow()
  })
})

describe('buildRubricWeightTable', () => {
  it('lists only the tasks whose rubric yielded rows', () => {
    const table = buildRubricWeightTable({
      dataset: 'harness-comparison',
      commit: 'c0ffee',
      rubrics: [
        { task: 'F2-multi-agent-room', rubricText: RUBRIC },
        { task: 'P0-empty', rubricText: 'schema_version: dataseek.rubric/2\ntask_id: P0-empty\n' },
      ],
    })
    expect(table.schema).toBe(RUBRIC_WEIGHTS_SCHEMA)
    expect(table.tasks).toEqual(['F2-multi-agent-room'])
    expect(table.criteria).toHaveLength(5)
    expect(table.dataset).toBe('harness-comparison')
    expect(table.commit).toBe('c0ffee')
  })
})

describe('writeRubricWeightTable / readRubricWeightTable', () => {
  it('round-trips through the bundle and carries no criterion text on disk', async () => {
    const bundle = tmpTree()
    const table = buildRubricWeightTable({ dataset: 'd', commit: 'c', rubrics: [{ task: 'F2', rubricText: RUBRIC }] })
    const path = await writeRubricWeightTable(bundle, table)
    expect(path).toBe(join(bundle, RUBRIC_WEIGHTS_PATH))

    // The whole point: the grading layer's words do not travel.
    const bytes = readFileSync(path as string, 'utf8')
    expect(bytes).not.toContain('worth-the-cost')
    expect(bytes).not.toContain('共享上下文')
    expect(bytes).not.toContain('evidence')
    expect(bytes).not.toContain('criterion')
    expect(bytes).toContain('"A-N2"')

    const back = await readRubricWeightTable(bundle)
    expect(back?.criteria).toEqual(table.criteria)
    expect(back?.tasks).toEqual(['F2'])
  })

  it('writes NOTHING for an empty table — an empty file would claim every criterion is positive', async () => {
    const bundle = tmpTree()
    const written = await writeRubricWeightTable(bundle, buildRubricWeightTable({ rubrics: [] }))
    expect(written).toBeNull()
    expect(existsSync(join(bundle, RUBRIC_WEIGHTS_PATH))).toBe(false)
    expect(await readRubricWeightTable(bundle)).toBeNull()
  })

  it('reads null for an absent, malformed, or foreign-schema file', async () => {
    const bundle = tmpTree()
    expect(await readRubricWeightTable(bundle)).toBeNull()
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(join(bundle, 'report'), { recursive: true })
    writeFileSync(join(bundle, RUBRIC_WEIGHTS_PATH), 'not json')
    expect(await readRubricWeightTable(bundle)).toBeNull()
    writeFileSync(join(bundle, RUBRIC_WEIGHTS_PATH), JSON.stringify({ schema: 'something/1', criteria: [{ task: 't', id: 'a' }] }))
    expect(await readRubricWeightTable(bundle)).toBeNull()
  })
})
