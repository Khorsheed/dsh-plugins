/**
 * T89 — run-level marks. The export note, the closure and the archive flag go
 * on the run's own annotation list when mission has `annotateRun`, and the
 * reading side still finds the marks runs written before T89 left on their
 * first cell. Nothing is migrated: an old run keeps its cell marks, a new
 * mark over it lands at run level, and the newest wins across both.
 */
import { describe, expect, it, vi } from 'vitest'
import { ARCHIVE_NS, CLOSURE_NS, readRunMarks, recordArchive, recordClosure } from '../src/closure.ts'
import { readExportState, recordExportNote, recordExportNoteOn, type EvalExportNote } from '../src/export-note.ts'
import { runLevelAnnotations, writeRunNote } from '../src/run-notes.ts'

const RUN = 'run-20261001-t89'

interface Annotation { ns: string; attempt?: number; payload: unknown; createdAt: number; by?: string }

/** A ledger with two cells AND a run-level list; `runLevel: false` = a mission predating T89. */
function ledger(options: { runLevel?: boolean; rows?: string[] } = {}) {
  const rows = options.rows ?? ['p0-a-rep1', 'p0-b-rep1']
  const cells = new Map<string, Annotation[]>(rows.map(id => [id, []]))
  const run: Annotation[] = []
  let clock = 1_000
  const face: Record<string, unknown> = {
    runStatus: (runId: string) => {
      if (runId !== RUN) throw new Error(`unknown run ${runId}`)
      return {
        run: { id: runId, state: 'active', createdAt: 0, meta: {} },
        rows: rows.map(id => ({ id, state: 'judged', bucket: 'done', currentAttempt: 1, labels: {} })),
        buckets: {},
        unreleased: [],
      }
    },
    get: (missionId: string) => ({ mission: { currentAttempt: 1, attempts: [], annotations: cells.get(missionId) ?? [] } }),
    annotate: vi.fn(async (missionId: string, ns: string, payload: unknown) => {
      const held = cells.get(missionId)
      if (held === undefined) throw new Error(`unknown cell ${missionId}`)
      held.push({ ns, attempt: 1, payload, createdAt: (clock += 1000) })
      return { added: true }
    }),
  }
  if (options.runLevel !== false) {
    face['annotateRun'] = vi.fn(async (runId: string, ns: string, payload: unknown, opts?: { by?: string }) => {
      if (runId !== RUN) throw new Error(`run ${runId} does not exist`)
      run.push({ ns, payload, createdAt: (clock += 1000), by: opts?.by ?? 'service' })
      return { added: true }
    })
    face['runAnnotations'] = (runId: string) => {
      if (runId !== RUN) throw new Error(`run ${runId} does not exist`)
      return run
    }
  }
  /** Seed an old-layout mark straight onto the first cell, as a pre-T89 run left it. */
  const legacy = (ns: string, payload: unknown, createdAt: number) => cells.get(rows[0]!)!.push({ ns, attempt: 1, payload, createdAt })
  return { face, cells, run, legacy }
}

type Face = Parameters<typeof recordClosure>[1]
type Annotate = Parameters<typeof recordClosure>[0]
const as = (face: unknown) => ({ a: face as Annotate, m: face as Face })

const NOTE: EvalExportNote = {
  outDir: '/out', bundleDir: `/out/${RUN}-bundle`, exportedAt: 5_000_000, layers: ['visible'],
  snapshotDir: null, snapshot: null, summaryPath: null, reportError: null,
}

describe('writing: run level when mission has the verb', () => {
  it('closure, archive and export note all land on the run, none on a cell', async () => {
    const { face, cells, run } = ledger()
    const { a, m } = as(face)
    expect((await recordClosure(a, m, RUN, { exit: 'final', by: 'tab:s1' })).recorded).toBe(true)
    expect((await recordArchive(a, m, RUN, { archived: true })).recorded).toBe(true)
    expect(await recordExportNote(a, m, RUN, NOTE, 'eval-export')).toEqual({ recorded: true, reason: null })
    expect(await recordExportNoteOn(a, 'p0-a-rep1', RUN, NOTE)).toEqual({ recorded: true, reason: null })
    expect(run.map(x => x.ns)).toEqual([CLOSURE_NS, ARCHIVE_NS, 'orchestrator', 'orchestrator'])
    expect(run[0]?.by).toBe('tab:s1')
    expect([...cells.values()].every(list => list.length === 0)).toBe(true)
    expect(face['annotate']).not.toHaveBeenCalled()
  })

  it('a run with no cell can still be closed at run level (the old door refused it)', async () => {
    const { face } = ledger({ rows: [] })
    const { a, m } = as(face)
    expect((await recordClosure(a, m, RUN, { exit: 'final' })).recorded).toBe(true)
    expect(await recordExportNoteOn(a, undefined, RUN, NOTE)).toEqual({ recorded: true, reason: null })
    const old = ledger({ rows: [], runLevel: false })
    expect(await recordClosure(old.face as Annotate, old.face as Face, RUN, { exit: 'final' }))
      .toMatchObject({ recorded: false, refusal: 'no-cell' })
    expect(await recordExportNoteOn(old.face as Annotate, undefined, RUN, NOTE))
      .toEqual({ recorded: false, reason: `run ${RUN} holds no cell to record the export against` })
  })

  it('a ledger error on the run-level write is a refusal, not a throw', async () => {
    const { face } = ledger()
    face['annotateRun'] = async () => { throw new Error('disk full') }
    const { a, m } = as(face)
    expect(await recordClosure(a, m, RUN, { exit: 'final' })).toMatchObject({ recorded: false, refusal: 'ledger', detail: 'disk full' })
    expect(await recordExportNote(a, m, RUN, NOTE)).toEqual({ recorded: false, reason: 'disk full' })
  })
})

