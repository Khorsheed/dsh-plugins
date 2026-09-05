/**
 * The run loop v0 against FAKES of the three upstream faces (no real
 * integration here — the real instance run is the acceptance step, not a
 * unit test). The fake mission re-implements mission's enforcement contract
 * on the generated template: declared edges only, guards deterministic
 * (schema-check against the template-referenced schema files, file-check
 * non-empty directories), submit validates the INTENDED edge, retries open a
 * new attempt. The fake datasets serves an in-memory visible layer. The fake
 * localAgent writes stage outputs INTO the delegation cwd — proving the
 * per-cell directory flows end to end — and can be scripted to throw, hang,
 * or produce bad payloads.
 */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runPlan, EvalRunRefused } from '../src/run.ts'
import type { DatasetsFace, LocalAgentFace, MissionFace, MissionSubmitFile } from '../src/faces.ts'
import type { DelegationResult, DelegationRun } from '../src/faces.ts'
import { canonicalJson } from '../src/hash.ts'
import { expandMatrix, orderCells } from '../src/matrix.ts'
import { validateJson } from '../src/schema.ts'
import { cleanupTmp } from './helpers.ts'

const FIXTURE_DATASET = join(import.meta.dirname, 'fixtures', 'dataset', 'datasets', 'harness-comparison')

