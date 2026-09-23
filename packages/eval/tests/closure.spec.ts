/**
 * I5·T72 — the two run-level marks a human leaves after an experiment ran:
 * the closure (one of four exits out of human review) and the archive flag.
 *
 * What these pin: the closure is the ONLY thing that moves an experiment out
 * of 评估中; the two exits that exist to explain themselves need a reason; a
 * voided evaluation stays void; the newest mark wins; archiving never touches
 * status.
 */
import { describe, expect, it, vi } from 'vitest'
import { ARCHIVE_NS, CLOSURE_NS, foldRunMarks, readRunMarks, recordArchive, recordClosure } from '../src/closure.ts'
import { deriveExperimentStatus } from '../src/experiments.ts'

const RUN = 'run-20260923-t72'

interface Annotation { ns: string; attempt: number; payload: unknown; createdAt: number }

function ledger(rows: string[] = ['p0-a-rep1', 'p0-b-rep1']) {
  const annotations = new Map<string, Annotation[]>(rows.map(id => [id, []]))
  let clock = 1_000
  const face = {
    runStatus: (runId: string) => {
      if (runId !== RUN) throw new Error(`unknown run ${runId}`)
      return {
        run: { id: runId, state: 'active', createdAt: 0, meta: {} },
        rows: rows.map(id => ({ id, state: 'judged', bucket: 'done', currentAttempt: 1, labels: {} })),
        buckets: {},
        unreleased: [],
      }
    },
    get: (missionId: string) => ({ mission: { currentAttempt: 1, attempts: [], annotations: annotations.get(missionId) ?? [] } }),
    annotate: vi.fn(async (missionId: string, ns: string, payload: unknown) => {
      const held = annotations.get(missionId)
      if (held === undefined) throw new Error(`unknown cell ${missionId}`)
      held.push({ ns, attempt: 1, payload, createdAt: (clock += 1000) })
      return { added: true }
    }),
  }
  return { face, annotations }
}

type Face = Parameters<typeof recordClosure>[1]
type Annotate = Parameters<typeof recordClosure>[0]

