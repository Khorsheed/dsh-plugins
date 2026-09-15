/**
 * I5·T37 — the judge bench's two Remote verbs: `judgeQueue` (the blind queue)
 * and `humanFinal` (the one door the `human-final` namespace has).
 *
 * Three things are worth pinning here, and they are the three the design
 * rests on.
 *
 * BLIND is a property of the PAYLOAD. The assertion is not "the page hides
 * the harness" but "the harness is not in the answer": the whole queue is
 * serialized and searched for every condition id, harness name and model name
 * the run declared. A page cannot leak what it never received, and a future
 * change that starts sending one fails here rather than in a screenshot.
 *
 * ONE de-identifier. The material the bench shows must come out of the SAME
 * {@link deidentify} the run loop feeds the LLM judge — so the test drives the
 * verb over material containing a model name and a harness alias, and checks
 * both are replaced with the same `<model>` / `<harness>` tokens the judge
 * would have seen.
 *
 * `by` IS THE SESSION. The report flags a `human-final` namespace whose
 * verdicts were all written by a `tool:` origin. A verdict recorded from this
 * bench must therefore carry the calling session (`tab:<id>`), and the write
 * must be an APPEND — a second submission adds an annotation rather than
 * editing the first.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { cellTicket, judgeQueueView, resolveTicket, writeHumanFinal } from '../src/judge-bench.ts'
import { humanCriteria, llmDraftCriteria, rubricCriteria } from '../src/judge.ts'
import { EvalRemoteService } from '../src/remote.ts'
import { analyzeBundle } from '../src/report.ts'
import { EvalService } from '../src/service.ts'
import { cleanupTmp, tmpTree } from './helpers.ts'

afterEach(cleanupTmp)

const RUN = 'run-20260915-judge'

/** Two cells of one item, one per condition — the smallest thing that blinds. */
const CELL_A = 'p0-codex-exec-rep1'
const CELL_B = 'p0-dsh-exec-rep1'

const RUBRIC = `schema: dataseek.rubric/2
items:
  - id: C1
    kind: objective
    criterion: the probe passed
  - id: D1
    kind: llm-draft
    criterion: the tradeoff section names a cost
  - id: H1
    kind: human
    criterion: 报告读起来像给同事看的，不像给模型看的
    evidence: 通读 stage2.md 的结论段
    weight: 2
  - id: H2
    kind: human
    criterion: 把协议知识推给用户
    negative: true
    veto: true
    note: 成立即缺陷存在
`

/**
 * The run's meta, as `runCreate` records it: full condition documents (which
 * is where the de-identification table comes from) and the judge panel.
 */
function metaOf(repo: string) {
  return {
    evalVersion: '0.1.0-rc.1',
    datasetId: 'harness-comparison',
    snapshot: { repo, commit: 'c0ffee1', datasetId: 'harness-comparison' },
    conditions: [
      { id: 'codex-exec', sha: 'a'.repeat(64), condition: { harness: { name: 'codex' }, model: { declared: 'gpt-5.6-sol' } } },
      { id: 'dsh-exec', sha: 'b'.repeat(64), condition: { harness: { name: 'dsh' }, model: { declared: 'deepseek-v4' } } },
    ],
    judge: { conditions: [{ id: 'judge-alpha', sha: 'c'.repeat(64) }, { id: 'judge-beta', sha: 'd'.repeat(64) }], samples: 2 },
  }
}

/** A verdict document as the ledger carries it. */
function verdict(task: string, criterion: string, pass: boolean, by: string) {
  return { schema: 'dataseek.verdict/1', task, criterion, pass, evidence: `${criterion} 的依据`, by }
}

/**
 * A mission face over one two-cell run, with llm-draft samples from both
 * judges on cell A and nothing yet on cell B.
 */