const tmpDirs: string[] = []
function tmpTree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-eval-run-'))
  tmpDirs.push(dir)
  return dir
}
afterEach(() => { cleanupTmp(); for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const PROMPT_ONE = 'STAGE-ONE PROMPT: design the interaction.\n'
const PROMPT_TWO = 'STAGE-TWO PROMPT: plan the iterations.\n'
const TASK = 'Task: count the files in a directory.\n'
const STANDARDS = 'S1: be correct.\n'
const FAKE_COMMIT = 'a'.repeat(40)
const PARENT_SESSION = 'sess-eval-parent'

/** Stage payloads by schema conformance. */
const VALID_STAGE1 = {
  design_decisions: [{ aspect: 'layout', decision: 'tree', rationale: 'obvious' }],
  out_of_scope: [{ item: 'i18n', reason: 'later' }],
  host_change_risks: [],
  acceptance_criteria: ['counts match'],
}
const VALID_STAGE2 = { feasible: true, mechanisms_considered: [], stage1_risks_resolved: [], iterations: [] }
const HALT_STAGE2 = { feasible: false }

/** Copy the checked-in dataset fixture into a writable tmp tree and add the visible layer + plan. */
function makeDatasetTree(): string {
  const root = tmpTree()
  const dataset = join(root, 'datasets', 'harness-comparison')
  cpSync(FIXTURE_DATASET, dataset, { recursive: true })
  mkdirSync(join(dataset, 'plans'), { recursive: true })
  mkdirSync(join(dataset, 'visible', 'prompts'), { recursive: true })
  writeFileSync(join(dataset, 'visible', 'prompts', 'stage1.md'), PROMPT_ONE)
  writeFileSync(join(dataset, 'visible', 'prompts', 'stage2.md'), PROMPT_TWO)
  return root
}

function writePlan(root: string, overrides: Record<string, unknown> = {}, name = 't8-run'): string {
  const plan = {
    schema: 'dataseek.plan/1',
    dataset: { repo: '~/nonexistent-eval-run-repo', commit: null, id: 'harness-comparison', items: ['P0-placeholder'] },
    conditions: ['dsh-exec'],
    reps: 1,
    stages: ['stage1', 'stage2'],
    order: { seed: 42, interleave: false },
    budget: { activeMinutes: 60, turns: 10 },
    judge: { conditions: [], samples: 0 },
    expectedNs: ['script'],
    ...overrides,
  }
  const path = join(root, 'datasets', 'harness-comparison', 'plans', `${name}.json`)
  writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`)
  return path
}

function readPlanDoc(planPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(planPath, 'utf8')) as Record<string, unknown>
}

/* ───────────────────────── fake datasets face ─────────────────────────── */

function fakeDatasets(root: string): DatasetsFace {
  const datasetRoot = join(root, 'datasets', 'harness-comparison')
  const itemFiles = new Map<string, string>([
    ['P0-placeholder/task.md', TASK],
    ['P0-placeholder/standards.yml', STANDARDS],
  ])
  const datasetFiles = new Map<string, string>([
    ['visible/prompts/stage1.md', PROMPT_ONE],
    ['visible/prompts/stage2.md', PROMPT_TWO],
  ])
  return {
    async snapshot(_scope, datasetId, commit) {
      return { repoPath: root, commit: commit ?? FAKE_COMMIT, datasetId }
    },
    async worktreePath(_scope, _datasetId, options) {
      return { path: join(datasetRoot, 'worktree'), commit: options?.commit ?? FAKE_COMMIT, layers: ['visible'], reused: false }
    },
    async show(_scope, _datasetId, itemId) {
      const visible = ['task.md', 'standards.yml'].filter(rel => itemFiles.has(`${itemId}/${rel}`))
      return { items: [{ id: itemId ?? 'P0-placeholder', layers: { visible } }] }
    },
    async read(_scope, query) {
      if (query.item === undefined) {
        const content = datasetFiles.get(`${query.layer}/${query.path}`)
        if (content === undefined) throw new Error(`fake datasets: no dataset-level file ${query.layer}/${query.path}`)
        return { content, commit: query.commit ?? FAKE_COMMIT }
      }
      const content = itemFiles.get(`${query.item}/${query.path}`)
      if (content === undefined) throw new Error(`fake datasets: no item file ${query.item}/${query.path}`)
      return { content, commit: query.commit ?? FAKE_COMMIT }
    },
  }
}

/* ────────────────────────── fake mission face ─────────────────────────── */

interface FakeAttempt {
  attempt: number
  state: string
  retry?: { reason: string; category: string }
  submission?: { json: unknown }
  refs: { sessions?: string[] }
  artifacts: Array<{ path: string; kind: string }>
}
interface FakeMissionRecord {
  currentAttempt: number
  attempts: FakeAttempt[]
  annotations: Array<{ ns: string; payload: unknown; by?: string }>
}
interface FakeRun {
  meta: Record<string, unknown>
  stateMachine: { states: string[]; transitions: Array<{ from: string; to: string; guard?: Record<string, unknown> }> }
  templateDir: string
  originSession?: string
  missions: Map<string, FakeMissionRecord>
}

class FakeMission implements MissionFace {
  readonly dataDir: string
  runs = new Map<string, FakeRun>()
  exportRequests: Array<Record<string, unknown>> = []
  private seq = 0

  constructor(dataDir: string) { this.dataDir = dataDir }

  async runCreate(options: { templatePath?: string; runId?: string; meta?: Record<string, unknown>; originSession?: string }): Promise<{ run: { id: string }; existed: boolean; lint: { errors: string[]; warnings: string[] } }> {
    // The real parseTemplate accepts the machine nested under `stateMachine`
    // or flat at the top level; the generated template is flat (bench-v1 shape).
    const template = JSON.parse(readFileSync(options.templatePath as string, 'utf8')) as {
      stateMachine?: FakeRun['stateMachine']
      missions?: Array<{ id: string }>
    } & Partial<FakeRun['stateMachine']>
    const stateMachine: FakeRun['stateMachine'] = template.stateMachine ?? {
      states: template.states as string[],
      transitions: template.transitions as FakeRun['stateMachine']['transitions'],
      releasableStates: (template.releasableStates ?? []) as string[],
    }
    const runId = options.runId ?? `run-${++this.seq}`
    this.runs.set(runId, {
      meta: options.meta ?? {},
      stateMachine,
      templateDir: dirname(options.templatePath as string),
      ...(options.originSession !== undefined ? { originSession: options.originSession } : {}),
      missions: new Map(),
    })
    const run = this.runs.get(runId) as FakeRun
    for (const mission of template.missions ?? []) {
      run.missions.set(mission.id, { currentAttempt: 1, attempts: [{ attempt: 1, state: 'pending', refs: {}, artifacts: [] }], annotations: [] })
    }
    return { run: { id: runId }, existed: false, lint: { errors: [], warnings: [] } }
  }

  private locate(missionId: string, runId?: string): { run: FakeRun; mission: FakeMissionRecord } {
    const run = runId !== undefined ? this.runs.get(runId) : this.runs.values().next().value
    if (run === undefined) throw new Error(`fake mission: run ${String(runId)} does not exist`)
    const mission = run.missions.get(missionId)
    if (mission === undefined) throw new Error(`fake mission: mission ${missionId} does not exist`)
    return { run, mission }
  }

  private attemptDir(runId: string, missionId: string, attempt: number): string {
    return join(this.dataDir, 'runs', runId, 'data', missionId, `attempt-${attempt}`)
  }

  private runGuard(runId: string, missionId: string, record: FakeMissionRecord, guard: Record<string, unknown>): void {
    const attempt = record.attempts[record.currentAttempt - 1] as FakeAttempt
    if (guard['type'] === 'schema-check') {
      const schema = JSON.parse(readFileSync(join(this.runs.get(runId)?.templateDir ?? '', guard['schemaPath'] as string), 'utf8'))
      const value = guard['inputFrom'] === 'run-meta' ? this.runs.get(runId)?.meta : attempt.submission?.json
      if (guard['inputFrom'] !== 'run-meta' && attempt.submission === undefined) {
        throw new Error('mission: schema-check guard: no submission recorded (submit first)')
      }
      const violations = validateJson(schema, value)
      if (violations.length > 0) {
        throw new Error(`mission: schema-check guard failed:\n${violations.map(v => `  - ${v}`).join('\n')}`)
      }
      return
    }
    if (guard['type'] === 'file-check') {
      const base = join(this.attemptDir(runId, missionId, record.currentAttempt), guard['dir'] as string)
      for (const expected of guard['expectedFiles'] as string[]) {
        const target = join(base, expected)
        if (!existsSync(target)) throw new Error(`mission: file-check guard failed: missing ${expected}`)
        if (expected.endsWith('/') && readdirSync(target, { withFileTypes: true }).every(e => !e.isFile())) {
          throw new Error(`mission: file-check guard failed: empty ${expected}`)
        }
      }
    }
  }

  async transition(missionId: string, to: string, options?: { runId?: string; by?: string; note?: string }): Promise<{ changed: boolean }> {
    const { run, mission: record } = this.locate(missionId, options?.runId)
    const attempt = record.attempts[record.currentAttempt - 1] as FakeAttempt
    const edge = run.stateMachine.transitions.find(t => t.from === attempt.state && t.to === to)
    if (edge === undefined) throw new Error(`mission: transition ${attempt.state} → ${to} is not declared`)
    if (edge.guard !== undefined) this.runGuard(options?.runId ?? '', missionId, record, edge.guard)
    attempt.state = to
    return { changed: true }
  }

  async submit(missionId: string, options: { runId?: string; to?: string; json?: unknown; files?: MissionSubmitFile[] }): Promise<{ written: string[]; artifacts: number; checkpoint: string }> {
    const { run, mission: record } = this.locate(missionId, options.runId)
    const attempt = record.attempts[record.currentAttempt - 1] as FakeAttempt
    if (options.to !== undefined) {
      const edge = run.stateMachine.transitions.find(t => t.from === attempt.state && t.to === options.to)
      if (edge === undefined) throw new Error(`mission: submit --to ${options.to} is not an outgoing edge from ${attempt.state}`)
      if (edge.guard?.['type'] === 'schema-check' && edge.guard['inputFrom'] !== 'run-meta' && options.json !== undefined) {
        const schema = JSON.parse(readFileSync(join(run.templateDir, edge.guard['schemaPath'] as string), 'utf8'))
        const violations = validateJson(schema, options.json)
        if (violations.length > 0) {
          throw new Error(`mission: submission violates the schema of the ${edge.from} → ${edge.to} guard — nothing was written:\n${violations.map(v => `  - ${v}`).join('\n')}`)
        }
      }
    }
    for (const file of options.files ?? []) {
      const target = join(this.attemptDir(options.runId ?? '', missionId, record.currentAttempt), file.path)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, file.content, 'utf8')
    }
    attempt.submission = { json: options.json }
    attempt.artifacts.push(...(options.files ?? []).map(f => ({ path: f.path, kind: 'submission' })))
    return { written: (options.files ?? []).map(f => f.path), artifacts: attempt.artifacts.length, checkpoint: 'submit' }
  }

  async annotate(missionId: string, ns: string, payload: unknown, options?: { runId?: string; by?: string }): Promise<{ added: boolean }> {
    const { mission: record } = this.locate(missionId, options?.runId)
    record.annotations.push({ ns, payload, ...(options?.by !== undefined ? { by: options.by } : {}) })
    return { added: true }
  }

  async retry(missionId: string, options: { runId?: string; reason: string; category: string }): Promise<{ attempt: number }> {
    const { run, mission: record } = this.locate(missionId, options.runId)
    const initial = run.stateMachine.states.find(state => run.stateMachine.transitions.every(t => t.to !== state)) as string
    record.currentAttempt += 1
    record.attempts.push({ attempt: record.currentAttempt, state: initial, retry: { reason: options.reason, category: options.category }, refs: {}, artifacts: [] })
    return { attempt: record.currentAttempt }
  }

  async setRefs(missionId: string, refs: { sessions?: string[] }, options?: { runId?: string }): Promise<void> {
    const { mission: record } = this.locate(missionId, options?.runId)
    const attempt = record.attempts[record.currentAttempt - 1] as FakeAttempt
    if (refs.sessions !== undefined) attempt.refs.sessions = [...new Set([...attempt.refs.sessions ?? [], ...refs.sessions])]
  }

  async addArtifact(missionId: string, artifact: { path: string; kind: string }, options?: { runId?: string }): Promise<{ added: boolean }> {
    const { mission: record } = this.locate(missionId, options?.runId)
    const attempt = record.attempts[record.currentAttempt - 1] as FakeAttempt
    attempt.artifacts.push(artifact)
    return { added: true }
  }

  get(missionId: string, runId?: string): { mission: { currentAttempt: number; attempts: Array<{ attempt: number; state: string }> } } {
    const { mission: record } = this.locate(missionId, runId)
    return { mission: { currentAttempt: record.currentAttempt, attempts: record.attempts.map(a => ({ attempt: a.attempt, state: a.state })) } }
  }

  exportRun(request: { runId: string; outDir: string }): { bundleDir: string; files: number } {
    this.exportRequests.push(request)
    return { bundleDir: join(request.outDir, `${request.runId}-bundle`), files: 12 }
  }
}

/* ───────────────────────── fake localAgent face ───────────────────────── */

interface DelegationCall {
  kind: 'start' | 'resume'
  provider: string
  childSessionId?: string
  prompt: string
  cwd?: string
}

class FakeLocalAgent implements LocalAgentFace {
  calls: DelegationCall[] = []
  private seq = 0
  private pending = new Map<string, () => void>()
  constructor(readonly options: {
    /** start() throws this many times before succeeding (spawn failure). */
    failuresBeforeSuccess?: number
    alwaysThrow?: boolean
    /** The result never settles until cancel() — for the timeout path. */
    hangUntilCancel?: boolean
    stage1Payload?: 'valid' | 'invalid'
    stage2Payload?: 'valid' | 'halt'
  } = {}) {}

  get(name: string): { delegationProvider?: string } | undefined {
    return name === 'dsh' ? { delegationProvider: 'subagent_dsh' } : undefined
  }

  private writeStageOutputs(stageId: string, cwd: string | undefined, behavior: 'valid' | 'invalid' | 'halt'): void {
    if (cwd === undefined) throw new Error('fake localAgent: no cwd — the orchestrator must pass the cell directory')
    const payload = stageId === 'stage1'
      ? (behavior === 'valid' ? VALID_STAGE1 : {})
      : (behavior === 'halt' ? HALT_STAGE2 : VALID_STAGE2)
    writeFileSync(join(cwd, `${stageId}.json`), `${JSON.stringify(payload, null, 2)}\n`)
    writeFileSync(join(cwd, `${stageId}.md`), `# ${stageId} narrative\n`)
  }

  private behaviorFor(prompt: string): 'valid' | 'invalid' | 'halt' {
    const stage1 = this.options.stage1Payload ?? 'valid'
    const stage2 = this.options.stage2Payload ?? 'valid'
    if (prompt.startsWith('STAGE-ONE')) return stage1 === 'invalid' ? 'invalid' : 'valid'
    if (prompt.startsWith('STAGE-TWO')) return stage2 === 'halt' ? 'halt' : 'valid'
    throw new Error(`fake localAgent: unrecognized prompt ${prompt.slice(0, 20)}`)
  }

  async start(parentSessionId: string, provider: string, prompt: Array<{ type: 'text'; text: string }>, options?: { cwd?: string }): Promise<DelegationRun> {
    void parentSessionId
    if (this.options.alwaysThrow === true || (this.options.failuresBeforeSuccess ?? 0) > this.calls.filter(c => c.kind === 'start').length) {
      this.calls.push({ kind: 'start', provider, prompt: prompt[0]?.text ?? '', ...(options?.cwd !== undefined ? { cwd: options.cwd } : {}) })
      throw new Error('spawn failed: CLI binary not found')
    }
    const text = prompt[0]?.text ?? ''
    const childSessionId = `child-${++this.seq}`
    this.calls.push({ kind: 'start', provider, childSessionId, prompt: text, ...(options?.cwd !== undefined ? { cwd: options.cwd } : {}) })
    this.writeStageOutputs(text.startsWith('STAGE-ONE') ? 'stage1' : 'stage2', options?.cwd, this.behaviorFor(text))
    return this.makeRun(childSessionId)
  }

  async resume(_parentSessionId: string, provider: string, childSessionId: string, prompt: Array<{ type: 'text'; text: string }>, options?: { cwd?: string }): Promise<DelegationRun> {
    const text = prompt[0]?.text ?? ''
    this.calls.push({ kind: 'resume', provider, childSessionId, prompt: text, ...(options?.cwd !== undefined ? { cwd: options.cwd } : {}) })
    this.writeStageOutputs(text.startsWith('STAGE-ONE') ? 'stage1' : 'stage2', options?.cwd, this.behaviorFor(text))
    return this.makeRun(childSessionId)
  }

  private makeRun(childSessionId: string): DelegationRun {
    if (this.options.hangUntilCancel === true) {
      const result = new Promise<DelegationResult>((resolvePromise) => {
        this.pending.set(childSessionId, () => resolvePromise({ stopReason: 'aborted' }))
      })
      return { id: childSessionId, result }
    }
    return { id: childSessionId, result: Promise.resolve({ stopReason: 'completed' }) }
  }

  cancel(childSessionId: string): boolean {
    const settle = this.pending.get(childSessionId)
    if (settle === undefined) return false
    settle()
    this.pending.delete(childSessionId)
    return true
  }
}

/* ─────────────────────────────── the tests ────────────────────────────── */

function orchestratorNs(mission: FakeMission, runId: string, missionId: string): Array<Record<string, unknown>> {
  const run = mission.runs.get(runId)
  const record = run?.missions.get(missionId)
  return (record?.annotations.filter(a => a.ns === 'orchestrator') ?? []).map(a => a.payload as Record<string, unknown>)
}

function expectDelegationAnnotations(entries: Array<Record<string, unknown>>, stages: string[], childIds: string[]): void {
  const delegations = entries.filter(e => e['kind'] === 'delegation')
  expect(delegations).toHaveLength(stages.length)
  for (const [i, entry] of delegations.entries()) {
    expect(entry['stage']).toBe(stages[i])
    expect(entry['round']).toBe(i + 1)
    expect(entry['childSessionId']).toBe(childIds[i])
    expect(entry['promptSha']).toMatch(/^[0-9a-f]{64}$/)
    expect(typeof entry['startedAt']).toBe('number')
    expect(entry['durationMs']).toBeGreaterThanOrEqual(0)
    expect(entry['usage']).toBeNull()
    expect(entry['model']).toEqual({ declared: null, observed: null })
  }
}

describe('runPlan — one cell, happy path (P0 × dsh × rep1, stages one-two)', () => {
  it('drives the cell to archived with byte-exact prompts, per-cell cwd, and the bundle export', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root)
    const planDoc = readPlanDoc(planPath)
    const localAgent = new FakeLocalAgent()
    const mission = new FakeMission(join(root, 'mission'))
    const report = await runPlan(planPath, {
      parentSessionId: PARENT_SESSION,
      stateRoot: join(root, 'state'),
      now: 1_700_000_000_000,
    }, { datasets: fakeDatasets(root), mission, localAgent })

    const cell = report.cells[0] as { missionId: string; finalState: string; attempts: number; childSessionIds: string[]; promptShas: Record<string, string>; activeMs: number }
    expect(cell.missionId).toBe('p0-placeholder-dsh-exec-rep1')
    expect(cell.finalState).toBe('archived')
    expect(cell.attempts).toBe(1)

    // Decision 4: the prompt is the stage prompt bytes + one newline + task.md bytes.
    const expectedPromptOne = PROMPT_ONE + '\n' + TASK
    const expectedPromptTwo = PROMPT_TWO + '\n' + TASK
    expect(localAgent.calls[0]?.kind).toBe('start')
    expect(localAgent.calls[0]?.prompt).toBe(expectedPromptOne)
    expect(localAgent.calls[1]?.kind).toBe('resume')
    expect(localAgent.calls[1]?.prompt).toBe(expectedPromptTwo)
    expect(localAgent.calls[1]?.childSessionId).toBe(localAgent.calls[0]?.childSessionId)

    // Decision 3: the child ran in the per-cell directory (the fake writes there).
    const runId = report.runId
    const cellDir = join(root, 'state', 'cells', runId, cell.missionId, 'attempt-1')
    expect(readFileSync(join(cellDir, 'task.md'), 'utf8')).toBe(TASK)
    expect(readFileSync(join(cellDir, 'standards.yml'), 'utf8')).toBe(STANDARDS)
    const materialization = JSON.parse(readFileSync(join(cellDir, 'materialization.json'), 'utf8')) as { files: Array<{ path: string; sha256: string }>; sha256: string; source: { worktree: string } }
    expect(materialization.files.map(f => f.path)).toEqual(['standards.yml', 'task.md'])
    expect(materialization.files[1]?.sha256).toBe(createHash('sha256').update(Buffer.from(TASK, 'utf8')).digest('hex'))
    expect(materialization.sha256).toMatch(/^[0-9a-f]{64}$/)

    // Decision 6: one orchestrator-ns annotation per delegation, with prompt sha and the declared model.
    expectDelegationAnnotations(orchestratorNs(mission, runId, cell.missionId), ['stage1', 'stage2'], cell.childSessionIds)
    const delegations = orchestratorNs(mission, runId, cell.missionId).filter(e => e['kind'] === 'delegation')
    expect(delegations[0]?.['promptSha']).toBe(createHash('sha256').update(Buffer.from(expectedPromptOne, 'utf8')).digest('hex'))

    // The mission ran the generated state machine: submissions on the intended edges.
    const attemptDir = join(root, 'mission', 'runs', runId, 'data', cell.missionId, 'attempt-1')
    expect(JSON.parse(readFileSync(join(attemptDir, 'stage1.json'), 'utf8'))).toEqual(VALID_STAGE1)
    expect(readFileSync(join(attemptDir, 'stage2.md'), 'utf8')).toBe('# stage2 narrative\n')
    expect(existsSync(join(attemptDir, 'archive', 'workspace', 'materialization.json'))).toBe(true)
    expect(existsSync(join(attemptDir, 'archive', 'verdicts'))).toBe(true)

    // run.meta (decision 10): the frozen comparability record.
    expect(report.meta['datasetId']).toBe('harness-comparison')
    expect(report.meta['commit']).toBe(FAKE_COMMIT)
    expect(report.meta['planSha']).toBe(createHash('sha256').update(Buffer.from(canonicalJson(planDoc), 'utf8')).digest('hex'))
    expect(report.meta['evalVersion']).toMatch(/^0\.1\.0-rc\.1/)
    expect(report.meta['conditions']).toEqual([{ id: 'dsh-exec', sha: expect.stringMatching(/^[0-9a-f]{64}$/) }])
    expect(report.meta['order']).toEqual({ seed: 42, sequence: [cell.missionId] })
    expect(report.meta['concurrency']).toBe(1)
    expect(report.meta['startedAt']).toBe(1_700_000_000_000)
    expect(mission.runs.get(runId)?.originSession).toBe(PARENT_SESSION)

    // Decision 11: the bundle export, visible layer only, from the dataset root.
    expect(mission.exportRequests).toHaveLength(1)
    expect(mission.exportRequests[0]).toMatchObject({
      runId,
      outDir: join(root, 'exports'),
      layers: [{ name: 'visible', guarded: false }],
      snapshotDir: join(root, 'datasets', 'harness-comparison'),
    })
    expect(report.bundleDir).toBe(join(root, 'exports', `${runId}-bundle`))

    // The generated template was written beside the plan.
    const templateFile = JSON.parse(readFileSync(join(root, 'datasets', 'harness-comparison', 'plans', 't8-run.template.json'), 'utf8'))
    expect(templateFile.states).toEqual(report.template.states)
  })
})

