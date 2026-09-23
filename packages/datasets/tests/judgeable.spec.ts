/**
 * Judgeability: the three error rules over a rubric's leaves, the two
 * warnings over its judgement sources, and the selection helpers both dataset
 * layouts have to survive.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDatasetsService } from '../src/service.ts'
import { runCli, type CliIo } from '../src/cli.ts'
import { checkRubric, pickRubricPath, probePaths, referencedLeafIds } from '../src/rubric.ts'
import { cleanup, commitAll, git, makeFixtureRepo, writeFiles, type FixtureRepo, stateOptions } from './helpers.ts'

let repo: FixtureRepo | undefined
let dir: string | undefined

afterEach(() => {
  if (repo !== undefined) cleanup(repo.dir)
  if (dir !== undefined) cleanup(dir)
  repo = undefined
  dir = undefined
})

const service = () => createDatasetsService({
  ...stateOptions(mkdtempSync(join(tmpdir(), 'dsh-datasets-state-'))),
  bindingsRoot: mkdtempSync(join(tmpdir(), 'dsh-datasets-bind-')),
})

/** A healthy rubric: one leaf of every kind, plus a well-formed negative leaf. */
const HEALTHY_RUBRIC = `schema_version: dataseek.rubric/2
rubric_id: F1-default
task_id: F1
axes:
  - {id: A1, name: intent, weight: 3}
items:
  - {id: A1-1, axis: A1, weight: 3, kind: llm-draft,
     criterion: the design names who the report goes to, evidence: "stage1.md"}
  - {id: A2-1, axis: A2, weight: 2, kind: objective,
     criterion: "out_of_scope is non-empty", evidence: "stage1.json:out_of_scope"}
  - {id: A3-1, axis: A3, weight: 4, kind: human,
     criterion: the excluded items are worth excluding, evidence: "stage1.json"}
  - {id: A-N1, axis: A2, weight: -3, kind: llm-draft, negative: true,
     criterion: a host change is required but goes unlisted, evidence: "stage1.md"}
`

/** The prose companion, referring only to leaves the rubric declares. */
const HEALTHY_RUBRIC_MD = `# F1 grading

A1-1 carries the intent read. A2-1 is mechanical. A-N1 is the penalty.
Encoding stays UTF-8 and the standards are R1-R6 — neither is a leaf id.
`

/** The `.mjs` probe that makes the objective leaf's verdict reachable. */
const PROBE = "process.exit(0)\n"

/**
 * A dataset in the judging layout, with both item layouts side by side: `F1`
 * uses the convention form (`grading/rubric.yml`, `verify/probes/`), `P0` the
 * register form (`answers/rubric.yml`, `checks/probes/`) — the two the
 * orchestrator's own selection rules cover.
 */
function judgingRepo(overrides: Record<string, string> = {}, omit: readonly string[] = []): string {
  dir = mkdtempSync(join(tmpdir(), 'dsh-datasets-judge-'))
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 'fixture@example.com'])
  git(dir, ['config', 'user.name', 'fixture'])
  writeFiles(dir, {
    'datasets/eval/dataset.json': `${JSON.stringify({
      id: 'eval',
      layers: [
        { name: 'visible', modelFacing: true },
        { name: 'verify', modelFacing: false },
        { name: 'grading', modelFacing: false },
      ],
      register: [
        { item: 'P0', layer: 'visible', files: ['task.md'] },
        { item: 'P0', layer: 'verify', files: ['checks/probes/*'] },
        { item: 'P0', layer: 'grading', files: ['answers/*'] },
      ],
    }, null, 2)}\n`,
    'datasets/eval/items/F1/visible/task.md': '# task\n',
    'datasets/eval/items/F1/verify/probes/assert-stage1.mjs': PROBE,
    'datasets/eval/items/F1/grading/rubric.yml': HEALTHY_RUBRIC,
    'datasets/eval/items/F1/grading/rubric.md': HEALTHY_RUBRIC_MD,
    'datasets/eval/items/P0/task.md': '# placeholder task\n',
    'datasets/eval/items/P0/checks/probes/count.sh': "exit 0\n",
    'datasets/eval/items/P0/answers/rubric.yml': HEALTHY_RUBRIC,
    'datasets/eval/items/P0/answers/rubric.md': HEALTHY_RUBRIC_MD,
    ...overrides,
  })
  for (const path of omit) rmSync(join(dir, path))
  commitAll(dir, 'judging fixture')
  return dir
}

/** One dataset's validate outcome, as `(code, message)` pairs. */
async function outcome(path: string): Promise<{ errors: [string, string][]; warnings: [string, string][] }> {
  const result = await service().validate({ repo: path, operator: true }, 'eval')
  const dataset = result.datasets[0]
  return {
    errors: (dataset?.errors ?? []).map(error => [error.code, error.message]),
    warnings: (dataset?.warnings ?? []).map(warning => [warning.code, warning.message]),
  }
}

const codes = (rows: [string, string][]): string[] => rows.map(([code]) => code)