function missionFace(options: { dataDir?: string; repo?: string; annotations?: Record<string, unknown[]> } = {}) {
  const repo = options.repo ?? '/repo'
  const base: Record<string, unknown[]> = {
    [CELL_A]: [
      {
        ns: 'llm-draft', attempt: 1, createdAt: 30, by: 'eval-orchestrator',
        payload: {
          sample: 1, judgeCondition: 'judge-alpha', judgeModel: 'deepseek-v4', selfJudged: true,
          verdicts: [verdict('P0', 'D1', true, 'judge-alpha')],
        },
      },
      {
        ns: 'llm-draft', attempt: 1, createdAt: 31, by: 'eval-orchestrator',
        payload: {
          sample: 2, judgeCondition: 'judge-alpha', judgeModel: 'deepseek-v4', selfJudged: true,
          verdicts: [verdict('P0', 'D1', false, 'judge-alpha')],
        },
      },
      {
        ns: 'llm-draft', attempt: 1, createdAt: 32, by: 'eval-orchestrator',
        payload: {
          sample: 1, judgeCondition: 'judge-beta', judgeModel: 'gpt-5.6-sol', selfJudged: false,
          verdicts: [verdict('P0', 'D1', true, 'judge-beta')],
        },
      },
    ],
    [CELL_B]: [],
  }
  const annotations = { ...base, ...(options.annotations ?? {}) }
  const face = {
    ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
    annotations,
    runStatus: (runId: string) => {
      if (runId !== RUN) throw new Error(`unknown run: ${runId}`)
      return {
        run: { id: RUN, state: 'active', createdAt: 1, meta: metaOf(repo) },
        rows: [
          { id: CELL_A, labels: { task: 'P0', condition: 'codex-exec', rep: '1' }, state: 'archived', bucket: 'done', currentAttempt: 1 },
          { id: CELL_B, labels: { task: 'P0', condition: 'dsh-exec', rep: '1' }, state: 'archived', bucket: 'done', currentAttempt: 1 },
        ],
        buckets: { ready: [], scheduled: [], blocked: [], active: [], done: [CELL_A, CELL_B] },
        unreleased: [],
      }
    },
    get: (missionId: string) => ({
      mission: { currentAttempt: 1, attempts: [{ attempt: 1, state: 'archived' }], annotations: annotations[missionId] ?? [] },
    }),
    annotate: vi.fn(async (missionId: string, ns: string, payload: unknown, opts?: { runId?: string; by?: string }) => {
      const list = annotations[missionId] as unknown[]
      const entry = { ns, attempt: 1, createdAt: 99, by: opts?.by, payload }
      // mission's own rule: an identical (ns + payload) repeat on the same
      // attempt is a no-op, and the bench must report that rather than claim
      // a write.
      const duplicate = list.some(a => JSON.stringify((a as { ns: string; payload: unknown }).payload) === JSON.stringify(payload)
        && (a as { ns: string }).ns === ns)
      if (duplicate) return { added: false }
      list.push(entry)
      return { added: true }
    }),
  }
  return face
}

/** A datasets face that answers the grading layer with {@link RUBRIC}. */
function datasetsFace() {
  return {
    show: vi.fn(async () => ({ items: [{ id: 'P0', layers: { grading: ['rubric.yml'] } }] })),
    read: vi.fn(async () => ({ content: RUBRIC, commit: 'c0ffee1' })),
    snapshot: vi.fn(),
    worktreePath: vi.fn(),
  }
}

/**
 * The archived material of one cell, carrying BOTH fingerprints the run
 * declared — the model name and the harness alias — so the scrub has
 * something to do.
 */
function writeArchive(dataDir: string, missionId: string): void {
  const workspace = join(dataDir, 'runs', RUN, 'data', missionId, 'attempt-1', 'archive', 'workspace')
  mkdirSync(workspace, { recursive: true })
  writeFileSync(join(workspace, 'stage1.md'), '# 方案\n\n我是 Codex，用 gpt-5.6-sol 跑的。\n')
  writeFileSync(join(workspace, 'stage2.md'), '# 报告\n\n本轮由 dsh 编排，模型 deepseek-v4。\n')
}

function agentOf(id = 's1'): Agent {
  return { session: { id, header: {} } } as unknown as Agent
}

describe('the rubric parser is one parser', () => {
  it('splits a rubric three ways and gives each third its own reader', () => {
    // The protocol's own division: objective → probes, llm-draft → the LLM
    // judge, human → the bench. One parser, so the three cannot disagree.
    expect(llmDraftCriteria(RUBRIC).map(c => c.id)).toEqual(['D1'])
    expect(humanCriteria(RUBRIC).map(c => c.id)).toEqual(['H1', 'H2'])
    expect(rubricCriteria(RUBRIC, 'objective').map(c => c.id)).toEqual(['C1'])
    // The judge never sees the bench's rows, and the bench never sees the
    // judge's — showing either would be asking someone to answer a question
    // their evidence cannot settle.
    expect(llmDraftCriteria(RUBRIC).map(c => c.id)).not.toContain('H1')
    expect(humanCriteria(RUBRIC).map(c => c.id)).not.toContain('D1')
  })

  it('carries polarity and veto through, because they are the rubric\'s and not the grader\'s', () => {
    const [, h2] = humanCriteria(RUBRIC)
    expect(h2?.negative).toBe(true)
    expect(h2?.veto).toBe(true)
    expect(humanCriteria(RUBRIC)[0]?.weight).toBe(2)
  })
})