describe('recordClosure — the four exits', () => {
  it.each(['final', 'unreviewed'] as const)('exit %s lands without a reason, on the first cell only', async exit => {
    const { face, annotations } = ledger()
    const write = await recordClosure(face as unknown as Annotate, face as unknown as Face, RUN, { exit, by: 'tab:s1' })
    expect(write).toMatchObject({ recorded: true, refusal: null, closure: { exit, reason: null, by: 'tab:s1' } })
    expect(annotations.get('p0-a-rep1')).toHaveLength(1)
    expect(annotations.get('p0-a-rep1')![0]).toMatchObject({ ns: CLOSURE_NS, payload: { kind: 'closure', exit } })
    expect(annotations.get('p0-b-rep1')).toHaveLength(0)
  })

  it.each(['flagged', 'void'] as const)('exit %s is refused without a reason, and the reason is kept trimmed', async exit => {
    const { face } = ledger()
    for (const reason of [undefined, null, '', '   ']) {
      const refused = await recordClosure(face as unknown as Annotate, face as unknown as Face, RUN, { exit, reason })
      expect(refused).toMatchObject({ recorded: false, refusal: 'reason-required' })
    }
    expect(face.annotate).not.toHaveBeenCalled()
    const landed = await recordClosure(face as unknown as Annotate, face as unknown as Face, RUN, { exit, reason: '  判官缺席  ' })
    expect(landed).toMatchObject({ recorded: true, closure: { exit, reason: '判官缺席' } })
  })

  it('an unknown exit is refused before anything is written', async () => {
    const { face } = ledger()
    const write = await recordClosure(face as unknown as Annotate, face as unknown as Face, RUN, { exit: 'maybe' })
    expect(write).toMatchObject({ recorded: false, refusal: 'unknown-exit' })
    expect(face.annotate).not.toHaveBeenCalled()
  })

  it('the newest closure wins; after void every further closure is refused', async () => {
    const { face } = ledger()
    const a = face as unknown as Annotate
    const m = face as unknown as Face
    await recordClosure(a, m, RUN, { exit: 'unreviewed' })
    await recordClosure(a, m, RUN, { exit: 'flagged', reason: '只看方向' })
    expect(readRunMarks(m, RUN).closure).toMatchObject({ exit: 'flagged', reason: '只看方向' })
    await recordClosure(a, m, RUN, { exit: 'void', reason: '题集有误' })
    const after = await recordClosure(a, m, RUN, { exit: 'final' })
    expect(after).toMatchObject({ recorded: false, refusal: 'already-void', closure: { exit: 'void', reason: '题集有误' } })
    expect(readRunMarks(m, RUN).closure?.exit).toBe('void')
  })

  it('a run with no cell, or an unknown run, refuses with a named reason', async () => {
    const empty = ledger([])
    expect(await recordClosure(empty.face as unknown as Annotate, empty.face as unknown as Face, RUN, { exit: 'final' }))
      .toMatchObject({ recorded: false, refusal: 'no-cell' })
    const { face } = ledger()
    expect(await recordClosure(face as unknown as Annotate, face as unknown as Face, 'run-other', { exit: 'final' }))
      .toMatchObject({ recorded: false, refusal: 'ledger' })
  })

  it('the closure is what the status reads: ①②③ → 已完成, ④ → 评估不成立', () => {
    const run = { cellStates: ['judged'], buckets: { done: 1 } }
    expect(deriveExperimentStatus({ validation: null, run, job: null })).toBe('judging')
    for (const exit of ['final', 'flagged', 'unreviewed'] as const) {
      expect(deriveExperimentStatus({ validation: null, run, job: null, closure: { exit } })).toBe('done')
    }
    expect(deriveExperimentStatus({ validation: null, run, job: null, closure: { exit: 'void' } })).toBe('void')
  })
})

describe('recordArchive — grouping only', () => {
  it('archive and restore; the newest mark stands, and no closure is implied', async () => {
    const { face, annotations } = ledger()
    const a = face as unknown as Annotate
    const m = face as unknown as Face
    await recordArchive(a, m, RUN, { archived: true, by: 'tab:s1' })
    expect(readRunMarks(m, RUN)).toMatchObject({ archive: { archived: true, by: 'tab:s1' }, closure: null })
    await recordArchive(a, m, RUN, { archived: false })
    expect(readRunMarks(m, RUN).archive?.archived).toBe(false)
    expect(annotations.get('p0-a-rep1')!.every(entry => entry.ns === ARCHIVE_NS)).toBe(true)
  })
})

describe('foldRunMarks', () => {
  it('reads marks from any cell, skips malformed payloads, and tracks the newest annotation time', () => {
    const marks = foldRunMarks([
      [{ ns: CLOSURE_NS, payload: { kind: 'closure', exit: 'final', at: '2026-09-23T01:00:00.000Z' }, createdAt: 10 }],
      [
        { ns: CLOSURE_NS, payload: { kind: 'closure', exit: 'bogus', at: '2026-09-23T02:00:00.000Z' }, createdAt: 30 },
        { ns: 'llm-draft', payload: {}, createdAt: 40 },
      ],
    ])
    expect(marks.closure?.exit).toBe('final')
    expect(marks.lastAnnotationAt).toBe(40)
  })

  it('same-millisecond ties fall to the payload time', () => {
    const marks = foldRunMarks([[
      { ns: CLOSURE_NS, payload: { kind: 'closure', exit: 'flagged', reason: 'r', at: '2026-09-23T02:00:00.000Z' }, createdAt: 10 },
      { ns: CLOSURE_NS, payload: { kind: 'closure', exit: 'final', at: '2026-09-23T01:00:00.000Z' }, createdAt: 10 },
    ]])
    expect(marks.closure?.exit).toBe('flagged')
  })
})