describe('runPlan — the halt branch (decision 7)', () => {
  it('diverts stage2 → halted → archived when halt_on matches, submitting on the halted edge', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root)
    const localAgent = new FakeLocalAgent({ stage2Payload: 'halt' })
    const mission = new FakeMission(join(root, 'mission'))
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root), mission, localAgent })

    const cell = report.cells[0] as { finalState: string; halted?: boolean; attempts: number }
    expect(cell.halted).toBe(true)
    expect(cell.finalState).toBe('archived')
    // The halt submission carried the false payload and landed in the attempt dir.
    const attemptDir = join(root, 'mission', 'runs', report.runId, 'data', cell.missionId, 'attempt-1')
    expect(JSON.parse(readFileSync(join(attemptDir, 'stage2.json'), 'utf8'))).toEqual(HALT_STAGE2)
    // The fake validated the payload against schemas/stage2-halted.json (const false):
    // a feasible:true submission to `halted` would have been refused before writing.
  })
})

describe('runPlan — schema violations are not retried (decision 7)', () => {
  it('stops the cell in its current state and records the rejection', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root)
    const localAgent = new FakeLocalAgent({ stage1Payload: 'invalid' })
    const mission = new FakeMission(join(root, 'mission'))
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root), mission, localAgent })

    const cell = report.cells[0] as { finalState: string; attempts: number; rejected?: { stage: string; violations: string[] } }
    expect(cell.finalState).toBe('stage-1')
    expect(cell.attempts).toBe(1)
    expect(cell.rejected?.stage).toBe('stage1')
    expect(cell.rejected?.violations[0]).toContain('violates the schema')
    const annotations = orchestratorNs(mission, report.runId, cell.missionId)
    const rejection = annotations.find(e => e['kind'] === 'submission-rejected')
    expect(rejection).toBeDefined()
    expect(Array.isArray(rejection?.['violations'])).toBe(true)
  })
})

