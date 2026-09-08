/**
 * The probe runner in isolation (protocol §6.7, T28): the two verify layers
 * materialized in the dataset's own relative layout, the dataset-level probes
 * run once per item, the three exit-code states, and the backfill-then-
 * validate order that lets a probe omit the coordinates the orchestrator owns.
 *
 * `runProbes` is driven directly here rather than through `runPlan`: the
 * behaviours under test are per-ITEM (a shared probe runs once for each), and
 * the run-loop fixture has a single item by design.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { DatasetsFace } from '../src/faces.ts'
import { collectProbes, discardProbeDir, itemVerifyRoot, PROBE_EXIT_NOT_APPLICABLE, runProbes } from '../src/judge.ts'

const COMMIT = 'c0ffee'.repeat(6) + 'abcd'
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-eval-probes-'))
  roots.push(root)
  return root
}

/** Layer content keyed the way the datasets service addresses it. */
interface Fixture {
  /** `<taskId>/<layer-relative path>` → content, for the item verify layer. */
  item?: Record<string, string>
  /** Layer-relative path → content, for the DATASET-level verify layer. */
  dataset?: Record<string, string>
  /** `<taskId>/<path>` → content, for the grading layer. */
  grading?: Record<string, string>
  /** Simulate a facade predating `datasetLayers` (it reports none at all). */
  hideDatasetLayers?: boolean
}

/**
 * A datasets face over the fixture. It enforces what the real service does and
 * this module depends on: a sensitive layer is unreachable unless the call
 * names it, and a dataset-level read carries no `item`.
 */
function fakeDatasets(fixture: Fixture): DatasetsFace {
  const item = fixture.item ?? {}
  const dataset = fixture.dataset ?? {}
  const grading = fixture.grading ?? {}
  const assertScoped = (scope: { layers?: readonly string[] }, layer: string): void => {
    if (scope.layers === undefined || !scope.layers.includes(layer)) {
      throw new Error(`fake datasets: layer ${JSON.stringify(layer)} is outside the call's scope`)
    }
  }
  const under = (files: Record<string, string>, id: string): string[] =>
    Object.keys(files).filter(key => key.startsWith(`${id}/`)).map(key => key.slice(id.length + 1)).sort()
  return {
    async snapshot(_scope, datasetId, commit) {
      return { repoPath: '/nowhere', commit: commit ?? COMMIT, datasetId }
    },
    async worktreePath() {
      throw new Error('not used')
    },
    async show(scope, _datasetId, itemId) {
      assertScoped(scope, 'verify')
      const id = itemId ?? ''
      return {
        items: [{ id, layers: { verify: under(item, id) } }],
        ...(fixture.hideDatasetLayers === true ? {} : { datasetLayers: { verify: Object.keys(dataset).sort() } }),
      }
    },
    async read(scope, query) {
      assertScoped(scope, query.layer)
      if (query.layer === 'grading') {
        const content = grading[`${String(query.item)}/${query.path}`]
        if (content === undefined) throw new Error(`fake datasets: no grading file ${query.path}`)
        return { content, commit: COMMIT }
      }
      const content = query.item === undefined ? dataset[query.path] : item[`${query.item}/${query.path}`]
      if (content === undefined) throw new Error(`fake datasets: no verify file ${query.item ?? '<dataset>'}/${query.path}`)
      return { content, commit: COMMIT }
    },
  }
}

function run(fixture: Fixture, taskId: string, options: { probeDir: string; cellDir: string; rubricPath?: string }) {
  return runProbes({
    datasets: fakeDatasets(fixture),
    repo: '/nowhere',
    datasetId: 'harness-comparison',
    taskId,
    commit: COMMIT,
    cellDir: options.cellDir,
    probeDir: options.probeDir,
    rubricPath: options.rubricPath ?? null,
    timeoutMs: 30_000,
  })
}

