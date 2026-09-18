/**
 * I5·T60 — one export action, and the two facts it leaves behind.
 *
 * The gaps these pin are the walkthrough's last mile (I5·T39): the report page
 * exported a bundle and then printed a command line for the reader to go and
 * run (G15); a bundle exported with `--out` was unreachable from the run, so
 * the page called it 未导出 and offered a text box (T53); and the final
 * verdicts, written from the judge bench AFTER the run's own export, never
 * reached the bundle everything downstream is read from, with neither surface
 * saying so (G17).
 *
 * The rule the whole file is about: an export writes the bundle, the report
 * INSIDE it, and a note saying where it went — and a bundle older than the
 * last human-final says so in words, with the button beside the sentence.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EXPORT_NOTE_KIND, readExportState, recordExportNote, recordExportNoteOn, reexportDirOf,
} from '../src/export-note.ts'
import { exportDirCandidates } from '../src/report-view.ts'
import { EvalService } from '../src/service.ts'
import { cleanupTmp, tmpTree } from './helpers.ts'

afterEach(cleanupTmp)

const RUN = 'run-20260917-t60'

/** One annotation as the ledger holds it. */
interface Annotation { ns: string; attempt: number; payload: unknown; createdAt: number; by?: string }

/**
 * A mission ledger with two cells, recording annotations in memory — the
 * narrow slice both faces this module uses actually touch.
 */
function ledger(options: { meta?: Record<string, unknown>; rows?: string[] } = {}) {
  const rows = options.rows ?? ['p0-a-rep1', 'p0-b-rep1']
  const annotations = new Map<string, Annotation[]>(rows.map(id => [id, []]))
  // A real-clock base: the staleness verdict compares a ledger timestamp with
  // a bundle's `exportedAt`, and a fixture clock starting at 1000 would make
  // every real export look newer than every verdict.
  const base = Date.now()
  let clock = base
  return {
    annotations,
    base,
    face: {
      dataDir: '/nowhere',
      runStatus: (runId: string) => {
        if (runId !== RUN) throw new Error(`unknown run ${runId}`)
        return {
          run: { id: runId, state: 'closed', createdAt: 0, meta: options.meta ?? {} },
          rows: rows.map(id => ({ id, state: 'released', bucket: 'done', currentAttempt: 1, labels: {} })),
          buckets: {},
          unreleased: [],
        }
      },
      get: (missionId: string) => {
        const held = annotations.get(missionId)
        if (held === undefined) throw new Error(`unknown cell ${missionId}`)
        return { mission: { currentAttempt: 1, attempts: [], annotations: held } }
      },
      annotate: vi.fn(async (missionId: string, ns: string, payload: unknown) => {
        const held = annotations.get(missionId)
        if (held === undefined) throw new Error(`unknown cell ${missionId}`)
        held.push({ ns, attempt: 1, payload, createdAt: (clock += 1000) })
        return { added: true }
      }),
    },
  }
}

/** The smallest directory `analyzeBundle` accepts, with a manifest that carries a time. */
function writeBundle(outDir: string, runId: string, exportedAt: number): string {
  const bundle = join(outDir, `${runId}-bundle`)
  const attempt = join(bundle, 'missions', 'p0-a-rep1', 'attempt-1')
  mkdirSync(join(attempt, 'artifacts'), { recursive: true })
  writeFileSync(join(bundle, 'run.json'), `${JSON.stringify({
    id: runId, createdAt: 0, state: 'closed',
    meta: { datasetId: 'ds', evalVersion: '0.1.0-rc.1', expectedNs: ['script'] },
    stateMachine: { states: [], transitions: [] },
  })}\n`)
  writeFileSync(join(bundle, 'manifest.json'), `${JSON.stringify({ exportedAt })}\n`)
  writeFileSync(join(attempt, 'meta.json'), `${JSON.stringify({
    attempt: 1, state: 'released', refs: {}, enteredAt: {}, checkpoints: [], history: [], artifacts: [], attestations: [],
  })}\n`)
  writeFileSync(join(attempt, 'annotations.json'), `${JSON.stringify([{
    missionId: 'p0-a-rep1', attempt: 1, ns: 'script', by: 'cli', createdAt: 0,
    payload: [{ schema: 'dataseek.verdict/1', task: 'P0', criterion: 'c1', pass: true, evidence: 'held', by: 'probes/p.mjs' }],
  }])}\n`)
  return bundle
}

const NOTE = {
  outDir: '/exports',
  bundleDir: `/exports/${RUN}-bundle`,
  exportedAt: 1_700_000_000_000,
  layers: ['visible'],
  snapshotDir: '/snap',
  snapshot: { repo: '/repo', commit: 'c0ffee', dataset: 'ds' },
  summaryPath: `/exports/${RUN}-bundle/report/summary.md`,
  reportError: null,
}