describe('runPlan — infrastructure retry policy (decision 8)', () => {
  it('retries a spawn failure with a reason and lands on attempt 2', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root)
    const localAgent = new FakeLocalAgent({ failuresBeforeSuccess: 1 })
    const mission = new FakeMission(join(root, 'mission'))
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root), mission, localAgent })

    const cell = report.cells[0] as { finalState: string; attempts: number }
    expect(cell.finalState).toBe('archived')
    expect(cell.attempts).toBe(2)
    // The retry opened a fresh attempt from the initial state.
    const record = mission.runs.get(report.runId)?.missions.get(cell.missionId)
    expect(record?.attempts[1]?.retry?.category).toBe('infrastructure')
    expect(record?.attempts[1]?.retry?.reason).toContain('spawn failed')
    expect(record?.attempts[1]?.state).toBe('archived')
    // The second attempt materialized into its own directory.
    expect(existsSync(join(root, 'state', 'cells', report.runId, cell.missionId, 'attempt-2', 'materialization.json'))).toBe(true)
  })

  it('skips the cell once the infrastructure budget is exhausted and records the skip', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root)
    const localAgent = new FakeLocalAgent({ alwaysThrow: true })
    const mission = new FakeMission(join(root, 'mission'))
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root), mission, localAgent })

    const cell = report.cells[0] as { attempts: number; skipped?: { reason: string } }
    expect(cell.attempts).toBe(2) // the initial attempt + 1 infrastructure retry (the default budget)
    expect(cell.skipped?.reason).toContain('spawn failed')
    const skip = orchestratorNs(mission, report.runId, cell.missionId).find(e => e['kind'] === 'cell-skipped')
    expect(skip).toBeDefined()
  })

  it('a timed-out delegation is cancelled and counts as infrastructure (decisions 7 and 8)', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root, { budget: { activeMinutes: 0.00005, turns: 10 } }) // 3ms of active budget
    const localAgent = new FakeLocalAgent({ hangUntilCancel: true })
    const mission = new FakeMission(join(root, 'mission'))
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root), mission, localAgent })

    const cell = report.cells[0] as { attempts: number; skipped?: { reason: string }; activeMs: number }
    expect(cell.skipped).toBeDefined()
    expect(localAgent.pending.size).toBe(0) // every hung run was cancelled
    const retryRecord = mission.runs.get(report.runId)?.missions.get(cell.missionId)?.attempts[1]?.retry
    expect(retryRecord?.category).toBe('infrastructure')
    expect(retryRecord?.reason).toContain('budget')
  })
})