/** A cell with the one stage file the fixture probes read. */
function makeCell(root: string, stage1: unknown = { out_of_scope: ['a', 'b'] }): string {
  const cell = join(root, 'cell')
  mkdirSync(cell, { recursive: true })
  writeFileSync(join(cell, 'stage1.json'), JSON.stringify(stage1), 'utf8')
  return cell
}

/** A probe that writes exactly the verdict fields it is handed. */
function probeWriting(body: string): string {
  return [
    "import { writeFileSync } from 'node:fs'",
    "const args = process.argv.slice(2)",
    "const flag = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }",
    "const out = flag('--out')",
    body,
    "writeFileSync(out, JSON.stringify(verdict))",
  ].join('\n') + '\n'
}

/* ─────────────── the layout: one ruler, reachable from each item ─────────── */

/** The dataset's shared library, imported by the path that resolves in the repo. */
const SHARED_LIB = "export const RULER = 'the dataset-level ruler'\n"

const ITEM_PROBE_IMPORTING_SHARED = [
  "import { writeFileSync } from 'node:fs'",
  // The SAME relative path that resolves in the dataset repository:
  // items/<id>/verify/probes/ → ../../../../verify/helpers/lib/.
  "import { RULER } from '../../../../verify/helpers/lib/ruler.mjs'",
  "const args = process.argv.slice(2)",
  "const flag = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }",
  "writeFileSync(flag('--out'), JSON.stringify([{",
  "  schema: 'dataseek.verdict/1', criterion: 'A2-1', pass: true, evidence: 'measured with ' + RULER,",
  "}]))",
].join('\n') + '\n'

/** A shared probe: reads the cwd's checklist, so it says WHICH item it judged. */
const SHARED_PROBE = [
  "import { readFileSync, writeFileSync } from 'node:fs'",
  "const args = process.argv.slice(2)",
  "const flag = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }",
  "const task = readFileSync('./checklist.yml', 'utf8').match(/task_id: (\\S+)/)[1]",
  "writeFileSync(flag('--out'), JSON.stringify([{",
  "  schema: 'dataseek.verdict/1', criterion: 'X-no-patch', pass: false,",
  "  evidence: 'checklist beside me says ' + task,",
  "}]))",
].join('\n') + '\n'

describe('collectProbes — both verify layers, one mirrored layout', () => {
  it('puts the dataset-level probes first and namespaces their `by`', () => {
    expect(collectProbes({
      taskId: 'F2-multi-agent-room',
      itemVerifyPaths: ['checklist.yml', 'lib/kit.mjs', 'probes/stage1.mjs', 'probes/README.md'],
      datasetVerifyPaths: ['helpers/README.md', 'helpers/lib/kit.mjs', 'helpers/probes/no-patch.sh'],
    })).toEqual([
      // The veto probe is the dataset's, and the dataset asks for it first.
      {
        origin: 'dataset',
        display: 'helpers/probes/no-patch.sh',
        file: 'verify/helpers/probes/no-patch.sh',
        by: 'shared/helpers/probes/no-patch.sh',
      },
      {
        origin: 'item',
        display: 'probes/stage1.mjs',
        file: 'items/F2-multi-agent-room/verify/probes/stage1.mjs',
        by: 'probes/stage1.mjs',
      },
    ])
  })

  it('degrades to the item’s own probes when the facade reports no shared layer', () => {
    const probes = collectProbes({ taskId: 'F2', itemVerifyPaths: ['probes/a.mjs'] })
    expect(probes.map(probe => probe.by)).toEqual(['probes/a.mjs'])
  })

  it('mirrors the dataset’s own layout, so a repo-relative import resolves', () => {
    expect(itemVerifyRoot('F2')).toBe('items/F2/verify')
  })
})