describe('writing: an older mission without the verb keeps the first-cell layout', () => {
  it('every mark goes on the first cell, exactly as before T89', async () => {
    const { face, cells } = ledger({ runLevel: false })
    const { a, m } = as(face)
    await recordClosure(a, m, RUN, { exit: 'unreviewed' })
    await recordArchive(a, m, RUN, { archived: true })
    await recordExportNote(a, m, RUN, NOTE)
    expect(cells.get('p0-a-rep1')!.map(x => x.ns)).toEqual([CLOSURE_NS, ARCHIVE_NS, 'orchestrator'])
    expect(cells.get('p0-b-rep1')).toHaveLength(0)
    expect(await writeRunNote(a, RUN, 'x', {}, undefined, () => 'p0-b-rep1')).toEqual({ ok: true, level: 'cell' })
  })
})

describe('reading: old first-cell marks stay readable, newest wins across both', () => {
  it('an old run whose marks are only on its first cell reads exactly as before', () => {
    const { face, legacy } = ledger()
    legacy(CLOSURE_NS, { kind: 'closure', exit: 'flagged', reason: 'r', at: '2026-09-20T00:00:00.000Z', by: 'tab:old' }, 100)
    legacy(ARCHIVE_NS, { kind: 'archive', archived: true, at: '2026-09-20T00:00:00.000Z', by: null }, 110)
    legacy('orchestrator', { kind: 'export', bundleDir: '/old/b', outDir: '/old', exportedAt: 1, layers: ['visible'] }, 120)
    const marks = readRunMarks(face as Face, RUN)
    expect(marks.closure).toMatchObject({ exit: 'flagged', reason: 'r', by: 'tab:old' })
    expect(marks.archive).toMatchObject({ archived: true })
    expect(marks.lastAnnotationAt).toBe(120)
    expect(readExportState(face as Face, RUN).note?.bundleDir).toBe('/old/b')
  })

  it('a new run-level mark over an old cell mark wins; the old one is left in place', async () => {
    const { face, cells, legacy } = ledger()
    legacy(CLOSURE_NS, { kind: 'closure', exit: 'unreviewed', reason: null, at: '2026-09-20T00:00:00.000Z', by: null }, 100)
    legacy('orchestrator', { kind: 'export', bundleDir: '/old/b', outDir: '/old', exportedAt: 1, layers: [] }, 120)
    const { a, m } = as(face)
    await recordClosure(a, m, RUN, { exit: 'final', now: new Date('2026-10-01T00:00:00Z') })
    await recordExportNote(a, m, RUN, NOTE)
    expect(readRunMarks(m, RUN).closure?.exit).toBe('final')
    expect(readExportState(m, RUN).note?.bundleDir).toBe(NOTE.bundleDir)
    expect(cells.get('p0-a-rep1')).toHaveLength(2)
  })

  it('void on an old cell still refuses a new closure', async () => {
    const { face, legacy } = ledger()
    legacy(CLOSURE_NS, { kind: 'closure', exit: 'void', reason: 'bad data', at: '2026-09-20T00:00:00.000Z', by: null }, 100)
    const { a, m } = as(face)
    expect(await recordClosure(a, m, RUN, { exit: 'final' })).toMatchObject({ recorded: false, refusal: 'already-void' })
  })

  it('the run-level list alone is read when the cell list is unreadable; a failing run read is empty', () => {
    const { face, run } = ledger()
    run.push({ ns: CLOSURE_NS, payload: { kind: 'closure', exit: 'final', reason: null, at: '2026-10-01T00:00:00.000Z', by: null }, createdAt: 9 })
    face['runStatus'] = () => { throw new Error('ledger down') }
    expect(readRunMarks(face as Face, RUN).closure?.exit).toBe('final')
    face['runAnnotations'] = () => { throw new Error('boom') }
    expect(runLevelAnnotations(face as Face, RUN)).toEqual([])
    expect(runLevelAnnotations(ledger({ runLevel: false }).face as Face, RUN)).toEqual([])
  })
})