describe('runPlan — refusals before anything executes', () => {
  it('refuses without the three upstream services, naming what is missing (decision 12)', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root)
    await expect(runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') }))
      .rejects.toThrow(/missing: datasets, mission, localAgent/)
    const partial = { datasets: fakeDatasets(root), mission: new FakeMission(join(root, 'mission')) }
    await expect(runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') }, partial))
      .rejects.toThrow(/missing: localAgent/)
  })

  it('refuses a non-dry run without a parent session (decision 1: the CLI is dry-run only)', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root)
    await expect(runPlan(planPath, { stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root), mission: new FakeMission(root), localAgent: new FakeLocalAgent() }))
      .rejects.toThrow(EvalRunRefused)
  })

  it('refuses a condition whose harness has no delegation provider (decision 5)', async () => {
    const root = makeDatasetTree()
    const conditionPath = join(root, 'datasets', 'harness-comparison', 'conditions', 'dsh-exec.json')
    const condition = JSON.parse(readFileSync(conditionPath, 'utf8')) as Record<string, unknown>
    condition['harness'] = { name: 'no-such-harness', version: null, drive: 'exec' }
    writeFileSync(conditionPath, JSON.stringify(condition, null, 2))
    const planPath = writePlan(root)
    await expect(runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root), mission: new FakeMission(root), localAgent: new FakeLocalAgent() }))
      .rejects.toThrow(/no local-agent harness "no-such-harness"/)
  })

  it('refuses on a stale condition lock (integrity before execution)', async () => {
    const root = makeDatasetTree()
    writeFileSync(join(root, 'datasets', 'harness-comparison', 'conditions', 'dsh-exec.lock.json'),
      `${JSON.stringify({ schema: 'dataseek.condition-lock/1', condition: 'dsh-exec', sha: 'b'.repeat(64) }, null, 2)}\n`)
    const planPath = writePlan(root)
    await expect(runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root), mission: new FakeMission(root), localAgent: new FakeLocalAgent() }))
      .rejects.toThrow(/lock sha does not match/)
  })
})