describe('the blind queue', () => {
  it('sends no condition id, harness or model anywhere in the payload', async () => {
    const dataDir = tmpTree()
    writeArchive(dataDir, CELL_A)
    writeArchive(dataDir, CELL_B)
    const view = await judgeQueueView({
      mission: missionFace({ dataDir }) as never,
      datasets: datasetsFace() as never,
      runId: RUN,
    })
    // The whole answer, as bytes. Nothing a page could render can name a
    // subject if the string it was built from does not.
    const wire = JSON.stringify(view)
    for (const fingerprint of ['codex-exec', 'dsh-exec', 'codex', 'gpt-5.6-sol', 'deepseek-v4', 'judge-alpha', 'judge-beta']) {
      expect(wire).not.toContain(fingerprint)
    }
    // The mission ids themselves are absent: `<task>-<conditionId>-rep<N>`
    // carries the condition, and the condition usually carries the harness.
    expect(wire).not.toContain(CELL_A)
    expect(wire).not.toContain(CELL_B)
  })

  it('numbers cells in the run\'s own order and hands each an opaque ticket', async () => {
    const dataDir = tmpTree()
    writeArchive(dataDir, CELL_A)
    const view = await judgeQueueView({
      mission: missionFace({ dataDir }) as never,
      datasets: datasetsFace() as never,
      runId: RUN,
    })
    expect(view.cells.map(cell => cell.cellNo)).toEqual([1, 2])
    expect(view.cells.map(cell => cell.task)).toEqual(['P0', 'P0'])
    // The ticket is a name without a fingerprint, and it round-trips.
    const ticket = view.cells[0]?.ticket as string
    expect(ticket).toMatch(/^[0-9a-f]{16}$/)
    expect(resolveTicket(RUN, [CELL_A, CELL_B], ticket)).toBe(CELL_A)
    expect(resolveTicket(RUN, [CELL_A, CELL_B], 'not-a-ticket')).toBeNull()
    // Stable across calls, so a grader who reloads keeps their place.
    expect(cellTicket(RUN, CELL_A)).toBe(ticket)
  })

  it('de-fingerprints the archived material with the run\'s own table', async () => {
    const dataDir = tmpTree()
    writeArchive(dataDir, CELL_A)
    const view = await judgeQueueView({
      mission: missionFace({ dataDir }) as never,
      datasets: datasetsFace() as never,
      runId: RUN,
    })
    const cell = view.cells[0]
    expect(cell?.materials.map(m => m.path)).toEqual(['stage1.md', 'stage2.md'])
    const stage1 = cell?.materials.find(m => m.path === 'stage1.md')
    // The SAME tokens judge.ts writes into the LLM judge's copy — one
    // de-identifier, so the two readers cannot drift.
    expect(stage1?.text).toContain('我是 <harness>')
    expect(stage1?.text).toContain('用 <model> 跑的')
    expect(stage1?.replacements).toBe(2)
    const stage2 = cell?.materials.find(m => m.path === 'stage2.md')
    expect(stage2?.text).toContain('本轮由 <harness> 编排，模型 <model>')
  })

  it('shows the rubric\'s human criteria and the llm-draft samples under blind labels', async () => {
    const dataDir = tmpTree()
    writeArchive(dataDir, CELL_A)
    const view = await judgeQueueView({
      mission: missionFace({ dataDir }) as never,
      datasets: datasetsFace() as never,
      runId: RUN,
    })
    const cell = view.cells[0]
    expect(cell?.criteria.map(c => c.id)).toEqual(['H1', 'H2'])
    expect(cell?.criteriaNote).toBeNull()
    // Two judges, three samples, and the panel reads A / B — stable by the
    // run's sorted judge order, so two samples can be told apart without
    // saying whose they are.
    expect(cell?.drafts.map(d => d.judge)).toEqual(['判官 A', '判官 A', '判官 B'])
    expect(cell?.drafts.map(d => d.sample)).toEqual([1, 2, 1])
    // 决策 9: a judge may be a player, and the bench discloses it per sample.
    expect(cell?.drafts.filter(d => d.selfJudged)).toHaveLength(2)
  })

  it('names the criteria a first human-final verdict would drop from the cell score', async () => {
    const dataDir = tmpTree()
    const mission = missionFace({ dataDir })
    const before = await judgeQueueView({ mission: mission as never, datasets: datasetsFace() as never, runId: RUN })
    // The report scores a cell from ONE namespace — the most authoritative
    // holding any verdict — so the first human-final verdict here would take
    // D1 out of this cell's score entirely. The grader has to be told before
    // spending it, not after.
    expect(before.cells[0]?.draftOnlyCriteria).toEqual(['D1'])
    expect(before.cells[1]?.draftOnlyCriteria).toEqual([])

    // Answering D1 itself removes it from the list: nothing is lost when the
    // person supplies the value that supersedes.
    await writeHumanFinal({
      mission: mission as never, annotate: mission as never, runId: RUN,
      ticket: cellTicket(RUN, CELL_A),
      verdicts: [{ criterion: 'D1', pass: true, evidence: '人终评同意判官' }],
      sessionId: 's1',
    })
    const after = await judgeQueueView({ mission: mission as never, datasets: datasetsFace() as never, runId: RUN })
    expect(after.cells[0]?.draftOnlyCriteria).toEqual([])
  })

  it('splits the queue by whether a cell already carries human-final', async () => {
    const dataDir = tmpTree()
    const mission = missionFace({ dataDir })
    const before = await judgeQueueView({ mission: mission as never, datasets: datasetsFace() as never, runId: RUN })
    expect(before.cells.map(c => c.graded)).toEqual([false, false])

    await writeHumanFinal({
      mission: mission as never,
      annotate: mission as never,
      runId: RUN,
      ticket: cellTicket(RUN, CELL_A),
      verdicts: [{ criterion: 'H1', pass: true, evidence: '结论段是给人读的' }],
      sessionId: 's1',
    })
    const after = await judgeQueueView({ mission: mission as never, datasets: datasetsFace() as never, runId: RUN })
    expect(after.cells.map(c => c.graded)).toEqual([true, false])
    expect(after.cells[0]?.humanFinal).toEqual([
      { criterion: 'H1', pass: true, evidence: '结论段是给人读的', at: 99, by: 'tab:s1' },
    ])
  })

  it('computes agreement off the LIVE ledger, so a verdict written here moves it', async () => {
    const dataDir = tmpTree()
    const mission = missionFace({ dataDir })
    const before = await judgeQueueView({ mission: mission as never, datasets: datasetsFace() as never, runId: RUN })
    // judge-alpha answered D1 twice and disagreed with itself; judge-beta once.
    expect(before.consistency.multiSampled).toBe(1)
    expect(before.consistency.crossJudged).toBe(1)
    expect(before.consistency.humanAgreement).toBeNull()

    await writeHumanFinal({
      mission: mission as never,
      annotate: mission as never,
      runId: RUN,
      ticket: cellTicket(RUN, CELL_A),
      verdicts: [{ criterion: 'D1', pass: true, evidence: '人终评：成立' }],
      sessionId: 's1',
    })
    const after = await judgeQueueView({ mission: mission as never, datasets: datasetsFace() as never, runId: RUN })
    // No re-export needed: the number a grader just changed is the number
    // they see.
    expect(after.consistency.humanAgreement).toEqual({ agreed: 0, total: 1 })
  })

  it('degrades with a sentence rather than a throw when a source is missing', async () => {
    // No data root: the material cannot be read, but the criteria and the
    // verdicts already on record still can.
    const view = await judgeQueueView({ mission: missionFace() as never, runId: RUN })
    expect(view.cells[0]?.materials).toEqual([])
    expect(view.notes.some(note => note.includes('数据根目录'))).toBe(true)
    // No datasets service: the criteria table says why it is empty.
    expect(view.cells[0]?.criteriaNote).toContain('datasets')
    expect(view.cells[0]?.criteria).toEqual([])
  })
})