describe('runProbes — the dataset-level verify layer', () => {
  const fixture: Fixture = {
    dataset: {
      'helpers/lib/ruler.mjs': SHARED_LIB,
      'helpers/probes/shared.mjs': SHARED_PROBE,
    },
    item: {
      'F2/checklist.yml': 'task_id: F2\n',
      'F2/probes/own.mjs': ITEM_PROBE_IMPORTING_SHARED,
      'F3/checklist.yml': 'task_id: F3\n',
    },
  }

  it('lets an item probe import the shared library by its repository-relative path', async () => {
    const root = scratch()
    const result = await run(fixture, 'F2', { probeDir: join(root, 'judge'), cellDir: makeCell(root) })
    const own = result.outcomes.find(outcome => outcome.probe === 'probes/own.mjs')
    expect(own).toMatchObject({ origin: 'item', outcome: 'judged', ok: true, exitCode: 0 })
    expect(own?.verdicts[0]).toMatchObject({
      task: 'F2',
      criterion: 'A2-1',
      evidence: 'measured with the dataset-level ruler',
      by: 'probes/own.mjs',
    })
  })

  it('runs each shared probe once per item, in that item’s verify root', async () => {
    const root = scratch()
    const f2 = await run(fixture, 'F2', { probeDir: join(root, 'j2'), cellDir: makeCell(root) })
    const f3 = await run(fixture, 'F3', { probeDir: join(root, 'j3'), cellDir: makeCell(root) })

    for (const [taskId, result] of [['F2', f2], ['F3', f3]] as const) {
      const shared = result.outcomes.filter(outcome => outcome.origin === 'dataset')
      expect(shared).toHaveLength(1)
      expect(shared[0]).toMatchObject({ probe: 'shared/helpers/probes/shared.mjs', outcome: 'judged' })
      // The cwd is THIS item's verify root: the shared ruler read this item's
      // checklist, which is the whole point of running it once per item.
      expect(shared[0]?.verdicts[0]).toMatchObject({
        task: taskId,
        criterion: 'X-no-patch',
        evidence: `checklist beside me says ${taskId}`,
        by: 'shared/helpers/probes/shared.mjs',
      })
    }
    // F3 ships no probes of its own, and the shared one still judged it.
    expect(f3.outcomes.map(outcome => outcome.origin)).toEqual(['dataset'])
  })

  it('runs nothing at all — and materializes nothing — when neither layer ships a probe', async () => {
    const root = scratch()
    const probeDir = join(root, 'judge')
    const result = await run({ item: { 'F2/checklist.yml': 'task_id: F2\n' } }, 'F2', { probeDir, cellDir: makeCell(root) })
    expect(result).toEqual({ outcomes: [], verdicts: [], where: 'host' })
    expect(existsSync(probeDir)).toBe(false)
  })

  it('ignores a display path that would escape the judging directory', async () => {
    const root = scratch()
    const probeDir = join(root, 'nested', 'judge')
    const result = await run({
      dataset: { '../../probes/escape.mjs': 'process.exit(0)\n', 'helpers/probes/ok.mjs': probeWriting(
        "const verdict = [{ schema: 'dataseek.verdict/1', criterion: 'A', pass: true, evidence: 'x' }]",
      ) },
      item: { 'F2/checklist.yml': 'task_id: F2\n' },
    }, 'F2', { probeDir, cellDir: makeCell(root) })
    expect(existsSync(join(root, 'probes', 'escape.mjs'))).toBe(false)
    // The escaping probe is never written, so it fails to spawn — recorded,
    // not silently dropped, and it does not stop the sound probe beside it.
    expect(result.outcomes.map(outcome => outcome.outcome)).toEqual(['probe-failed', 'judged'])
  })

  it('leaves the item probes to run alone against a facade with no shared layer', async () => {
    const root = scratch()
    const result = await run({ ...fixture, hideDatasetLayers: true, item: {
      'F2/checklist.yml': 'task_id: F2\n',
      'F2/probes/own.mjs': probeWriting(
        "const verdict = [{ schema: 'dataseek.verdict/1', criterion: 'A', pass: true, evidence: 'alone' }]",
      ),
    } }, 'F2', { probeDir: join(root, 'judge'), cellDir: makeCell(root) })
    expect(result.outcomes.map(outcome => outcome.probe)).toEqual(['probes/own.mjs'])
  })
})

