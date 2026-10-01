/**
 * Judge-rule contract (T89): the rules eval's orchestrator and datasets'
 * judgeability check BOTH implement, pinned to agree on one shared fixture.
 *
 * Why the rules exist twice: datasets checks a dataset before anything runs
 * ("would a run be able to judge this item?") and eval is the run that judges
 * it. Each package must install alone, so neither imports the other — and two
 * copies of a rule drift silently. This spec is the one place both copies are
 * loaded side by side (a repo-level spec, so no package gains a dependency
 * edge); a change to either rule that the other does not mirror turns it red.
 *
 * The rules:
 * - **rubric selection** (`pickRubricPath`): which file in an item's
 *   `grading` layer is THE rubric. If they disagree, datasets validates a
 *   file the run never reads.
 * - **probe discovery** (`probePaths`): which `verify` files are executable
 *   probes, and in what order. datasets warns "objective leaves but no probe"
 *   by this rule; eval executes by it.
 * - **leaf reading**: every leaf datasets' `checkRubric` accepts must be read
 *   by eval's `rubricCriteria` under its own kind, with the same id.
 *
 * Documented (not unified) differences:
 * - "no rubric" is `undefined` in datasets and `null` in eval — each matches
 *   its package's own convention and both are internal return values, so the
 *   spec compares through `?? null` rather than touching either signature.
 * - leaf strictness is one-directional: datasets rejects a whitespace-only
 *   string and a leaf missing `axis` / `weight` / `evidence`, while eval reads
 *   any leaf with a non-empty `id` and `criterion`. The contract is
 *   "datasets-valid ⇒ eval-readable"; the converse is deliberately not
 *   required (eval tolerates a dataset that skipped validation), and the
 *   cases where they part are pinned below so a change on either side is
 *   still seen.
 */
import { describe, expect, it } from 'vitest'
import {
  checkRubric,
  pickRubricPath as datasetsPickRubric,
  probePaths as datasetsProbePaths,
  RUBRIC_KINDS,
} from '../packages/datasets/src/rubric.ts'
import {
  pickRubricPath as evalPickRubric,
  probePaths as evalProbePaths,
  rubricCriteria,
} from '../packages/eval/src/judge.ts'

/** Grading-layer display paths → the rubric both sides must pick (null = none). */
const RUBRIC_CASES: ReadonlyArray<{ name: string; paths: string[]; rubric: string | null }> = [
  { name: 'convention layout', paths: ['rubric.yml', 'rubric.md', 'answer.md'], rubric: 'rubric.yml' },
  { name: 'register layout', paths: ['answers/rubric.yml', 'answers/rubric.md'], rubric: 'answers/rubric.yml' },
  { name: '.yaml and upper case', paths: ['notes.md', 'RUBRIC.YAML'], rubric: 'RUBRIC.YAML' },
  { name: 'shortest path wins over a nested variant', paths: ['old/v1/rubric.yml', 'answers/rubric.yml', 'x/rubric.yaml'], rubric: 'x/rubric.yaml' },
  { name: 'same length breaks ties lexically', paths: ['b/rubric.yml', 'a/rubric.yml'], rubric: 'a/rubric.yml' },
  { name: 'a prefix is not the name', paths: ['my-rubric.yml', 'rubric.yml.bak', 'rubric.json'], rubric: null },
  { name: 'empty layer', paths: [], rubric: null },
]

/** Verify-layer display paths → the probes both sides must find, in execution order. */
const PROBE_CASES: ReadonlyArray<{ name: string; paths: string[]; probes: string[] }> = [
  { name: 'convention layout, sorted', paths: ['probes/b.sh', 'probes/a.mjs', 'checklist.md'], probes: ['probes/a.mjs', 'probes/b.sh'] },
  { name: 'register layout', paths: ['checks/probes/x.mjs', 'checks/readme.md'], probes: ['checks/probes/x.mjs'] },
  { name: 'upper-case extension', paths: ['probes/RUN.SH'], probes: ['probes/RUN.SH'] },
  { name: 'only direct children of a probes/ segment', paths: ['probes/lib/helper.mjs', 'probes/a.js', 'probes/a.ts', 'myprobes/a.sh'], probes: [] },
  { name: 'empty layer', paths: [], probes: [] },
]