describe('the human-final write', () => {
  it('records the SESSION as `by`, never a tool: origin', async () => {
    const mission = missionFace()
    const result = await writeHumanFinal({
      mission: mission as never,
      annotate: mission as never,
      runId: RUN,
      ticket: cellTicket(RUN, CELL_B),
      verdicts: [{ criterion: 'H1', pass: false, evidence: '结论段是写给模型看的' }],
      sessionId: 's-abc',
    })
    expect(result.by).toBe('tab:s-abc')
    // The exact prefix the report's top red flag looks for. A verdict from
    // this bench must never be able to trigger it.
    expect(result.by.startsWith('tool:')).toBe(false)
    expect(result.missionId).toBe(CELL_B)
    expect(result.written).toBe(1)

    const [[missionId, ns, payload, options]] = mission.annotate.mock.calls
    expect(missionId).toBe(CELL_B)
    expect(ns).toBe('human-final')
    expect(options).toEqual({ runId: RUN, by: 'tab:s-abc' })
    // `dataseek.verdict/1`, with the protocol's own word for this origin.
    expect(payload).toEqual({
      verdicts: [{
        schema: 'dataseek.verdict/1', task: 'P0', criterion: 'H1',
        pass: false, evidence: '结论段是写给模型看的', by: 'judge-bench',
      }],
    })
  })

  it('appends rather than rewrites — a second pass is a second annotation', async () => {
    const mission = missionFace()
    const ticket = cellTicket(RUN, CELL_B)
    const common = { mission: mission as never, annotate: mission as never, runId: RUN, ticket, sessionId: 's1' }
    await writeHumanFinal({ ...common, verdicts: [{ criterion: 'H1', pass: false, evidence: '第一次的判断' }] })
    await writeHumanFinal({ ...common, verdicts: [{ criterion: 'H1', pass: true, evidence: '复核后改判' }] })

    const recorded = mission.annotations[CELL_B] as Array<{ ns: string; payload: { verdicts: Array<{ pass: boolean }> } }>
    expect(recorded).toHaveLength(2)
    // Both survive: the report reads the LATEST value per criterion, so the
    // correction supersedes without the earlier one leaving the ledger.
    expect(recorded.map(a => a.payload.verdicts[0]?.pass)).toEqual([false, true])
  })

  it('reports an identical repeat as a no-op instead of claiming a write', async () => {
    const mission = missionFace()
    const common = {
      mission: mission as never, annotate: mission as never, runId: RUN,
      ticket: cellTicket(RUN, CELL_B), sessionId: 's1',
      verdicts: [{ criterion: 'H1', pass: true, evidence: '同一句话' }],
    }
    expect((await writeHumanFinal(common)).added).toBe(true)
    const second = await writeHumanFinal(common)
    expect(second.added).toBe(false)
    expect(second.duplicate).toBe(true)
    expect(second.written).toBe(0)
  })

  it('refuses a ticket that names no cell of the run', async () => {
    const mission = missionFace()
    await expect(writeHumanFinal({
      mission: mission as never, annotate: mission as never, runId: RUN,
      // A ticket minted for a DIFFERENT run: the hash includes the run id, so
      // it cannot be replayed across runs.
      ticket: cellTicket('run-other', CELL_A),
      verdicts: [{ criterion: 'H1', pass: true, evidence: 'x' }],
      sessionId: 's1',
    })).rejects.toThrow(/no cell/)
  })

  it('refuses a verdict without evidence', async () => {
    const mission = missionFace()
    await expect(writeHumanFinal({
      mission: mission as never, annotate: mission as never, runId: RUN,
      ticket: cellTicket(RUN, CELL_A),
      verdicts: [{ criterion: 'H1', pass: true, evidence: '   ' }],
      sessionId: 's1',
    })).rejects.toThrow(/缺证据/)
    expect(mission.annotate).not.toHaveBeenCalled()
  })

  it('refuses an empty submission', async () => {
    const mission = missionFace()
    await expect(writeHumanFinal({
      mission: mission as never, annotate: mission as never, runId: RUN,
      ticket: cellTicket(RUN, CELL_A), verdicts: [], sessionId: 's1',
    })).rejects.toThrow(/at least one verdict/)
  })
})