/* ──────────────────────── the three exit-code states ────────────────────── */

describe('runProbes — the exit code carries three states (§6.7)', () => {
  const JUDGED = probeWriting(
    "const verdict = [{ schema: 'dataseek.verdict/1', criterion: 'A2-1', pass: false, evidence: 'out_of_scope is empty' }]",
  )
  const FAILED = "console.error('probe: cannot parse stage1.json')\nprocess.exit(1)\n"
  const NOT_APPLICABLE = [
    "console.error('stage three never ran in this cell — C1 cannot be judged this round')",
    "console.error('(a second stderr line the record does not need)')",
    `process.exit(${PROBE_EXIT_NOT_APPLICABLE})`,
  ].join('\n') + '\n'
  const SILENT = 'process.exit(0)\n'

  const fixture: Fixture = {
    item: {
      'F2/probes/a-judged.mjs': JUDGED,
      'F2/probes/b-failed.mjs': FAILED,
      'F2/probes/c-not-applicable.mjs': NOT_APPLICABLE,
      'F2/probes/d-silent.mjs': SILENT,
    },
  }

  it('separates judged, failed and not-applicable — and keeps silent-success a failure', async () => {
    const root = scratch()
    const result = await run(fixture, 'F2', { probeDir: join(root, 'judge'), cellDir: makeCell(root) })
    expect(result.outcomes.map(outcome => [outcome.probe, outcome.outcome])).toEqual([
      ['probes/a-judged.mjs', 'judged'],
      ['probes/b-failed.mjs', 'probe-failed'],
      ['probes/c-not-applicable.mjs', 'probe-skipped'],
      ['probes/d-silent.mjs', 'probe-failed'],
    ])
    // `pass: false` is a judgement, not a failure — that is the first state.
    expect(result.verdicts).toHaveLength(1)
    expect(result.verdicts[0]).toMatchObject({ criterion: 'A2-1', pass: false })

    const skipped = result.outcomes[2]
    expect(skipped).toMatchObject({ exitCode: PROBE_EXIT_NOT_APPLICABLE, ok: false, verdicts: [] })
    // The first stderr line says why, and it is NOT recorded as an error.
    expect(skipped?.reason).toBe('stage three never ran in this cell — C1 cannot be judged this round')
    expect(skipped?.error).toBeUndefined()

    expect(result.outcomes[1]?.error).toContain('cannot parse stage1.json')
    expect(result.outcomes[3]?.error).toContain('exited 0 but produced no readable verdict')
  })

  it('records a skip that says nothing on stderr rather than an empty reason', async () => {
    const root = scratch()
    const result = await run({ item: { 'F2/probes/mute.sh': `exit ${PROBE_EXIT_NOT_APPLICABLE}\n` } }, 'F2',
      { probeDir: join(root, 'judge'), cellDir: makeCell(root) })
    expect(result.outcomes[0]).toMatchObject({ outcome: 'probe-skipped', reason: 'the probe reported nothing on stderr' })
  })

  it('reads 2 as a failure, because 2 is the usage-error code a mis-invoked probe returns', async () => {
    const root = scratch()
    const result = await run({ item: { 'F2/probes/usage.mjs': "console.error('probe: missing --cell')\nprocess.exit(2)\n" } },
      'F2', { probeDir: join(root, 'judge'), cellDir: makeCell(root) })
    expect(result.outcomes[0]).toMatchObject({ outcome: 'probe-failed', exitCode: 2 })
  })
})

/* ─────────────────── backfill before validation (§6.7) ──────────────────── */