describe('rubric selection — both dataset layouts', () => {
  it('picks rubric.yml / rubric.yaml, shortest path first', () => {
    expect(pickRubricPath(['rubric.md', 'rubric.yml', 'oracle/notes.md'])).toBe('rubric.yml')
    expect(pickRubricPath(['answers/oracle/rubric.yml', 'answers/rubric.yaml'])).toBe('answers/rubric.yaml')
    expect(pickRubricPath(['checklist.yml', 'standards-notes.yml'])).toBeUndefined()
  })

  it('finds executable probes under any probes/ segment, and only those', () => {
    expect(probePaths([
      'probes/README.md', 'probes/dispatch.mjs', 'checks/probes/count.sh', 'checklist.yml', 'probes/nested/deep.mjs',
    ])).toEqual(['checks/probes/count.sh', 'probes/dispatch.mjs'])
    expect(probePaths(['probes/README.md', 'probes/manual-observation.md'])).toEqual([])
  })

  it('reads leaf-id-shaped references out of prose without swallowing lookalikes', () => {
    expect(referencedLeafIds(HEALTHY_RUBRIC_MD)).toEqual(['A-N1', 'A1-1', 'A2-1'])
    // UTF-8, a hyphenated range, an id-less heading, a date, and a non-numeric
    // suffix are all NOT leaf references.
    expect(referencedLeafIds('UTF-8 R1-R6 X-no-patch 2026-09-08 C1 stage1.json')).toEqual([])
  })
})

describe('checkRubric — the leaf rules', () => {
  it('accepts a healthy rubric and reports its ids and kinds', () => {
    const check = checkRubric(HEALTHY_RUBRIC, 'items/F1/grading/rubric.yml')
    expect(check.errors).toEqual([])
    expect(check.parsed).toBe(true)
    expect(check.ids).toEqual(['A1-1', 'A2-1', 'A3-1', 'A-N1'])
    expect([...check.kinds].sort()).toEqual(['human', 'llm-draft', 'objective'])
  })

  it('fails a rubric that has axes but no leaves', () => {
    const check = checkRubric('axes:\n  - {id: A1, weight: 16}\n', 'items/F3/grading/rubric.yml')
    expect(codes(check.errors.map(e => [e.code, e.message]))).toEqual(['RUBRIC_NO_ITEMS'])
    expect(check.parsed).toBe(false)
    expect(check.errors[0]?.message).toContain('judge-skipped')
    // An empty list is the same fact stated differently.
    expect(checkRubric('items: []\n', 'x').errors[0]?.code).toBe('RUBRIC_NO_ITEMS')
  })

  it('fails a document that is not readable YAML', () => {
    const check = checkRubric('items:\n  - {id: A1\n   bad: [', 'items/F1/grading/rubric.yml')
    expect(check.errors[0]?.code).toBe('RUBRIC_UNREADABLE')
    expect(check.parsed).toBe(false)
  })

  it('names every missing field of a leaf, once per leaf', () => {
    const check = checkRubric(
      'items:\n'
      + '  - {id: A1-1, axis: A1, weight: 3, kind: human, criterion: fine, evidence: "stage1.md"}\n'
      + '  - {id: A1-2, kind: human, criterion: no axis, no weight, no evidence}\n'
      + '  - {axis: A1, weight: 1, kind: human, criterion: nameless, evidence: "x"}\n'
      + '  - a bare scalar is not a leaf\n',
      'items/F1/grading/rubric.yml',
    )
    expect(codes(check.errors.map(e => [e.code, e.message]))).toEqual([
      'RUBRIC_FIELD_MISSING', 'RUBRIC_FIELD_MISSING', 'RUBRIC_FIELD_MISSING',
    ])
    expect(check.errors[0]?.message).toContain('leaf A1-2: missing axis, weight, evidence')
    expect(check.errors[1]?.message).toContain('leaf #3: missing id')
    expect(check.errors[2]?.message).toContain('leaf #4: not a mapping')
  })

  it('rejects a kind that routes to no judgement source', () => {
    const check = checkRubric(
      'items:\n  - {id: A1-1, axis: A1, weight: 3, kind: script, criterion: c, evidence: e}\n',
      'items/F1/grading/rubric.yml',
    )
    expect(check.errors[0]?.code).toBe('RUBRIC_KIND_INVALID')
    expect(check.errors[0]?.message).toContain('objective / llm-draft / human')
    expect(check.kinds.size).toBe(0)
  })

  it('rejects a polarity that disagrees with the weight sign, in both directions', () => {
    const check = checkRubric(
      'items:\n'
      + '  - {id: P1, axis: A, weight: 3, kind: human, negative: true, criterion: c, evidence: e}\n'
      + '  - {id: P2, axis: A, weight: -2, kind: human, criterion: c, evidence: e}\n'
      + '  - {id: P3, axis: A, weight: 0, kind: human, negative: true, criterion: c, evidence: e}\n'
      + '  - {id: OK1, axis: A, weight: -2, kind: human, negative: true, criterion: c, evidence: e}\n'
      + '  - {id: OK2, axis: A, weight: 0, kind: human, veto: true, criterion: c, evidence: e}\n',
      'items/F1/grading/rubric.yml',
    )
    expect(check.errors.map(error => error.code)).toEqual(['RUBRIC_POLARITY', 'RUBRIC_POLARITY', 'RUBRIC_POLARITY'])
    expect(check.errors[0]?.message).toContain('leaf P1: negative: true but weight is 3')
    expect(check.errors[1]?.message).toContain('leaf P2: weight is -2 but negative: true is absent')
    expect(check.errors[2]?.message).toContain('leaf P3: negative: true but weight is 0')
  })
})

