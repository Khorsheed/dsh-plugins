/**
 * Shared test fixtures: throwaway git repositories under the runtime temp
 * directory (never a hardcoded path — the repo is public and the hygiene gate
 * rejects machine-specific absolute paths).
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** Run git synchronously in the fixture (setup-only; the code under test uses async git). */
export function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], { cwd, encoding: 'utf8' })
}

/** A throwaway git repository with a standard two-dataset fixture committed. */
export interface FixtureRepo {
  dir: string
  commit: string
}

/** The standard fixture descriptor of dataset `alpha` (layers: visible + hidden). */
export const ALPHA_DESCRIPTOR = {
  id: 'alpha',
  name: 'Alpha dataset',
  layers: [
    { name: 'visible' },
    { name: 'hidden', modelFacing: false },
  ],
  itemMetaSchema: { type: 'object', properties: { difficulty: { type: 'string' } } },
  extra: { passthrough: true },
}

/** Write files (repo-relative path → content) into a directory. */
export function writeFiles(dir: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    const target = join(dir, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content, 'utf8')
  }
}

/** Commit every change in the fixture repository; returns the new HEAD. */
export function commitAll(dir: string, message: string): string {
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-qm', message])
  return git(dir, ['rev-parse', 'HEAD']).trim()
}

/**
 * Create a fixture repository:
 * - dataset `alpha`: layers `visible`/`hidden` (hidden is modelFacing:false),
 *   items `i1` (metadata + one file per layer) and `i2` (visible only), plus
 *   a passthrough descriptor file. Dataset-level content: `visible/guide.md`
 *   and `hidden/answers.md` (declared layers at the dataset level, shared
 *   across items) plus `drafts/notes.md` (undeclared — stays passthrough).
 * - dataset `beta`: one `visible` layer, one item.
 */
export function makeFixtureRepo(): FixtureRepo {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-datasets-test-'))
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 'fixture@example.com'])
  git(dir, ['config', 'user.name', 'fixture'])
  writeFiles(dir, {
    'datasets/alpha/dataset.json': `${JSON.stringify(ALPHA_DESCRIPTOR, null, 2)}\n`,
    'datasets/alpha/handbook.md': '# handbook passthrough\n',
    'datasets/alpha/drafts/notes.md': 'drafts passthrough\n',
    'datasets/alpha/visible/guide.md': 'shared guide v1\n',
    'datasets/alpha/hidden/answers.md': 'shared answers v1\n',
    'datasets/alpha/items/i1/item.json': '{"difficulty":"hard"}\n',
    'datasets/alpha/items/i1/visible/task.md': 'task one v1\n',
    'datasets/alpha/items/i1/hidden/notes.md': 'hidden notes v1\n',
    'datasets/alpha/items/i2/visible/task.md': 'task two v1\n',
    'datasets/beta/dataset.json': '{"id":"beta","layers":[{"name":"visible"}]}\n',
    'datasets/beta/items/b1/visible/data.txt': 'beta data\n',
  })
  return { dir, commit: commitAll(dir, 'fixture') }
}

/** Remove a fixture directory tree. */
export function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

/**
 * The judging-convention descriptor of dataset `bench`: the three layer names
 * the authoring protocol's §6.7/§6.8 fix (`visible` / `verify` / `grading`),
 * and a `register` that homes item `R1` the way harness-comparison homes
 * `P0-placeholder` — the item-relative layout. Item `C1` of the same dataset
 * uses the convention layout instead, so one fixture carries both forms.
 */
export const BENCH_DESCRIPTOR = {
  id: 'bench',
  name: 'Judging fixture',
  layers: [
    { name: 'visible', modelFacing: true },
    { name: 'verify', modelFacing: false },
    { name: 'grading', modelFacing: false },
  ],
  register: [
    { item: 'R1', layer: 'visible', files: ['task.md', 'standards.yml'] },
    { item: 'R1', layer: 'verify', files: ['checks/*', 'checks/probes/*'] },
    { item: 'R1', layer: 'grading', files: ['answers/*', 'answers/oracle/*'] },
  ],
}

/** A rubric with one leaf per mechanical kind — the judgeability numbers read it. */
export const BENCH_RUBRIC = `items:
  - id: A1-1
    axis: A1
    weight: 3
    kind: objective
    criterion: every link in the write-up resolves
    evidence: the link-check probe's output
  - id: A1-2
    axis: A1
    weight: 2
    kind: llm-draft
    criterion: the write-up explains why the change was needed
    evidence: the stage-1 submission
`

/**
 * A fixture repository shaped like harness-comparison: one dataset (`bench`)
 * with the three judging layers, a dataset-level stage prompt, a stage schema
 * in the passthrough zone, a register-homed item (`R1`) and a convention-homed
 * one (`C1`).
 */
export function makeJudgingRepo(): FixtureRepo {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-datasets-bench-'))
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 'fixture@example.com'])
  git(dir, ['config', 'user.name', 'fixture'])
  writeFiles(dir, {
    'datasets/bench/dataset.json': `${JSON.stringify(BENCH_DESCRIPTOR, null, 2)}\n`,
    'datasets/bench/manifest.yml': 'suite_id: bench\n',
    'datasets/bench/schemas/stage1.json': '{"type":"object"}\n',
    'datasets/bench/visible/prompts/stage1.md': 'Work the stage.\n',
    // R1 — the register layout (files sit at the item root, roles come from
    // dataset.json's register entries).
    'datasets/bench/items/R1/item.json': '{"id":"R1","title":"registered"}\n',
    'datasets/bench/items/R1/task.md': 'do the registered task\n',
    'datasets/bench/items/R1/standards.yml': 'standards: [ok]\n',
    'datasets/bench/items/R1/answers/rubric.yml': BENCH_RUBRIC,
    'datasets/bench/items/R1/answers/oracle/notes.md': 'the answer\n',
    'datasets/bench/items/R1/checks/probes/link-check.mjs': 'process.exit(0)\n',
    // C1 — the convention layout (layer directories inside the item).
    'datasets/bench/items/C1/item.json': '{"id":"C1","title":"conventional"}\n',
    'datasets/bench/items/C1/visible/task.md': 'do the conventional task\n',
    'datasets/bench/items/C1/visible/standards.yml': 'standards: [ok]\n',
    'datasets/bench/items/C1/grading/rubric.yml': BENCH_RUBRIC,
    'datasets/bench/items/C1/verify/probes/stage1.mjs': 'process.exit(0)\n',
  })
  return { dir, commit: commitAll(dir, 'bench fixture') }
}