describe('runProbes — task and by are the orchestrator’s, backfilled before validation', () => {
  it('accepts a verdict that omits both coordinates entirely', async () => {
    const root = scratch()
    const result = await run({ item: { 'F2/probes/bare.mjs': probeWriting(
      "const verdict = [{ schema: 'dataseek.verdict/1', criterion: 'A2-1', pass: true, evidence: 'both fields absent' }]",
    ) } }, 'F2', { probeDir: join(root, 'judge'), cellDir: makeCell(root) })
    // Validating first would have voided this for missing two required fields
    // the orchestrator was about to supply.
    expect(result.outcomes[0]).toMatchObject({ outcome: 'judged' })
    expect(result.verdicts[0]).toMatchObject({ task: 'F2', by: 'probes/bare.mjs' })
    expect(result.outcomes[0]?.overwritten).toBeUndefined()
  })

  it('overwrites the coordinates a probe got wrong, and records that it did', async () => {
    const root = scratch()
    const result = await run({ item: { 'F2/probes/wrong.mjs': probeWriting(
      "const verdict = [{ schema: 'dataseek.verdict/1', task: 'F9-wrong', criterion: 'A2-1',"
      + " pass: true, evidence: 'x', by: 'somebody-else' }]",
    ) } }, 'F2', { probeDir: join(root, 'judge'), cellDir: makeCell(root) })
    expect(result.verdicts[0]).toMatchObject({ task: 'F2', by: 'probes/wrong.mjs' })
    expect(result.outcomes[0]?.overwritten).toEqual(['by', 'task'])
  })

  it('says nothing when the probe echoed the coordinates correctly', async () => {
    const root = scratch()
    const result = await run({ item: { 'F2/probes/echo.mjs': probeWriting(
      "const verdict = [{ schema: 'dataseek.verdict/1', task: 'F2', criterion: 'A2-1',"
      + " pass: true, evidence: 'x', by: 'probes/echo.mjs' }]",
    ) } }, 'F2', { probeDir: join(root, 'judge'), cellDir: makeCell(root) })
    expect(result.outcomes[0]?.overwritten).toBeUndefined()
  })
})

/* ───────────────────── the ratio field's numeric contract ───────────────── */

describe('runProbes — a ratio is checked where it is produced (§6.5)', () => {
  const withRatio = (fields: string): string => probeWriting(
    `const verdict = [{ schema: 'dataseek.verdict/1', criterion: 'C1', evidence: 'core standards', ${fields} }]`,
  )

  it('keeps a sound ratio, whichever way it points', async () => {
    const root = scratch()
    const result = await run({ item: {
      'F2/probes/partial.mjs': withRatio('pass: false, ratio: { passed: 6, total: 9 }'),
      'F2/probes/full.mjs': withRatio('pass: true, ratio: { passed: 9, total: 9 }'),
      'F2/probes/none.mjs': withRatio('pass: false, ratio: { passed: 0, total: 9 }'),
    } }, 'F2', { probeDir: join(root, 'judge'), cellDir: makeCell(root) })
    expect(result.outcomes.every(outcome => outcome.outcome === 'judged')).toBe(true)
    expect(result.verdicts.map(verdict => verdict['ratio'])).toEqual([
      { passed: 9, total: 9 }, { passed: 0, total: 9 }, { passed: 6, total: 9 },
    ])
  })

  it('refuses an out-of-bounds ratio at the source instead of letting the report degrade it', async () => {
    const root = scratch()
    const result = await run({ item: {
      'F2/probes/a-empty.mjs': withRatio('pass: false, ratio: { passed: 0, total: 0 }'),
      'F2/probes/b-over.mjs': withRatio('pass: true, ratio: { passed: 11, total: 9 }'),
      'F2/probes/c-negative.mjs': withRatio('pass: false, ratio: { passed: -1, total: 9 }'),
    } }, 'F2', { probeDir: join(root, 'judge'), cellDir: makeCell(root) })
    expect(result.verdicts).toEqual([])
    for (const outcome of result.outcomes) {
      expect(outcome.outcome).toBe('probe-failed')
      expect(outcome.error).toContain('is out of bounds')
    }
  })

  it('refuses a pass that contradicts its own ratio', async () => {
    const root = scratch()
    const result = await run({ item: {
      'F2/probes/a-overclaim.mjs': withRatio('pass: true, ratio: { passed: 6, total: 9 }'),
      'F2/probes/b-underclaim.mjs': withRatio('pass: false, ratio: { passed: 9, total: 9 }'),
    } }, 'F2', { probeDir: join(root, 'judge'), cellDir: makeCell(root) })
    expect(result.verdicts).toEqual([])
    expect(result.outcomes[0]?.error).toContain('contradicts ratio 6/9')
    expect(result.outcomes[1]?.error).toContain('contradicts ratio 9/9')
  })

  it('keeps the sound rows of a partly bad file and still says why the rest went', async () => {
    const root = scratch()
    const result = await run({ item: { 'F2/probes/mixed.mjs': probeWriting([
      "const verdict = [",
      "  { schema: 'dataseek.verdict/1', criterion: 'C1', pass: false, ratio: { passed: 6, total: 9 }, evidence: 'ok' },",
      "  { schema: 'dataseek.verdict/1', criterion: 'C2', pass: true, ratio: { passed: 3, total: 5 }, evidence: 'bad' },",
      "]",
    ].join('\n')) } }, 'F2', { probeDir: join(root, 'judge'), cellDir: makeCell(root) })
    expect(result.outcomes[0]).toMatchObject({ outcome: 'judged' })
    expect(result.verdicts.map(verdict => verdict['criterion'])).toEqual(['C1'])
    expect(result.outcomes[0]?.dropped?.[0]).toContain('contradicts ratio 3/5')
  })
})