describe('the Remote verbs', () => {
  it('routes judgeQueue and humanFinal through the service, tagging the caller\'s session', async () => {
    const dataDir = tmpTree()
    writeArchive(dataDir, CELL_A)
    const mission = missionFace({ dataDir })
    const datasets = datasetsFace()
    const service = new EvalService({
      get: (name: string) => (name === 'mission' ? mission : name === 'datasets' ? datasets : undefined),
    })
    const remote = Object.create(EvalRemoteService.prototype) as EvalRemoteService
    Object.defineProperty(remote, 'service', { get: () => service })

    const view = await remote.judgeQueue(agentOf(), { runId: RUN })
    expect(view.cells).toHaveLength(2)
    expect(view.judgeCount).toBe(2)

    const ticket = view.cells[0]?.ticket as string
    const written = await remote.humanFinal(agentOf('s-remote'), {
      runId: RUN, ticket, verdicts: [{ criterion: 'H1', pass: true, evidence: '真的读得懂' }],
    })
    expect(written.by).toBe('tab:s-remote')
    expect(written.missionId).toBe(CELL_A)
  })

  it('refuses both verbs, by name, when no mission service is mounted', async () => {
    const service = new EvalService({ get: () => undefined })
    await expect(service.judgeQueue(RUN)).rejects.toThrow(/dsh-mission/)
    await expect(service.humanFinal(RUN, 'ticket', [], 's1')).rejects.toThrow(/dsh-mission/)
  })
})

