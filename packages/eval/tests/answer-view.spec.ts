/**
 * I5·T75 — the answer view as data: which paragraph a verdict hangs under,
 * how columns line up, and what the blind letters follow.
 *
 * The rule under test is the one the brief puts in a single line: a verdict
 * hangs on a paragraph ONLY when its evidence quotes that paragraph. Every
 * case below that should NOT hang is as much the point as the ones that do —
 * a guessed anchor reads exactly like a real one.
 */
import { describe, expect, it } from 'vitest'
import {
  blocksOf, criteriaOrder, hangVerdicts, letterOf, quotesOf, rowsOfQueue, rowsOfSheet, stagesOf, stemsOfRow,
  type AnswerFile,
} from '../src/client/answer-view.ts'
import type { EvalAnswerSheet, EvalAnswerVerdict, EvalJudgeQueueCell } from '../src/types.ts'

function file(name: string, text: string): AnswerFile {
  return { name, text, truncated: false, bytes: text.length, replacements: null }
}

function verdict(criterion: string, evidence: string | null, ns = 'llm-draft'): EvalAnswerVerdict {
  return { criterion, ns, pass: true, evidence, judge: '判官 A', sample: 1, at: 1 }
}

describe('blocksOf', () => {
  it('splits at blank lines and keeps a fenced block whole', () => {
    const md = '# 标题\n\n第一段\n接着\n\n```sh\necho a\n\necho b\n```\n\n末段'
    expect(blocksOf(md)).toEqual(['# 标题', '第一段\n接着', '```sh\necho a\n\necho b\n```', '末段'])
  })
})

describe('quotesOf', () => {
  it('takes every quote style, flattened, and drops spans too short to mean anything', () => {
    expect(quotesOf('报告写了「结论 是 可以 合并」，又说“两边都行”，还有 \'**关键路径**已经覆盖\'')).toEqual([
      '结论是可以合并', '关键路径已经覆盖',
    ])
    expect(quotesOf(null)).toEqual([])
    expect(quotesOf('没有引用任何原文')).toEqual([])
  })
})

describe('hangVerdicts', () => {
  const files = [
    file('stage1.json', '{"summary":"结论是可以合并","risk":"medium-high"}'),
    file('stage1.md', '# 方案\n\n我们的**结论**是可以合并。\n\n代价是多一次构建。'),
    file('stage2.md', '# 报告\n\n代价是多一次构建。'),
  ]

  it('hangs a verdict on the first markdown paragraph its quote is in, once', () => {
    const hung = hangVerdicts(files, [
      verdict('D1', '原文「结论是可以合并」成立'),
      verdict('D2', '见「代价是多一次构建」'),
    ])
    expect(hung.get(0)).toEqual({ file: 'stage1.md', block: 1 })
    // Both files carry the sentence; the verdict hangs once, at the first.
    expect(hung.get(1)).toEqual({ file: 'stage1.md', block: 2 })
  })

  it('does not hang a verdict that quotes nothing, or quotes only the json', () => {
    const hung = hangVerdicts(files, [
      verdict('D1', '整体读下来结论清楚'),
      verdict('D2', '字段 risk 写了 "medium-high"'),
      verdict('D3', '「这句话根本不在报告里」'),
    ])
    // D2 quotes a json field's value, which no paragraph holds.
    expect(hung.size).toBe(0)
  })
})

describe('rows', () => {
  const sheet: EvalAnswerSheet = {
    runId: 'run-1',
    task: 'P0',
    criteria: [{ id: 'H1', criterion: '读得懂', evidence: null, weight: null, negative: false, veto: false, note: null }],
    criteriaNote: null,
    notes: [],
    cells: [
      { cellNo: 4, condition: 'full', rep: 2 },
      { cellNo: 1, condition: 'lean', rep: 1 },
      { cellNo: 2, condition: 'full', rep: 1 },
      { cellNo: 3, condition: 'lean', rep: 2 },
    ].map(cell => ({
      ...cell,
      missionId: `${cell.condition}-${String(cell.rep)}`,
      attempt: 1,
      state: 'archived',
      bucket: 'done',
      reports: cell.condition === 'lean' ? [{ name: 'stage1.md', text: 'a', truncated: false, bytes: 1, note: null }] : [],
      verdicts: cell.condition === 'lean' ? [verdict('Z9', null, 'script')] : [],
      scripts: [],
      childSessionId: null,
      parentSessionId: null,
    })),
  }

  it('one row per rep, seeded order within it, letters restarting per row', () => {
    const rows = rowsOfSheet(sheet, { condition: 'full', rep: null })
    expect(rows.map(row => row.rep)).toEqual([1, 2])
    expect(rows.map(row => row.columns.map(column => `${column.letter}:${String(column.condition)}`))).toEqual([
      ['A:lean', 'B:full'],
      ['A:lean', 'B:full'],
    ])
    expect(rows.flatMap(row => row.columns.filter(column => column.located).map(column => column.key))).toEqual(['full-1', 'full-2'])
    expect(rows[0]?.columns.map(column => column.source)).toEqual(['script', 'none'])
  })

  it('a named rep narrows to that row', () => {
    expect(rowsOfSheet(sheet, { condition: 'lean', rep: 2 }).map(row => row.rep)).toEqual([2])
  })

  it('a stage one group skipped keeps its slot, so the next stage stays level', () => {
    const [row] = rowsOfSheet(sheet, { condition: null, rep: 1 })
    expect(row === undefined ? [] : stemsOfRow(row)).toEqual(['stage1'])
    const full = row?.columns.find(column => column.condition === 'full')
    expect(stagesOf(full?.files ?? [], ['stage1'])).toEqual([{ stem: 'stage1', no: 1, markdown: null, others: [] }])
  })

  it('lists the rubric first, then any other criterion a verdict names', () => {
    expect(criteriaOrder(sheet.criteria, rowsOfSheet(sheet, { condition: null, rep: null }))).toEqual(['H1', 'Z9'])
  })

  it('the blind queue carries no group, and its letters follow the seeded order', () => {
    const cell = (cellNo: number): EvalJudgeQueueCell => ({
      ticket: `t${String(cellNo)}`, cellNo, task: 'P0', rep: 1,
      materials: [{ path: 'stage1.md', text: 'x', replacements: 1 }],
      criteria: [], criteriaNote: null, drafts: [], humanFinal: [], graded: false, draftOnlyCriteria: [], judgeAbsent: false,
    } as unknown as EvalJudgeQueueCell)
    const [row] = rowsOfQueue([cell(7), cell(3)])
    expect(row?.columns.map(column => [column.letter, column.condition, column.key])).toEqual([['A', null, 't3'], ['B', null, 't7']])
    expect(row?.columns[0]?.files[0]?.replacements).toBe(1)
  })

  it('letters run past Z', () => {
    expect([0, 25, 26, 27].map(letterOf)).toEqual(['A', 'Z', 'AA', 'AB'])
  })
})