/* ───────────────────────── the judging directory ────────────────────────── */

describe('runProbes — the judging directory', () => {
  it('hands every probe the rubric, from outside the mirrored layout', async () => {
    const root = scratch()
    const probeDir = join(root, 'judge')
    const result = await run({
      item: { 'F2/probes/reads-rubric.mjs': probeWriting([
        "import { readFileSync } from 'node:fs'",
        "const bytes = readFileSync(flag('--rubric'), 'utf8').length",
        "const verdict = [{ schema: 'dataseek.verdict/1', criterion: 'A2-1', pass: true, evidence: 'rubric ' + bytes + ' bytes' }]",
      ].join('\n')) },
      grading: { 'F2/rubric.yml': 'rubric_id: F2\n' },
    }, 'F2', { probeDir, cellDir: makeCell(root), rubricPath: 'rubric.yml' })
    expect(result.verdicts[0]?.['evidence']).toBe('rubric 14 bytes')
    // The grading layer never lands inside either mirrored verify tree — a
    // probe walking its own layer must not stumble onto the answer key.
    expect(readdirSync(probeDir).sort()).toEqual(['.out', '.rubric.yml', 'items'])
  })

  it('is removed whole once the probes have run — the answer key does not stay overnight', async () => {
    const root = scratch()
    const probeDir = join(root, 'judge')
    await run({ item: { 'F2/probes/a.mjs': probeWriting(
      "const verdict = [{ schema: 'dataseek.verdict/1', criterion: 'A', pass: true, evidence: 'x' }]",
    ) } }, 'F2', { probeDir, cellDir: makeCell(root) })
    expect(existsSync(join(probeDir, itemVerifyRoot('F2'), 'probes', 'a.mjs'))).toBe(true)
    discardProbeDir(probeDir)
    expect(existsSync(probeDir)).toBe(false)
  })

  it('creates the item’s verify root even when only the shared layer ships probes', async () => {
    const root = scratch()
    const probeDir = join(root, 'judge')
    await run({
      dataset: { 'helpers/probes/only.mjs': probeWriting(
        "const verdict = [{ schema: 'dataseek.verdict/1', criterion: 'X', pass: false, evidence: 'ran' }]",
      ) },
      item: {},
    }, 'F2', { probeDir, cellDir: makeCell(root) })
    expect(existsSync(join(probeDir, itemVerifyRoot('F2')))).toBe(true)
    expect(dirname(join(probeDir, itemVerifyRoot('F2')))).toBe(join(probeDir, 'items', 'F2'))
  })
})