describe('the run-level export note', () => {
  it('records where the bundle went on the run\'s first cell, and reads back from any of them', async () => {
    const { face, annotations } = ledger()
    const recorded = await recordExportNote(face, face, RUN, NOTE, 'tab:s1')

    expect(recorded).toEqual({ recorded: true, reason: null })
    // Written NARROW — one cell, deterministically the first.
    expect(annotations.get('p0-a-rep1')).toHaveLength(1)
    expect(annotations.get('p0-b-rep1')).toHaveLength(0)
    const written = annotations.get('p0-a-rep1')?.[0]
    expect(written?.ns).toBe('orchestrator')
    expect(written?.payload).toMatchObject({ kind: EXPORT_NOTE_KIND, bundleDir: NOTE.bundleDir })

    expect(readExportState(face, RUN).note).toEqual(NOTE)
  })

  it('reads the NEWEST note when a run was exported more than once', async () => {
    const { face } = ledger()
    await recordExportNote(face, face, RUN, NOTE)
    const later = { ...NOTE, outDir: '/exports/re-2', bundleDir: `/exports/re-2/${RUN}-bundle`, exportedAt: NOTE.exportedAt + 5000 }
    // Deliberately on the OTHER cell: written narrow, read wide.
    await recordExportNoteOn(face, 'p0-b-rep1', RUN, later)

    expect(readExportState(face, RUN).note?.bundleDir).toBe(later.bundleDir)
  })

  it('ignores the orchestrator\'s other records and answers null when nothing was exported', async () => {
    const { face } = ledger()
    await face.annotate('p0-a-rep1', 'orchestrator', { kind: 'unit', unit: 'u1' })
    await face.annotate('p0-a-rep1', 'orchestrator', { kind: 'export', bundleDir: '/x' }) // no exportedAt

    expect(readExportState(face, RUN).note).toBeNull()
  })

  it('reports the newest human-final time in the same pass', async () => {
    const { face, base } = ledger()
    await face.annotate('p0-a-rep1', 'human-final', { verdicts: [] })
    await face.annotate('p0-b-rep1', 'human-final', { verdicts: [] })
    const state = readExportState(face, RUN)

    expect(state.lastHumanFinalAt).toBe(base + 2000)
  })

  it('does not fail an export when the ledger has no cell to record against', async () => {
    const { face } = ledger({ rows: [] })
    expect(await recordExportNote(face, face, RUN, NOTE)).toEqual({
      recorded: false,
      reason: `run ${RUN} holds no cell to record the export against`,
    })
  })

  it('a re-export goes into a fresh directory beside the first, never over it', () => {
    const dir = reexportDirOf('/exports', Date.UTC(2026, 8, 17, 14, 25, 30))
    expect(dir).toBe('/exports/re-20260917T142530Z')
    // A trailing slash is the same directory, not a second one.
    expect(reexportDirOf('/exports/', Date.UTC(2026, 8, 17, 14, 25, 30))).toBe(dir)
  })

  it('the noted directory is tried before the plan\'s and the repository\'s', async () => {
    const candidates = await exportDirCandidates(
      { snapshot: { repo: '/repo' } },
      undefined,
      '/somewhere/--out/gave',
    )
    expect(candidates).toEqual(['/somewhere/--out/gave', '/repo/exports'])
  })
})

describe('the report page reads how old the bundle is', () => {
  /** A service whose mission face is this ledger. */
  function service(face: unknown, lab?: unknown) {
    return new EvalService({
      get: (name: string) => (name === 'mission' ? face : name === 'lab' ? lab : undefined),
    })
  }

  it('says when the bundle was written, and that its report is in it', async () => {
    const out = tmpTree()
    const bundle = writeBundle(out, RUN, 1_700_000_000_000)
    mkdirSync(join(bundle, 'report'), { recursive: true })
    writeFileSync(join(bundle, 'report', 'summary.md'), '# report\n')
    const { face } = ledger({ meta: { snapshot: { repo: out } } })
    // The repository candidate is `<repo>/exports`; the note is what points at
    // a directory nobody could have guessed.
    await recordExportNote(face, face, RUN, { ...NOTE, outDir: out, bundleDir: bundle })

    const view = await service(face).runReport(RUN)

    expect(view.bundleDir).toBe(bundle)
    expect(view.exportedAt).toBe(1_700_000_000_000)
    expect(view.summaryWritten).toBe(true)
    expect(view.staleAfterFinal).toBe(false)
    expect(view.reexportable).toBe(true)
  })

  it('marks the bundle stale when a final verdict came after it, and names the time', async () => {
    const out = tmpTree()
    const bundle = writeBundle(out, RUN, 1_700_000_000_000)
    const { face } = ledger({ meta: { snapshot: { repo: out } } })
    await recordExportNote(face, face, RUN, { ...NOTE, outDir: out, bundleDir: bundle })
    // The act the bundle cannot carry: a verdict written from the bench after
    // the export. The ledger's clock is well past the bundle's stamp.
    await face.annotate('p0-a-rep1', 'human-final', { verdicts: [{ criterion: 'c2', pass: true }] })

    const view = await service(face).runReport(RUN)

    expect(view.staleAfterFinal).toBe(true)
    expect(view.lastHumanFinalAt).not.toBeNull()
    // A bundle from BEFORE the report action existed has no summary either.
    expect(view.summaryWritten).toBe(false)
  })

  it('a bundle exported after the last final verdict is not stale', async () => {
    const out = tmpTree()
    const { face } = ledger({ meta: { snapshot: { repo: out } } })
    await face.annotate('p0-a-rep1', 'human-final', { verdicts: [] })
    const bundle = writeBundle(out, RUN, 9_000_000_000_000)
    await recordExportNote(face, face, RUN, { ...NOTE, outDir: out, bundleDir: bundle, exportedAt: 9_000_000_000_000 })

    expect((await service(face).runReport(RUN)).staleAfterFinal).toBe(false)
  })

  it('a run with no bundle still reports its final-verdict time, and offers no repeat', async () => {
    const out = tmpTree()
    const { face, base } = ledger({ meta: { snapshot: { repo: out } } })
    await face.annotate('p0-a-rep1', 'human-final', { verdicts: [] })

    const view = await service(face).runReport(RUN)

    expect(view.bundleDir).toBeNull()
    expect(view.lastHumanFinalAt).toBe(base + 1000)
    expect(view.staleAfterFinal).toBe(false)
    expect(view.reexportable).toBe(false)
  })
})