describe('runPlan — ordering and concurrency (decision 9)', () => {
  it('runs the seeded order and records it in run.meta; concurrency 2 finishes both cells', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root, { reps: 2 }, 't8-order')
    const mission = new FakeMission(join(root, 'mission'))
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state'), concurrency: 2 },
      { datasets: fakeDatasets(root), mission, localAgent: new FakeLocalAgent() })

    expect(report.meta['concurrency']).toBe(2)
    const sequence = (report.meta['order'] as { sequence: string[] }).sequence
    // The seeded order is exactly what orderCells derives from the plan.
    const expected = orderCells(expandMatrix({
      dataset: { items: ['P0-placeholder'] },
      conditions: ['dsh-exec'],
      reps: 2,
    }), 42, false).map(cell => cell.missionId)
    expect(sequence).toEqual(expected)
    expect(report.cells.map(cell => cell.missionId)).toEqual(sequence)
    expect(report.cells.every(cell => (cell as { finalState: string }).finalState === 'archived')).toBe(true)
  })
})

describe('runPlan — dry run (decision 1)', () => {
  it('validates, generates the template, expands and orders the matrix — and executes nothing', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root, { reps: 2 }, 't8-dry')
    const report = await runPlan(planPath, { dryRun: true, concurrency: 3 })
    expect(report.dryRun).toBe(true)
    expect(report.cells).toHaveLength(0)
    expect((report.meta['order'] as { sequence: string[] }).sequence).toEqual(orderCells(expandMatrix({
      dataset: { items: ['P0-placeholder'] },
      conditions: ['dsh-exec'],
      reps: 2,
    }), 42, false).map(cell => cell.missionId))
    expect(report.meta['planSha']).toMatch(/^[0-9a-f]{64}$/)
    expect(report.template.states).toContain('stage-1')
    // Nothing was executed: no template file next to the plan, no state.
    expect(existsSync(join(root, 'datasets', 'harness-comparison', 'plans', 't8-dry.template.json'))).toBe(false)
    expect(existsSync(join(root, 'state'))).toBe(false)
  })
})

describe('runPlan — finalize (decision 10)', () => {
  it('stops at archived by default; an explicit finalize is refused by the empty-verdicts gate and recorded', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root, {}, 't8-final')
    const mission = new FakeMission(join(root, 'mission'))
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state'), finalize: true },
      { datasets: fakeDatasets(root), mission, localAgent: new FakeLocalAgent() })

    const cell = report.cells[0] as { finalState: string }
    // verdicts/ is empty until the judge lands (T9), so the file-check refuses —
    // the cell stays archived and the refusal is recorded, not bypassed.
    expect(cell.finalState).toBe('archived')
    const refusal = orchestratorNs(mission, report.runId, cell.missionId).find(e => e['kind'] === 'finalize-refused')
    expect(refusal).toBeDefined()
  })
})