const LEAF = { axis: 'A', weight: 1, evidence: 'stage1.md' }

/** Rubric documents: what datasets says, and what eval reads, per kind. */
const LEAF_CASES: ReadonlyArray<{ name: string; doc: unknown; datasetsValid: boolean; evalReads: Record<string, string[]> }> = [
  {
    name: 'one leaf of each kind',
    doc: {
      items: [
        { id: 'A1-1', kind: 'objective', criterion: 'builds', ...LEAF },
        { id: 'A1-2', kind: 'llm-draft', criterion: 'explains', ...LEAF },
        { id: 'A1-3', kind: 'human', criterion: 'reads well', ...LEAF },
      ],
    },
    datasetsValid: true,
    evalReads: { 'objective': ['A1-1'], 'llm-draft': ['A1-2'], 'human': ['A1-3'] },
  },
  {
    name: 'negative leaf stated consistently',
    doc: { items: [{ id: 'A-N1', kind: 'llm-draft', criterion: 'no leak', negative: true, ...LEAF, weight: -2 }] },
    datasetsValid: true,
    evalReads: { 'objective': [], 'llm-draft': ['A-N1'], 'human': [] },
  },
  // ── where the two part (pinned, see the module comment) ──
  {
    name: 'missing axis/weight/evidence: datasets rejects, eval still reads',
    doc: { items: [{ id: 'B1', kind: 'llm-draft', criterion: 'c' }] },
    datasetsValid: false,
    evalReads: { 'objective': [], 'llm-draft': ['B1'], 'human': [] },
  },
  {
    name: 'only evidence missing: datasets rejects, eval still reads',
    doc: { items: [{ id: 'B4', kind: 'objective', criterion: 'c', axis: 'A', weight: 1 }] },
    datasetsValid: false,
    evalReads: { 'objective': ['B4'], 'llm-draft': [], 'human': [] },
  },
  {
    name: 'whitespace-only criterion: datasets rejects, eval still reads',
    doc: { items: [{ id: 'B2', kind: 'human', criterion: '   ', ...LEAF }] },
    datasetsValid: false,
    evalReads: { 'objective': [], 'llm-draft': [], 'human': ['B2'] },
  },
  {
    name: 'unknown kind: datasets rejects, eval routes it nowhere',
    doc: { items: [{ id: 'B3', kind: 'oracle', criterion: 'c', ...LEAF }] },
    datasetsValid: false,
    evalReads: { 'objective': [], 'llm-draft': [], 'human': [] },
  },
  {
    name: 'no leaves: datasets rejects, eval reads nothing',
    doc: { axes: [{ id: 'A' }] },
    datasetsValid: false,
    evalReads: { 'objective': [], 'llm-draft': [], 'human': [] },
  },
]

describe('judge-rule contract: eval judge.ts ⇔ datasets rubric.ts', () => {
  it.each(RUBRIC_CASES)('rubric selection agrees: $name', ({ paths, rubric }) => {
    expect(datasetsPickRubric(paths) ?? null).toBe(rubric)
    expect(evalPickRubric(paths)).toBe(rubric)
  })

  it.each(PROBE_CASES)('probe discovery agrees: $name', ({ paths, probes }) => {
    expect(datasetsProbePaths(paths)).toEqual(probes)
    expect(evalProbePaths(paths)).toEqual(probes)
  })

  it.each(LEAF_CASES)('leaf reading: $name', ({ doc, datasetsValid, evalReads }) => {
    const text = JSON.stringify(doc) // JSON is YAML; both sides parse with js-yaml
    const check = checkRubric(text, 'rubric.yml')
    expect(check.errors.length === 0).toBe(datasetsValid)
    for (const kind of RUBRIC_KINDS) {
      expect(rubricCriteria(text, kind).map(c => c.id), kind).toEqual(evalReads[kind])
    }
    if (datasetsValid) {
      // datasets-valid ⇒ eval reads every accepted leaf, under the same kind set.
      const read = RUBRIC_KINDS.flatMap(kind => rubricCriteria(text, kind).map(c => c.id))
      expect(read.sort()).toEqual([...check.ids].sort())
      expect([...check.kinds].sort()).toEqual(RUBRIC_KINDS.filter(kind => rubricCriteria(text, kind).length > 0).sort())
    }
  })
})