describe('one export action writes the bundle, the report and the note', () => {
  /** mission's Remote, writing a real bundle so the report has something to render. */
  function exportRemote(out: string) {
    return {
      exportPlan: vi.fn(async () => ({ bundleDir: join(out, `${RUN}-bundle`), guardedLayers: [], expectedNs: ['script'], missions: 1, attempts: 1 })),
      exportRun: vi.fn(async (_agent: unknown, request: { outDir: string }) => {
        mkdirSync(request.outDir, { recursive: true })
        return { bundleDir: writeBundle(request.outDir, RUN, 1_700_000_000_000), files: 4 }
      }),
    }
  }

  function service(face: unknown, remote: unknown) {
    return new EvalService({
      get: (name: string) => (name === 'mission' ? face : name === 'missionRemote' ? remote : undefined),
    })
  }

  it('writes report/summary.md into the bundle and records where it went', async () => {
    const out = tmpTree()
    const { face } = ledger()
    const remote = exportRemote(out)

    const result = await service(face, remote).exportRun({ id: 'agent' }, {
      runId: RUN, outDir: out, layers: ['visible'], confirmed: [],
    }, 'tab:s1')

    expect(result.reportError).toBeNull()
    expect(result.summaryPath).toBe(join(out, `${RUN}-bundle`, 'report', 'summary.md'))
    expect(existsSync(result.summaryPath as string)).toBe(true)
    expect(readFileSync(result.summaryPath as string, 'utf8')).toContain(RUN)
    expect(result.reportRows).toBe(1)
    expect(result.noteRecorded).toBe(true)
    expect(readExportState(face, RUN).note?.bundleDir).toBe(result.bundleDir)
  })

  it('a re-export repeats the recorded layers into a NEW directory and leaves the first alone', async () => {
    const out = tmpTree()
    const { face } = ledger()
    const remote = exportRemote(out)
    const svc = service(face, remote)
    const first = await svc.exportRun({ id: 'agent' }, {
      runId: RUN, outDir: out, layers: ['visible'], snapshotDir: '/snap',
      snapshot: { repo: '/repo', commit: 'c0ffee', dataset: 'ds' }, confirmed: [],
    })

    const again = await svc.reexportRun({ id: 'agent' }, { runId: RUN }, 'tab:s1')

    expect(again.bundleDir).not.toBe(first.bundleDir)
    expect(existsSync(first.bundleDir)).toBe(true)
    expect(existsSync(again.bundleDir)).toBe(true)
    // Repeats, never widens: the same layers and snapshot, nothing confirmed.
    const repeated = remote.exportRun.mock.calls[1]?.[1] as Record<string, unknown>
    expect(repeated).toMatchObject({
      runId: RUN, layers: ['visible'], snapshotDir: '/snap',
      snapshot: { repo: '/repo', commit: 'c0ffee', dataset: 'ds' }, confirmed: [],
    })
    expect(String(repeated['outDir'])).toMatch(/\/re-\d{8}T\d{6}Z$/)
    // The note now points at the newest bundle.
    expect(readExportState(face, RUN).note?.bundleDir).toBe(again.bundleDir)
  })

  it('refuses a repeat when nothing was ever exported — the dialog is where layers are chosen', async () => {
    const { face } = ledger()
    await expect(service(face, exportRemote(tmpTree())).reexportRun({ id: 'agent' }, { runId: RUN }))
      .rejects.toThrow(/records no earlier export to repeat/)
  })

  it('the judge bench says the bundle predates the verdicts written on it', async () => {
    const out = tmpTree()
    const { face } = ledger({ meta: { datasetId: 'ds' } })
    const svc = service(face, exportRemote(out))
    await svc.exportRun({ id: 'agent' }, { runId: RUN, outDir: out, layers: ['visible'], confirmed: [] })

    expect((await svc.judgeQueue(RUN)).bundleStale).toBe(false)
    await face.annotate('p0-a-rep1', 'human-final', { verdicts: [] })
    expect((await svc.judgeQueue(RUN)).bundleStale).toBe(true)
  })
})
