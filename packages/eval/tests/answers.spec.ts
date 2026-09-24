/**
 * I5·T75 — `cellAnswers`, the answer view's named read: one 题, every group
 * and rep, in one call.
 *
 * Pinned: the files are the judged stage files, read from the archive first
 * and cut at the cell-artifact cap with a notice; the payload carries names
 * and never a path; the verdicts are every layer as recorded with each judge
 * under its blind panel label; the numbering is the run's seeded order over
 * EVERY row, so the letters agree with the bench's.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cellAnswersView } from '../src/answers.ts'
import { ARTIFACT_MAX_BYTES } from '../src/cell-artifact.ts'
import { attemptDataDir } from '../src/cell-detail.ts'
import { EvalReadRefused } from '../src/read.ts'
import { cleanupTmp, tmpTree } from './helpers.ts'

afterEach(cleanupTmp)

const RUN = 'run-20260924-answers'

function verdict(criterion: string, pass: boolean, evidence: string) {
  return { schema: 'dataseek.verdict/1', task: 'P0', criterion, pass, evidence, by: 'x' }
}

function face(dataDir: string | undefined) {
  const annotations: Record<string, unknown[]> = {
    'p1-lean-rep1': [
      {
        ns: 'llm-draft', attempt: 1, createdAt: 30, by: 'eval-orchestrator',
        payload: { sample: 1, judgeCondition: 'judge-alpha', verdicts: [verdict('D1', true, '原文「结论是可以合并」')] },
      },
      { ns: 'script', attempt: 1, createdAt: 20, by: 'eval-orchestrator', payload: [verdict('X1', false, 'git status 不干净')] },
      { ns: 'orchestrator', attempt: 1, createdAt: 19, by: 'eval-orchestrator', payload: { kind: 'probes', where: 'host', probes: [{ probe: 'no-patch', exitCode: 1 }] } },
      // A previous attempt's verdict does not belong to this answer.
      { ns: 'llm-draft', attempt: 0, createdAt: 10, by: 'eval-orchestrator', payload: { sample: 1, judgeCondition: 'judge-alpha', verdicts: [verdict('D1', false, 'old')] } },
    ],
    'p0-full-rep1': [],
  }
  return {
    ...(dataDir === undefined ? {} : { dataDir }),
    runStatus: (runId: string) => {
      if (runId !== RUN) throw new Error(`unknown run: ${runId}`)
      return {
        run: {
          id: RUN, state: 'active', createdAt: 1, originSession: 'session-parent',
          meta: { judge: { conditions: [{ id: 'judge-alpha', sha: 'c'.repeat(64) }] } },
        },
        rows: [
          { id: 'p0-other-rep1', labels: { task: 'P9', condition: 'lean', rep: '1' }, state: 'archived', bucket: 'done', currentAttempt: 1 },
          { id: 'p1-lean-rep1', labels: { task: 'P0', condition: 'lean', rep: '1' }, state: 'archived', bucket: 'done', currentAttempt: 1 },
          { id: 'p0-full-rep1', labels: { task: 'P0', condition: 'full', rep: '1' }, state: 'archived', bucket: 'done', currentAttempt: 1 },
        ],
        buckets: {},
        unreleased: [],
      }
    },
    get: (missionId: string) => ({
      mission: {
        currentAttempt: 1,
        attempts: [{ attempt: 1, state: 'archived', refs: { sessions: [`child-${missionId}`] } }],
        annotations: annotations[missionId] ?? [],
      },
    }),
  }
}

describe('cellAnswers', () => {
  it('reads one 题: every group, its stage files by name, every verdict layer, the script output', async () => {
    const dataDir = tmpTree()
    const lean = attemptDataDir(dataDir, RUN, 'p1-lean-rep1', 1)
    mkdirSync(join(lean, 'archive', 'workspace'), { recursive: true })
    writeFileSync(join(lean, 'archive', 'workspace', 'stage1.md'), '# 方案\n\n结论是可以合并。')
    // The attempt directory's copy loses to the archive's.
    writeFileSync(join(lean, 'stage1.md'), 'stale')
    writeFileSync(join(lean, 'stage2.md'), 'x'.repeat(ARTIFACT_MAX_BYTES + 10))
    const sheet = await cellAnswersView({ mission: face(dataDir) as never, runId: RUN, task: 'P0' })

    expect(sheet.cells.map(cell => [cell.cellNo, cell.condition, cell.rep])).toEqual([[2, 'lean', 1], [3, 'full', 1]])
    const [cell] = sheet.cells
    expect(cell?.reports.map(report => report.name)).toEqual(['stage1.md', 'stage2.md'])
    expect(cell?.reports[0]?.text).toContain('结论是可以合并')
    expect(cell?.reports[1]).toMatchObject({ truncated: true, bytes: ARTIFACT_MAX_BYTES + 10 })
    expect(cell?.reports[1]?.text.length).toBe(ARTIFACT_MAX_BYTES)
    expect(cell?.reports[1]?.note).toContain('只显示开头部分')
    expect(cell?.verdicts.map(v => [v.ns, v.criterion, v.pass, v.judge])).toEqual([
      ['llm-draft', 'D1', true, '判官 A'],
      ['script', 'X1', false, null],
    ])
    expect(cell?.scripts).toHaveLength(1)
    expect(cell?.childSessionId).toBe('child-p1-lean-rep1')
    expect(cell?.parentSessionId).toBe('session-parent')
    // Names, never paths — not the data root, not a judge condition id.
    const wire = JSON.stringify(sheet)
    expect(wire).not.toContain(dataDir)
    expect(wire).not.toContain('judge-alpha')
  })

  it('says so when the ledger reports no data root, and refuses a 题 the run does not hold', async () => {
    const sheet = await cellAnswersView({ mission: face(undefined) as never, runId: RUN, task: 'P0' })
    expect(sheet.cells.every(cell => cell.reports.length === 0)).toBe(true)
    expect(sheet.notes).toHaveLength(1)
    await expect(cellAnswersView({ mission: face(undefined) as never, runId: RUN, task: 'nope' })).rejects.toBeInstanceOf(EvalReadRefused)
  })
})