describe('service.validate — judgeability over a repository', () => {
  it('stays silent on a healthy suite, in both item layouts', async () => {
    const result = await outcome(judgingRepo())
    expect(result.errors).toEqual([])
    expect(codes(result.warnings)).toEqual([])
  })

  it('never touches a dataset outside the judging layout', async () => {
    // The standard fixture has no grading layer at all: its warning set must
    // be exactly what it was before this check existed.
    repo = makeFixtureRepo()
    const result = await service().validate({ repo: repo.dir, operator: true })
    const all = result.datasets.flatMap(dataset => [
      ...dataset.errors.map(error => error.code),
      ...dataset.warnings.map(warning => warning.code),
    ])
    expect(all).not.toContain('RUBRIC_NO_ITEMS')
    expect(all).not.toContain('OBJECTIVE_NO_PROBE')
    expect(all).not.toContain('RUBRIC_REF_DANGLING')
  })

  it('fails loud on a rubric with axes but no leaves, and the CLI exits 1', async () => {
    const path = judgingRepo({
      'datasets/eval/items/F1/grading/rubric.yml': 'schema_version: dataseek.rubric/2\naxes:\n  - {id: A1, weight: 16}\n',
    })
    const result = await outcome(path)
    expect(result.errors.map(([code]) => code)).toEqual(['RUBRIC_NO_ITEMS'])
    expect(result.errors[0]?.[1]).toContain('items/F1/grading/rubric.yml')
    // The leafless rubric suppresses the two downstream rules: every prose
    // reference would be trivially dangling and would bury the one error.
    expect(codes(result.warnings)).toEqual([])

    let out = ''
    const io: CliIo = { stdout: line => { out += line }, stderr: () => {} }
    const code = await runCli(['validate', '--dataset', 'eval'], io, { DSH_DATASETS_REPO: path })
    expect(code).toBe(1)
    expect(out).toContain('error [RUBRIC_NO_ITEMS]')
  })

  it('warns when an objective leaf has no probe to write its verdict', async () => {
    // Prose under probes/ but nothing executable — the state the real suite
    // stays in until its probes are written.
    const path = judgingRepo(
      { 'datasets/eval/items/F1/verify/probes/README.md': 'the probes are not written yet\n' },
      ['datasets/eval/items/F1/verify/probes/assert-stage1.mjs'],
    )
    const result = await outcome(path)
    expect(result.errors).toEqual([])
    expect(codes(result.warnings)).toEqual(['OBJECTIVE_NO_PROBE'])
    expect(result.warnings[0]?.[1]).toContain('"F1"')
    expect(result.warnings[0]?.[1]).toContain('probes/ segment')
  })

  it('warns when rubric.md refers to a leaf rubric.yml does not declare', async () => {
    const path = judgingRepo({
      'datasets/eval/items/F1/grading/rubric.md':
        '# F1\n\nA1-1 is fine. B2-3 does not give points, and B9-9 is stale too.\n',
    })
    const result = await outcome(path)
    expect(result.errors).toEqual([])
    expect(codes(result.warnings)).toEqual(['RUBRIC_REF_DANGLING', 'RUBRIC_REF_DANGLING'])
    expect(result.warnings.map(([, message]) => message.match(/leaf "([^"]+)"/)?.[1])).toEqual(['B2-3', 'B9-9'])
    expect(result.warnings[0]?.[1]).toContain('items/F1/grading/rubric.md')
  })

  it('resolves the register layout through the role map, not the directory', async () => {
    // P0 keeps its rubric in answers/ and its probe in checks/probes/: both
    // are found through the register, and dropping the probe warns there too.
    const path = judgingRepo(
      { 'datasets/eval/items/P0/checks/probes/README.md': 'not written yet\n' },
      ['datasets/eval/items/P0/checks/probes/count.sh'],
    )
    const result = await outcome(path)
    expect(codes(result.warnings)).toEqual(['OBJECTIVE_NO_PROBE'])
    expect(result.warnings[0]?.[1]).toContain('"P0"')

    // …and a leaf error there names the register path, not a convention one.
    writeFiles(path, {
      'datasets/eval/items/P0/answers/rubric.yml':
        'items:\n  - {id: N1, axis: A, weight: -6, kind: objective, criterion: c, evidence: e}\n',
    })
    commitAll(path, 'P0 leaf loses its polarity marker')
    const broken = await outcome(path)
    expect(broken.errors.map(([code]) => code)).toEqual(['RUBRIC_POLARITY'])
    expect(broken.errors[0]?.[1]).toContain('items/P0/answers/rubric.yml leaf N1')
  })
})