describe('the bench\'s envelope in the report\'s authority order', () => {
  /**
   * The seam T37 actually creates. `NS_PRIORITY` (human-final > llm-draft >
   * script) predates this slice and the report's own specs cover it; what is
   * NEW is whether the envelope `writeHumanFinal` produces is one
   * `analyzeBundle` can read at all. So this test does not hand-write a
   * payload: it captures the bytes the bench really wrote, drops them into a
   * bundle beside a CONTRADICTING llm-draft value on the same criterion, and
   * checks the human answer is the one that counts.
   *
   * It is the one case the interface cannot produce by itself — the bench
   * only offers `kind: human` criteria, and a criterion the rubric marks
   * `human` has no llm-draft value to override. Which is exactly why the
   * override has to be pinned here rather than on a screen.
   */
  it('a bench verdict overrides the llm-draft value for the same criterion', async () => {
    const mission = missionFace()
    await writeHumanFinal({
      mission: mission as never,
      annotate: mission as never,
      runId: RUN,
      ticket: cellTicket(RUN, CELL_A),
      // The judges said D1 HOLDS (three samples, unanimous). The person says
      // it does not.
      verdicts: [{ criterion: 'D1', pass: false, evidence: '判官读漏了：那一段只复述了需求，没有给出归类规则' }],
      sessionId: 's1',
    })
    const written = (mission.annotations[CELL_A] as Array<{ ns: string; by?: string; payload: unknown }>)
      .find(a => a.ns === 'human-final') as { ns: string; by?: string; payload: unknown }

    // A one-cell bundle: the judges' three llm-draft samples, plus the bench's
    // own annotation verbatim.
    const bundle = join(tmpTree(), `${RUN}-bundle`)
    const attemptDir = join(bundle, 'missions', CELL_A, 'attempt-1')
    mkdirSync(attemptDir, { recursive: true })
    writeFileSync(join(bundle, 'run.json'), `${JSON.stringify({
      id: RUN, createdAt: 0, state: 'closed', stateMachine: { states: [], transitions: [] },
      meta: { ...metaOf('/repo'), expectedNs: ['llm-draft', 'human-final'] },
    }, null, 2)}\n`)
    writeFileSync(join(attemptDir, 'meta.json'), `${JSON.stringify({
      attempt: 1, state: 'released', refs: {}, enteredAt: {}, checkpoints: [], history: [], artifacts: [], attestations: [],
    }, null, 2)}\n`)
    writeFileSync(join(attemptDir, 'annotations.json'), `${JSON.stringify([
      ...(missionFace().annotations[CELL_A] as unknown[]).map(a => ({ missionId: CELL_A, ...(a as object) })),
      { missionId: CELL_A, attempt: 1, ns: written.ns, by: written.by, createdAt: 99, payload: written.payload },
    ], null, 2)}\n`)

    const report = await analyzeBundle(bundle)
    const d1 = report.rows.filter(row => row.criterion === 'D1')
    // Every sample is still a row — the ledger loses nothing.
    expect(d1.filter(row => row.ns === 'llm-draft')).toHaveLength(3)
    expect(d1.filter(row => row.ns === 'human-final')).toHaveLength(1)
    // But the authority order counts the person's: three judges saying yes do
    // not outvote the one human who said no.
    expect(report.judge.humanAgreement).toEqual({ agreed: 0, total: 1 })
    // And the red flag stays down: a bench write is `tab:`, never `tool:`.
    expect(report.toolOnlyNs).not.toContain('human-final')
  })
})
