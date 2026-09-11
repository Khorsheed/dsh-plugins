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
 * or produce bad payloads. Since T9 the fake datasets also serves the
 * non-model-facing `grading` and `verify` layers (rubric + probes) and the
 * fake localAgent can act as a JUDGE: it recognizes the judge prompt, reads
 * the criteria back out of it, and writes verdicts.json into the sample cwd.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runPlan, EvalRunRefused } from '../src/run.ts'
import { READINESS_PROMPT } from '../src/readiness.ts'
import type { DatasetsFace, LabAcquireSpec, LabFace, LabFingerprintComponents, LabUnitInfo, LabVerifyResult, LocalAgentFace, MissionFace, MissionSubmitFile } from '../src/faces.ts'
import type { DelegationProgress, DelegationResult, DelegationRun } from '../src/faces.ts'
import { canonicalJson } from '../src/hash.ts'
import { expandMatrix, orderCells } from '../src/matrix.ts'
import { validateJson } from '../src/schema.ts'
import { RUBRIC_WEIGHTS_PATH, RUBRIC_WEIGHTS_SCHEMA } from '../src/weights.ts'
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
/** The model conditions/dsh-exec.json declares (the fixture mirrors the dataset repo). */
const DECLARED_MODEL = 'deepseek-official/deepseek-v4-flash'
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

/** Item files of the two non-model-facing layers, by `<item>/<display path>`. */
interface GuardedLayers {
  grading?: Map<string, string>
  verify?: Map<string, string>
  /** The DATASET-level verify layer: layer-relative path → content (no item id). */
  datasetVerify?: Map<string, string>
}

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

function fakeDatasets(root: string, guarded: GuardedLayers = {}): DatasetsFace {
  const datasetRoot = join(root, 'datasets', 'harness-comparison')
  const itemFiles = new Map<string, string>([
    ['P0-placeholder/task.md', TASK],
    ['P0-placeholder/standards.yml', STANDARDS],
  ])
  const byLayer: Record<string, Map<string, string>> = {
    grading: guarded.grading ?? new Map(),
    verify: guarded.verify ?? new Map(),
  }
  /** The real service refuses a sensitive layer unless the scope names it. */
  const assertScoped = (scope: { layers?: readonly string[] }, layer: string): void => {
    if (layer === 'visible') return
    if (scope.layers === undefined || !scope.layers.includes(layer)) {
      throw new Error(`fake datasets: layer ${JSON.stringify(layer)} is outside the call's scope — the judge path must name it explicitly`)
    }
  }
  const datasetVerify = guarded.datasetVerify ?? new Map<string, string>()
  const datasetFiles = new Map<string, string>([
    ['visible/prompts/stage1.md', PROMPT_ONE],
    ['visible/prompts/stage2.md', PROMPT_TWO],
    ...[...datasetVerify].map(([path, content]): [string, string] => [`verify/${path}`, content]),
  ])
  return {
    async snapshot(_scope, datasetId, commit) {
      return { repoPath: root, commit: commit ?? FAKE_COMMIT, datasetId }
    },
    async worktreePath(_scope, _datasetId, options) {
      return { path: join(datasetRoot, 'worktree'), commit: options?.commit ?? FAKE_COMMIT, layers: ['visible'], reused: false }
    },
    async show(scope, _datasetId, itemId) {
      const id = itemId ?? 'P0-placeholder'
      const layers: Record<string, string[]> = {
        visible: ['task.md', 'standards.yml'].filter(rel => itemFiles.has(`${id}/${rel}`)),
      }
      for (const [layer, files] of Object.entries(byLayer)) {
        if (scope.layers === undefined || !scope.layers.includes(layer)) continue
        const paths = [...files.keys()].filter(key => key.startsWith(`${id}/`)).map(key => key.slice(id.length + 1)).sort()
        if (paths.length > 0) layers[layer] = paths
      }
      const shared = scope.layers?.includes('verify') === true && datasetVerify.size > 0
        ? { datasetLayers: { verify: [...datasetVerify.keys()].sort() } }
        : {}
      return { items: [{ id, layers }], ...shared }
    },
    async read(scope, query) {
      assertScoped(scope, query.layer)
      const guardedLayer = byLayer[query.layer]
      if (query.item !== undefined && guardedLayer !== undefined) {
        const content = guardedLayer.get(`${query.item}/${query.path}`)
        if (content === undefined) throw new Error(`fake datasets: no ${query.layer} file ${query.item}/${query.path}`)
        return { content, commit: query.commit ?? FAKE_COMMIT }
      }
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
  refs: { sessions?: string[]; resource?: string; fingerprint?: string }
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

  async setRefs(missionId: string, refs: { sessions?: string[]; resource?: string; fingerprint?: string }, options?: { runId?: string }): Promise<void> {
    const { mission: record } = this.locate(missionId, options?.runId)
    const attempt = record.attempts[record.currentAttempt - 1] as FakeAttempt
    if (refs.sessions !== undefined) attempt.refs.sessions = [...new Set([...attempt.refs.sessions ?? [], ...refs.sessions])]
    if (refs.resource !== undefined) attempt.refs.resource = refs.resource
    if (refs.fingerprint !== undefined) attempt.refs.fingerprint = refs.fingerprint
  }

  /** The current attempt's refs — where the «环境一致» invariant reads its input. */
  refsOf(missionId: string, runId?: string): { sessions?: string[]; resource?: string; fingerprint?: string } {
    const { mission: record } = this.locate(missionId, runId)
    return (record.attempts[record.currentAttempt - 1] as FakeAttempt).refs
  }

  /** Whether this mission's held resources may be destroyed — mission's own rule. */
  isReleasable(missionId: string, runId?: string): boolean {
    const { run, mission: record } = this.locate(missionId, runId)
    const state = (record.attempts[record.currentAttempt - 1] as FakeAttempt).state
    return ((run.stateMachine as { releasableStates?: string[] }).releasableStates ?? []).includes(state)
  }

  async addArtifact(missionId: string, artifact: { path: string; kind: string }, options?: { runId?: string }): Promise<{ added: boolean }> {
    const { mission: record } = this.locate(missionId, options?.runId)
    const attempt = record.attempts[record.currentAttempt - 1] as FakeAttempt
    // mission's rule: the indexed path must EXIST under the attempt's run-data directory.
    if (!existsSync(join(this.attemptDir(options?.runId ?? '', missionId, record.currentAttempt), artifact.path))) {
      throw new Error(`mission: artifact ${artifact.path} does not exist under the attempt's run-data directory (mission ${missionId}, attempt ${record.currentAttempt})`)
    }
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
  /** T17's container target, when the round was addressed at a unit instead of a cwd. */
  exec?: { container: string; workdir: string; env?: Record<string, string> }
  /** T29's scoped home, when the condition named one. */
  scope?: string
  /** T30b's per-delegation model, when the condition declared one. */
  model?: string
  /** Set on judge delegations (the fake recognizes the blind-judging prompt). */
  judge?: true
  /** Set on the pre-run readiness probe (the fake recognizes its prompt too). */
  readiness?: true
}

/** The judge prompt's opening line — how the fake tells judging from playing. */
const JUDGE_PROMPT_HEADING = '# 盲评任务'

/** Read the criterion ids back out of a judge prompt (its `### <id>` headings). */
function criteriaOfPrompt(prompt: string): string[] {
  const body = prompt.slice(0, prompt.indexOf('## 材料'))
  return [...body.matchAll(/^### ([A-Za-z0-9._-]+)/gm)].map(match => match[1] as string)
}

/**
 * What the fake delivers on the T11 read-back channels for one round.
 *
 * The real facade clears the tracked run — and with it the `onProgress` the
 * call options carried — the moment `run.result` resolves, while the provider
 * records its observation in a settle pass chained AFTER that. So a real
 * delegation delivers NO settled event to the caller and a delegation record
 * that gains `observedModel` a beat late; `recordModelDelayMs` models exactly
 * that, and `settledModel` models a facade that reports before settling.
 */
interface FakeReadback {
  /** Emitted on the settled progress event (undefined = the event carries none). */
  settledModel?: string
  settledUsage?: { inputTokens: number; outputTokens: number }
  /** The round's tool-call accounting on the settled event (undefined = none reported). */
  settledToolCalls?: { count: number; byName?: Record<string, number> }
  /** The CLI build the settled event names (undefined = none read back). */
  settledCliVersion?: string
  /** Returned by delegationOf (undefined = the record never carries one). */
  recordModel?: string
  /** Milliseconds after the result settles before the record carries it (default 0). */
  recordModelDelayMs?: number
}

class FakeLocalAgent implements LocalAgentFace {
  calls: DelegationCall[] = []
  private seq = 0
  private pending = new Map<string, () => void>()
  /** Judge delegations so far — the index handed to `judgeAnswer`. */
  judgeCalls = 0
  constructor(readonly options: {
    /** start() throws this many times before succeeding (spawn failure). */
    failuresBeforeSuccess?: number
    alwaysThrow?: boolean
    /** The result never settles until cancel() — for the timeout path. */
    hangUntilCancel?: boolean
    stage1Payload?: 'valid' | 'invalid'
    stage2Payload?: 'valid' | 'halt'
    /** Appended to each stage's narrative — how a test plants a fingerprint. */
    stageNarrative?: string
    /**
     * What the judge writes on its `call`-th delegation. The default answers
     * every criterion in the prompt with `pass: true`; a function that writes
     * nothing produces the parse failure the retry path is for.
     */
    judgeAnswer?: (call: number, cwd: string, criteria: string[]) => void
    /** T11 read-back; omitted, the fake emits nothing (a facade predating T11). */
    readback?: FakeReadback
    /**
     * How the pre-run readiness probe behaves. `completed` (the default) is a
     * live condition; `refused` models the G4 case — a credential that reads
     * authenticated and whose every delegation is rejected; `throw` models a
     * provider that cannot even start.
     */
    readiness?: 'completed' | 'refused' | 'throw'
    /**
     * Container path: where the host directory standing in for a unit's
     * workspace lives, by container name. A round addressed at a unit writes
     * its stage outputs THERE, which is what makes the fake's collect a real
     * copy rather than a pretend one.
     */
    workspaceOf?: (container: string) => string
    /** Harness names this facade has a delegation provider for (default `['dsh']`). */
    harnesses?: string[]
    /** Root of the per-harness scoped homes this facade reports. */
    homesRoot?: string
    /**
     * What the record reports for the READINESS child specifically. Set it to
     * the declared model to let the probe pass while the stage rounds read
     * back something else — the mid-run switch the run loop's own decision-5
     * guard exists for, which the probe by construction cannot see.
     */
    readinessModel?: string
    /**
     * Condition ids whose READINESS probe is refused (the probe's label names
     * the condition). Lets a test fail the judge's probe while every player's
     * passes, which is pilot B's shape exactly.
     */
    readinessFailFor?: string[]
  } = {}) {
    // A facade predating T11 has no delegationOf at all — the face's method is
    // optional, so the fake drops it unless this run exercises the read-back.
    if (this.options.readback === undefined) {
      ;(this as { delegationOf?: unknown }).delegationOf = undefined
    }
  }

  /** Child session id → when its record starts carrying the observed model. */
  private recordVisibleAt = new Map<string, number>()

  /** T11: the read-only delegation projection (observed model, first-round cwd). */
  delegationOf?(childSessionId: string): { childSessionId: string; provider: string; parentSessionId: string; cwd?: string; observedModel?: string } | undefined {
    const call = this.calls.find(c => c.childSessionId === childSessionId)
    if (call === undefined) return undefined
    if (call.readiness === true && this.options.readinessModel !== undefined) {
      return { childSessionId, provider: call.provider, parentSessionId: PARENT_SESSION, observedModel: this.options.readinessModel }
    }
    const recordModel = this.options.readback?.recordModel
    const visibleAt = this.recordVisibleAt.get(childSessionId)
    const visible = recordModel !== undefined && visibleAt !== undefined && Date.now() >= visibleAt
    return {
      childSessionId, provider: call.provider, parentSessionId: PARENT_SESSION,
      ...(call.cwd !== undefined ? { cwd: call.cwd } : {}),
      ...(visible ? { observedModel: recordModel } : {}),
    }
  }

  /** Emit the progress events of one settled round, in the facade's order. */
  private emitProgress(onProgress?: (event: DelegationProgress) => void): void {
    if (onProgress === undefined) return
    onProgress({ kind: 'heartbeat' })
    const readback = this.options.readback
    if (readback === undefined) return
    onProgress({
      kind: 'settled',
      ...(readback.settledModel !== undefined ? { observedModel: readback.settledModel } : {}),
      ...(readback.settledCliVersion !== undefined ? { cliVersion: readback.settledCliVersion } : {}),
      ...(readback.settledUsage !== undefined ? { usage: readback.settledUsage } : {}),
      ...(readback.settledToolCalls !== undefined ? { toolCalls: readback.settledToolCalls } : {}),
    })
  }

  /**
   * The instance's scoped home for one harness — what the container path
   * mounts. A NAMED scope resolves to the sibling directory `<name>@<scope>`,
   * exactly as the real facade does, so two conditions of one harness mount
   * two directories.
   */
  homeDir(name: string, scope?: string): string {
    return join(this.options.homesRoot ?? '/nonexistent-homes', scope === undefined ? name : `${name}@${scope}`)
  }

  get(name: string): { delegationProvider?: string } | undefined {
    // Default to the one harness the fixture condition names; a test that
    // needs several says so, and an unregistered harness stays a refusal.
    const known = this.options.harnesses ?? ['dsh']
    return known.includes(name) ? { delegationProvider: `subagent_${name}` } : undefined
  }

  private writeStageOutputs(stageId: string, cwd: string | undefined, behavior: 'valid' | 'invalid' | 'halt'): void {
    if (cwd === undefined) throw new Error('fake localAgent: no cwd — the orchestrator must pass the cell directory')
    const payload = stageId === 'stage1'
      ? (behavior === 'valid' ? VALID_STAGE1 : {})
      : (behavior === 'halt' ? HALT_STAGE2 : VALID_STAGE2)
    writeFileSync(join(cwd, `${stageId}.json`), `${JSON.stringify(payload, null, 2)}\n`)
    writeFileSync(join(cwd, `${stageId}.md`), `# ${stageId} narrative\n${this.options.stageNarrative ?? ''}`)
  }

  /** One judge delegation: answer the prompt's criteria into the sample cwd. */
  private judge(prompt: string, cwd: string | undefined): void {
    if (cwd === undefined) throw new Error('fake localAgent: the judge must run in its own sample directory')
    const call = ++this.judgeCalls
    const criteria = criteriaOfPrompt(prompt)
    if (this.options.judgeAnswer !== undefined) {
      this.options.judgeAnswer(call, cwd, criteria)
      return
    }
    writeFileSync(join(cwd, 'verdicts.json'), `${JSON.stringify(criteria.map(criterion => ({
      schema: 'dataseek.verdict/1',
      task: 'P0-placeholder',
      criterion,
      pass: true,
      evidence: `材料里写了 ${criterion}`,
      by: 'fake-judge',
    })), null, 2)}\n`)
  }

  /**
   * The readiness probe: no files, no stage payload — just whether a
   * delegation on this provider starts and completes. The run loop asks
   * nothing else of it, so neither does the fake.
   */
  private readinessRun(
    provider: string,
    options: { cwd?: string; label?: string; exec?: { container: string; workdir: string; env?: Record<string, string> }; scope?: string; model?: string } | undefined,
    onProgress?: (event: DelegationProgress) => void,
  ): DelegationRun {
    // The probe's label is `readiness <condition id>` — the only place the
    // facade learns WHICH condition it is being asked about.
    const probed = (options?.label ?? '').replace(/^readiness /, '')
    if (this.options.readinessFailFor?.includes(probed) === true) {
      const childSessionId = `readiness-${++this.seq}`
      this.calls.push({ kind: 'start', provider, childSessionId, prompt: READINESS_PROMPT, readiness: true, ...this.addressed(options) })
      return { id: childSessionId, result: Promise.resolve({ stopReason: 'failed', diagnostic: '401 authentication failed' }) }
    }
    if (this.options.readiness === 'throw') {
      this.calls.push({ kind: 'start', provider, prompt: READINESS_PROMPT, readiness: true, ...this.addressed(options) })
      throw new Error('spawn failed: CLI binary not found')
    }
    const childSessionId = `readiness-${++this.seq}`
    this.calls.push({ kind: 'start', provider, childSessionId, prompt: READINESS_PROMPT, readiness: true, ...this.addressed(options) })
    if (this.options.readiness === 'refused') {
      return { id: childSessionId, result: Promise.resolve({ stopReason: 'failed', diagnostic: '401 authentication failed' }) }
    }
    // A real facade emits the same events for the probe as for any other
    // round, so the fake does too — that is how the probe reads the model
    // back and how a misattribution is caught before the run exists.
    this.emitProgress(onProgress)
    this.armRecord(childSessionId)
    return { id: childSessionId, result: Promise.resolve({ stopReason: 'completed' }) }
  }

  private behaviorFor(prompt: string): 'valid' | 'invalid' | 'halt' {
    const stage1 = this.options.stage1Payload ?? 'valid'
    const stage2 = this.options.stage2Payload ?? 'valid'
    if (prompt.startsWith('STAGE-ONE')) return stage1 === 'invalid' ? 'invalid' : 'valid'
    if (prompt.startsWith('STAGE-TWO')) return stage2 === 'halt' ? 'halt' : 'valid'
    throw new Error(`fake localAgent: unrecognized prompt ${prompt.slice(0, 20)}`)
  }

  /** Where this round's files land: the cwd, or the host stand-in for the unit's workspace. */
  private target(options?: { cwd?: string; exec?: { container: string } }): string | undefined {
    if (options?.exec !== undefined) return this.options.workspaceOf?.(options.exec.container)
    return options?.cwd
  }

  /** How this round was addressed, for the call record. */
  private addressed(options?: { cwd?: string; exec?: { container: string; workdir: string; env?: Record<string, string> }; scope?: string; model?: string }): Record<string, unknown> {
    // The scope is orthogonal to the address: it says which scoped home the
    // round reads its credentials from, on either path. So is the model — it
    // says which model the round asks the harness for.
    const scope = options?.scope !== undefined ? { scope: options.scope } : {}
    const model = options?.model !== undefined ? { model: options.model } : {}
    if (options?.exec !== undefined) return { exec: options.exec, ...scope, ...model }
    return { ...options?.cwd !== undefined ? { cwd: options.cwd } : {}, ...scope, ...model }
  }

  async start(parentSessionId: string, provider: string, prompt: Array<{ type: 'text'; text: string }>, options?: { cwd?: string; label?: string; exec?: { container: string; workdir: string; env?: Record<string, string> }; scope?: string; model?: string; onProgress?: (event: DelegationProgress) => void }): Promise<DelegationRun> {
    void parentSessionId
    // The readiness probe is answered before any scripted failure: those
    // script the STAGE rounds, and a run whose probe failed never gets there.
    if ((prompt[0]?.text ?? '') === READINESS_PROMPT) return this.readinessRun(provider, options, options?.onProgress)
    if (this.options.alwaysThrow === true || (this.options.failuresBeforeSuccess ?? 0) > this.calls.filter(c => c.kind === 'start' && c.readiness !== true).length) {
      this.calls.push({ kind: 'start', provider, prompt: prompt[0]?.text ?? '', ...this.addressed(options) })
      throw new Error('spawn failed: CLI binary not found')
    }
    const text = prompt[0]?.text ?? ''
    const childSessionId = `child-${++this.seq}`
    if (text.startsWith(JUDGE_PROMPT_HEADING)) {
      this.calls.push({
        kind: 'start', provider, childSessionId, prompt: text, judge: true,
        ...(options?.cwd !== undefined ? { cwd: options.cwd } : {}),
        ...(options?.model !== undefined ? { model: options.model } : {}),
      })
      this.judge(text, options?.cwd)
      return this.makeRun(childSessionId)
    }
    this.calls.push({ kind: 'start', provider, childSessionId, prompt: text, ...this.addressed(options) })
    this.writeStageOutputs(text.startsWith('STAGE-ONE') ? 'stage1' : 'stage2', this.target(options), this.behaviorFor(text))
    this.emitProgress(options?.onProgress)
    this.armRecord(childSessionId)
    return this.makeRun(childSessionId)
  }

  async resume(_parentSessionId: string, provider: string, childSessionId: string, prompt: Array<{ type: 'text'; text: string }>, options?: { cwd?: string; exec?: { container: string; workdir: string; env?: Record<string, string> }; scope?: string; onProgress?: (event: DelegationProgress) => void }): Promise<DelegationRun> {
    const text = prompt[0]?.text ?? ''
    this.calls.push({ kind: 'resume', provider, childSessionId, prompt: text, ...this.addressed(options) })
    this.writeStageOutputs(text.startsWith('STAGE-ONE') ? 'stage1' : 'stage2', this.target(options), this.behaviorFor(text))
    this.emitProgress(options?.onProgress)
    this.armRecord(childSessionId)
    return this.makeRun(childSessionId)
  }

  /** Arm the record's visibility for the round that is about to settle. */
  private armRecord(childSessionId: string): void {
    if (this.options.readback?.recordModel === undefined) return
    this.recordVisibleAt.set(childSessionId, Date.now() + (this.options.readback.recordModelDelayMs ?? 0))
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

function expectDelegationAnnotations(
  entries: Array<Record<string, unknown>>,
  stages: string[],
  childIds: string[],
  readback: { usage?: unknown; observed?: string | null; toolCalls?: unknown; cliVersion?: string } = {},
): void {
  const declared = DECLARED_MODEL
  const delegations = entries.filter(e => e['kind'] === 'delegation')
  expect(delegations).toHaveLength(stages.length)
  for (const [i, entry] of delegations.entries()) {
    expect(entry['stage']).toBe(stages[i])
    expect(entry['round']).toBe(i + 1)
    expect(entry['childSessionId']).toBe(childIds[i])
    expect(entry['promptSha']).toMatch(/^[0-9a-f]{64}$/)
    expect(typeof entry['startedAt']).toBe('number')
    expect(entry['durationMs']).toBeGreaterThanOrEqual(0)
    expect(entry['usage']).toEqual(readback.usage ?? null)
    // toolCalls / cliVersion are OMITTED when unreported — a key that is not
    // there is how "the harness counted none" differs from a zero.
    if (readback.toolCalls === undefined) expect('toolCalls' in entry).toBe(false)
    else expect(entry['toolCalls']).toEqual(readback.toolCalls)
    if (readback.cliVersion === undefined) expect('cliVersion' in entry).toBe(false)
    else expect(entry['cliVersion']).toBe(readback.cliVersion)
    expect(entry['model']).toEqual({ declared, observed: readback.observed ?? null })
  }
}

/** The cell anchors one run wrote, by mission id (T8b). */
function cellAnchors(mission: FakeMission, runId: string, missionId: string): Array<Record<string, unknown>> {
  return orchestratorNs(mission, runId, missionId).filter(e => e['kind'] === 'cell')
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

    // The readiness probe goes FIRST and is the run's own delegation, not a
    // cell's: it must not appear among the stage rounds.
    expect(localAgent.calls[0]?.readiness).toBe(true)
    expect(report.readiness).toEqual([
      expect.objectContaining({ kind: 'readiness', condition: 'dsh-exec', harness: 'dsh', ok: true }),
    ])

    // Decision 4: the prompt is the stage prompt bytes + one newline + task.md bytes.
    const expectedPromptOne = PROMPT_ONE + '\n' + TASK
    const expectedPromptTwo = PROMPT_TWO + '\n' + TASK
    const stageCalls = localAgent.calls.filter(call => call.readiness !== true)
    expect(stageCalls[0]?.kind).toBe('start')
    expect(stageCalls[0]?.prompt).toBe(expectedPromptOne)
    expect(stageCalls[1]?.kind).toBe('resume')
    expect(stageCalls[1]?.prompt).toBe(expectedPromptTwo)
    expect(stageCalls[1]?.childSessionId).toBe(stageCalls[0]?.childSessionId)

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
    // T8b: the full condition document rides the entry, so the report's
    // factor diff needs nothing beyond the bundle.
    const conditionDoc = JSON.parse(readFileSync(join(root, 'datasets', 'harness-comparison', 'conditions', 'dsh-exec.json'), 'utf8'))
    expect(report.meta['conditions']).toEqual([
      { id: 'dsh-exec', sha: expect.stringMatching(/^[0-9a-f]{64}$/), condition: conditionDoc },
    ])
    expect(report.meta['order']).toEqual({ seed: 42, sequence: [cell.missionId] })
    // The whole matrix ran: the subset record says so rather than staying silent.
    expect(report.meta['subset']).toEqual({ only: null, maxCells: null, totalCells: 1, selectedCells: 1 })
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

describe('runPlan — the derived rubric weight table (T24)', () => {
  it('writes report/rubric-weights.json from the grading layer — numbers only, no criterion text', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root)
    const mission = new FakeMission(join(root, 'mission'))
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root, { grading: new Map([['P0-placeholder/rubric.yml', RUBRIC]]) }), mission, localAgent: new FakeLocalAgent() })

    const path = join(report.bundleDir as string, RUBRIC_WEIGHTS_PATH)
    const bytes = readFileSync(path, 'utf8')
    const table = JSON.parse(bytes) as { schema: string; tasks: string[]; criteria: Array<Record<string, unknown>> }
    expect(table.schema).toBe(RUBRIC_WEIGHTS_SCHEMA)
    expect(table.tasks).toEqual(['P0-placeholder'])
    expect(table.criteria.map(row => row['id'])).toEqual(['J1', 'J2', 'A2-1', 'H1', 'N1'])
    expect(table.criteria.find(row => row['id'] === 'N1')).toEqual({
      task: 'P0-placeholder', id: 'N1', weight: -2, negative: true, kind: 'objective', axis: 'E1',
    })
    expect(table.criteria.find(row => row['id'] === 'J1')?.['negative']).toBe(false)

    // The grading layer's WORDS never travel: this is why the derived table
    // needs no leak gate while the layer it came from does.
    expect(bytes).not.toContain('criterion')
    expect(bytes).not.toContain('evidence')
    expect(bytes).not.toContain('共享上下文')
    expect(bytes).not.toContain('不存在的 API')
    // And the rubric itself still stays out of the bundle.
    expect(mission.exportRequests[0]?.['layers']).toEqual([{ name: 'visible', guarded: false }])
  })

  it('writes no table when the item ships no rubric — and the run still finishes', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root)
    const mission = new FakeMission(join(root, 'mission'))
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root), mission, localAgent: new FakeLocalAgent() })
    expect(report.bundleDir).toBeDefined()
    expect(report.exportError).toBeUndefined()
    expect(existsSync(join(report.bundleDir as string, RUBRIC_WEIGHTS_PATH))).toBe(false)
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

  it('a cancelled run stops where it is: the live cell is cancelled, not retried, and no further cell starts', async () => {
    const root = makeDatasetTree()
    // Two cells so the second one proves a cancelled run starts nothing more.
    const planPath = writePlan(root, { reps: 2 })
    const localAgent = new FakeLocalAgent({ hangUntilCancel: true })
    const mission = new FakeMission(join(root, 'mission'))
    const controller = new AbortController()
    // Cancel once the first cell's round is actually in flight — the shape a
    // `job_kill` has.
    const cancelWhenRunning = async (): Promise<void> => {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        if (localAgent.pending.size > 0) { controller.abort(); return }
        await new Promise(resolve => setTimeout(resolve, 5))
      }
      throw new Error('no delegation ever started')
    }
    const [report] = await Promise.all([
      runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state'), signal: controller.signal },
        { datasets: fakeDatasets(root), mission, localAgent }),
      cancelWhenRunning(),
    ])

    // The in-flight delegation was cancelled through the facade — the same
    // lever the budget timer pulls.
    expect(localAgent.pending.size).toBe(0)
    // One cell reached a state; the other was never started.
    expect(report.cells).toHaveLength(1)
    const cell = report.cells[0] as { attempts: number; cancelled?: { reason: string }; finalState: string }
    expect(cell.cancelled?.reason).toContain('cancelled')
    // NOT retried: a cancel is not an infrastructure blip.
    expect(cell.attempts).toBe(1)
    // Left mid-stage, which is what `finalize` reads as `interrupted`.
    expect(cell.finalState).not.toBe('archived')
    expect(report.meta['cancelled']).toBe(true)
    const annotations = orchestratorNs(mission, report.runId, cell2MissionId(report))
    expect(annotations.some(entry => entry['kind'] === 'cell-cancelled')).toBe(true)
  })
})

/** The mission id of the cell the cancelled run actually touched. */
function cell2MissionId(report: { cells: Array<{ missionId: string }> }): string {
  return report.cells[0]?.missionId as string
}

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


describe('runPlan — T11 read-back (usage and model.observed)', () => {
  it('backfills the settled event\u2019s observed model and usage into the delegation annotation', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root, {}, 't8b-settled')
    const mission = new FakeMission(join(root, 'mission'))
    const usage = { inputTokens: 900, outputTokens: 300 }
    const localAgent = new FakeLocalAgent({ readback: { settledModel: DECLARED_MODEL, settledUsage: usage } })
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root), mission, localAgent })

    const cell = report.cells[0] as { missionId: string; childSessionIds: string[] }
    expectDelegationAnnotations(
      orchestratorNs(mission, report.runId, cell.missionId), ['stage1', 'stage2'], cell.childSessionIds,
      { usage, observed: DECLARED_MODEL },
    )
  })

  it('carries the settled event\u2019s tool-call count and CLI build into the annotation', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root, {}, 't30c-toolcalls')
    const mission = new FakeMission(join(root, 'mission'))
    const usage = { inputTokens: 900, outputTokens: 300 }
    const toolCalls = { count: 3, byName: { Bash: 2, Read: 1 } }
    const localAgent = new FakeLocalAgent({
      readback: { settledModel: DECLARED_MODEL, settledUsage: usage, settledToolCalls: toolCalls, settledCliVersion: '0.144.0' },
    })
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root), mission, localAgent })

    const cell = report.cells[0] as { missionId: string; childSessionIds: string[] }
    expectDelegationAnnotations(
      orchestratorNs(mission, report.runId, cell.missionId), ['stage1', 'stage2'], cell.childSessionIds,
      { usage, observed: DECLARED_MODEL, toolCalls, cliVersion: '0.144.0' },
    )
  })

  it('omits toolCalls entirely when the harness reported no accounting', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root, {}, 't30c-no-toolcalls')
    const mission = new FakeMission(join(root, 'mission'))
    const localAgent = new FakeLocalAgent({ readback: { settledModel: DECLARED_MODEL } })
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root), mission, localAgent })

    const cell = report.cells[0] as { missionId: string; childSessionIds: string[] }
    const delegations = orchestratorNs(mission, report.runId, cell.missionId).filter(e => e['kind'] === 'delegation')
    expect(delegations).toHaveLength(2)
    for (const entry of delegations) expect('toolCalls' in entry).toBe(false)
  })

  it('falls back to delegationOf when the settled event carries no model', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root, {}, 't8b-record')
    const mission = new FakeMission(join(root, 'mission'))
    // The settled event fires but names no model; the record does.
    const localAgent = new FakeLocalAgent({ readback: { recordModel: DECLARED_MODEL } })
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state'), readbackWaitMs: 100 },
      { datasets: fakeDatasets(root), mission, localAgent })

    const cell = report.cells[0] as { missionId: string; childSessionIds: string[] }
    expectDelegationAnnotations(
      orchestratorNs(mission, report.runId, cell.missionId), ['stage1', 'stage2'], cell.childSessionIds,
      { observed: DECLARED_MODEL },
    )
  })

  it('waits for the record the provider merges AFTER the result settles', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root, {}, 't8b-late-record')
    const mission = new FakeMission(join(root, 'mission'))
    // The real shape: no settled event reaches the caller (the facade cleared
    // the tracked run), and the record gains the model a beat after settle.
    const localAgent = new FakeLocalAgent({ readback: { recordModel: DECLARED_MODEL, recordModelDelayMs: 150 } })
    // Round 1 resolves as soon as the record lands; the resumed round ran the
    // same model, so its wait expires and returns the carried observation.
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state'), readbackWaitMs: 600 },
      { datasets: fakeDatasets(root), mission, localAgent })

    const cell = report.cells[0] as { missionId: string; childSessionIds: string[] }
    expectDelegationAnnotations(
      orchestratorNs(mission, report.runId, cell.missionId), ['stage1', 'stage2'], cell.childSessionIds,
      { observed: DECLARED_MODEL },
    )
  })

  it('records null when the wait expires with nothing recorded', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root, {}, 't8b-never-record')
    const mission = new FakeMission(join(root, 'mission'))
    // delegationOf exists but the provider never observes a model.
    const localAgent = new FakeLocalAgent({ readback: {} })
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state'), readbackWaitMs: 100 },
      { datasets: fakeDatasets(root), mission, localAgent })

    const cell = report.cells[0] as { missionId: string; finalState: string; childSessionIds: string[] }
    expect(cell.finalState).toBe('archived')
    expectDelegationAnnotations(orchestratorNs(mission, report.runId, cell.missionId), ['stage1', 'stage2'], cell.childSessionIds)
  })

  it('records null against a facade predating T11 — absence is recorded, never guessed', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root, {}, 't8b-absent')
    const mission = new FakeMission(join(root, 'mission'))
    const localAgent = new FakeLocalAgent() // no readback config = no delegationOf at all
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root), mission, localAgent })

    const cell = report.cells[0] as { missionId: string; finalState: string; childSessionIds: string[] }
    expect(cell.finalState).toBe('archived')
    expectDelegationAnnotations(orchestratorNs(mission, report.runId, cell.missionId), ['stage1', 'stage2'], cell.childSessionIds)
  })

  it('fails loud when the observed model contradicts the declared one (frozen decision 5)', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root, {}, 't8b-mismatch')
    const mission = new FakeMission(join(root, 'mission'))
    // The probe reads back the declared model and passes; the STAGE rounds
    // then read back another one. That mid-run switch is what this guard is
    // for — the pre-run probe cannot see it by construction.
    const localAgent = new FakeLocalAgent({
      readback: { recordModel: 'dsh/some-other-model' },
      readinessModel: DECLARED_MODEL,
    })
    await expect(runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state'), readbackWaitMs: 100 },
      { datasets: fakeDatasets(root), mission, localAgent }))
      .rejects.toThrow(/misattributed/)
    // The mismatch is not an infrastructure failure: no retry was opened.
    const cellId = 'p0-placeholder-dsh-exec-rep1'
    expect(orchestratorNs(mission, [...mission.runs.keys()][0] as string, cellId).some(e => e['kind'] === 'cell-skipped')).toBe(false)
  })
})

describe('runPlan — T8b cell anchors', () => {
  it('writes one {kind: cell} anchor per cell before any work, with the condition hash', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root, { reps: 2 }, 't8b-anchor')
    const mission = new FakeMission(join(root, 'mission'))
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root), mission, localAgent: new FakeLocalAgent() })

    const conditionSha = (report.meta['conditions'] as Array<{ id: string; sha: string }>)[0]?.sha
    expect(conditionSha).toMatch(/^[0-9a-f]{64}$/)
    expect(report.cells).toHaveLength(2)
    for (const cell of report.cells) {
      const anchors = cellAnchors(mission, report.runId, cell.missionId)
      expect(anchors).toHaveLength(1)
      expect(anchors[0]).toEqual({
        kind: 'cell', task: 'P0-placeholder', condition: 'dsh-exec', conditionSha, rep: cell.rep,
      })
    }
    // The anchor is the FIRST orchestrator write of the cell — it precedes
    // every delegation, so even a cell that never ran is attributable.
    const first = orchestratorNs(mission, report.runId, report.cells[0]?.missionId as string)[0]
    expect(first?.['kind']).toBe('cell')
  })

  it('anchors a cell whose delegation never starts (the anchor precedes the failure)', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root, {}, 't8b-anchor-skip')
    const mission = new FakeMission(join(root, 'mission'))
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state'), retryInfrastructure: 0 },
      { datasets: fakeDatasets(root), mission, localAgent: new FakeLocalAgent({ alwaysThrow: true }) })

    const cell = report.cells[0] as { missionId: string; skipped?: { reason: string } }
    expect(cell.skipped?.reason).toMatch(/spawn failed/)
    expect(cellAnchors(mission, report.runId, cell.missionId)).toHaveLength(1)
  })
})

describe('runPlan — dataseek.plan/1 retry and exports (T8b)', () => {
  it('takes the retry budget from the plan and lets the run option override it', async () => {
    const root = makeDatasetTree()
    // The plan allows two infrastructure retries; the fake fails twice then succeeds.
    const planPath = writePlan(root, { retry: { infrastructure: 2 } }, 't8b-plan-retry')
    const mission = new FakeMission(join(root, 'mission'))
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root), mission, localAgent: new FakeLocalAgent({ failuresBeforeSuccess: 2 }) })
    const cell = report.cells[0] as { attempts: number; finalState: string }
    expect(cell.attempts).toBe(3)
    expect(cell.finalState).toBe('archived')

    // The option wins over the plan: 0 retries turns the same failure into a skip.
    const root2 = makeDatasetTree()
    const planPath2 = writePlan(root2, { retry: { infrastructure: 2 } }, 't8b-plan-retry-override')
    const mission2 = new FakeMission(join(root2, 'mission'))
    const report2 = await runPlan(planPath2, { parentSessionId: PARENT_SESSION, stateRoot: join(root2, 'state'), retryInfrastructure: 0 },
      { datasets: fakeDatasets(root2), mission: mission2, localAgent: new FakeLocalAgent({ failuresBeforeSuccess: 2 }) })
    expect((report2.cells[0] as { skipped?: unknown }).skipped).toBeDefined()
  })

  it('exports into the plan\u2019s directory, and into the option\u2019s when both are given', async () => {
    const root = makeDatasetTree()
    const planned = join(root, 'planned-exports')
    const planPath = writePlan(root, { exports: planned }, 't8b-plan-exports')
    const mission = new FakeMission(join(root, 'mission'))
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root), mission, localAgent: new FakeLocalAgent() })
    expect(mission.exportRequests[0]?.outDir).toBe(planned)
    expect(report.bundleDir).toBe(join(planned, `${report.runId}-bundle`))

    const root2 = makeDatasetTree()
    const planPath2 = writePlan(root2, { exports: join(root2, 'planned-exports') }, 't8b-plan-exports-override')
    const mission2 = new FakeMission(join(root2, 'mission'))
    const chosen = join(root2, 'chosen-exports')
    await runPlan(planPath2, { parentSessionId: PARENT_SESSION, stateRoot: join(root2, 'state'), exportsDir: chosen },
      { datasets: fakeDatasets(root2), mission: mission2, localAgent: new FakeLocalAgent() })
    expect(mission2.exportRequests[0]?.outDir).toBe(chosen)
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

/* ───────────────────── T9: probes, judging, finalize ──────────────────── */

/** A P0 rubric carrying one of each `kind` — only the two llm-draft rows may reach a judge. */
const RUBRIC = `schema_version: dataseek.rubric/2
rubric_id: P0-default
task_id: P0-placeholder
items:
  - {id: J1, axis: A1, weight: 3, kind: llm-draft,
     criterion: 设计里写清了共享上下文谁能看到,
     evidence: "stage1.md"}
  - {id: J2, axis: A1, weight: 2, kind: llm-draft,
     criterion: 区分了对一个成员说话与对所有人说话,
     evidence: "stage1.md", note: 只看 stage1.md}
  - {id: A2-1, axis: A3, weight: 3, kind: objective,
     criterion: "out_of_scope 非空", evidence: "stage1.json:out_of_scope"}
  - {id: H1, axis: D1, weight: 4, kind: human,
     criterion: 排除的项确实值得排除, evidence: "stage1.json:out_of_scope"}
  - {id: N1, axis: E1, weight: -2, kind: objective, negative: true,
     criterion: 引用了不存在的 API / 文件路径 / 行号, evidence: "stage2.md 全文，脚本核对"}
`

/** Exit 0 WITH verdicts — reads --cell and --rubric, and mislabels task/by on purpose. */
const PROBE_OK = [
  "import { readFileSync, writeFileSync } from 'node:fs'",
  "const args = process.argv.slice(2)",
  "const flag = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }",
  "const cell = flag('--cell'); const rubric = flag('--rubric'); const out = flag('--out')",
  "if (cell === undefined || out === undefined) { console.error('probe: missing --cell/--out'); process.exit(2) }",
  "const stage1 = JSON.parse(readFileSync(cell + '/stage1.json', 'utf8'))",
  "const rubricBytes = rubric === undefined ? 0 : readFileSync(rubric, 'utf8').length",
  "writeFileSync(out, JSON.stringify([{",
  "  schema: 'dataseek.verdict/1',",
  "  task: 'WRONG-the-orchestrator-overwrites-this',",
  "  criterion: 'A2-1',",
  "  pass: Array.isArray(stage1.out_of_scope) && stage1.out_of_scope.length > 0,",
  "  evidence: 'out_of_scope 有 ' + stage1.out_of_scope.length + ' 条；rubric ' + rubricBytes + ' 字节',",
  "  by: 'WRONG-the-orchestrator-overwrites-this',",
  "}]))",
].join('\n') + '\n'

/** Non-zero exit — the probe itself failed, so it produces no verdict. */
const PROBE_FAILS = [
  "console.error('probe: the workspace has no deployment to inspect')",
  "process.exit(1)",
].join('\n') + '\n'

/** Exit 3: the probe is fine, the input the criterion needs is not in this cell. */
const PROBE_NOT_APPLICABLE = [
  "console.error('stage three never ran in this cell — nothing to roll up')",
  "process.exit(3)",
].join('\n') + '\n'

/** A DATASET-level probe: the same ruler, applied once per item. */
const SHARED_PROBE = [
  "import { readFileSync, writeFileSync } from 'node:fs'",
  "const args = process.argv.slice(2)",
  "const flag = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }",
  // cwd is THIS item's verify root, so the item's own checklist is beside it.
  "const task = readFileSync('./checklist.yml', 'utf8').match(/task_id: (\\S+)/)[1]",
  "writeFileSync(flag('--out'), JSON.stringify([{",
  "  schema: 'dataseek.verdict/1', criterion: 'X-no-patch', pass: false,",
  "  evidence: 'checklist beside me says ' + task,",
  "}]))",
].join('\n') + '\n'

/** Exit 0 with NO output — claims a judgement and produces nothing checkable. */
const PROBE_SILENT = "process.exit(0)\n"

/** Write a condition declaration into the dataset tree. */
function writeCondition(root: string, id: string, overrides: Record<string, unknown> = {}): void {
  const condition = {
    schema: 'dataseek.condition/1',
    harness: { name: 'dsh', version: null, drive: 'exec' },
    model: { declared: null, endpoint: null },
    reasoning: { effort: 'default' },
    permissions: 'unrestricted',
    instructions: 'none',
    preset: null,
    skills: { pack: null },
    home: { sha: null },
    env: { keys: [] },
    ...overrides,
  }
  writeFileSync(join(root, 'datasets', 'harness-comparison', 'conditions', `${id}.json`), `${JSON.stringify(condition, null, 2)}\n`)
}

/** The judge condition of the happy path: same harness, a DIFFERENT declared model. */
function writeJudgeCondition(root: string, id = 'judge-r1'): string {
  writeCondition(root, id, { model: { declared: 'judge-model-r1', endpoint: null } })
  return id
}

/** A plan that judges: expectedNs gains llm-draft, judge names its condition. */
function writeJudgingPlan(root: string, judgeIds: string[], samples: number, name = 't9-judge'): string {
  return writePlan(root, {
    judge: { conditions: judgeIds, samples },
    expectedNs: ['script', 'llm-draft'],
  }, name)
}

function llmDraftAnnotations(mission: FakeMission, runId: string, missionId: string): Array<Record<string, unknown>> {
  const record = mission.runs.get(runId)?.missions.get(missionId)
  return (record?.annotations.filter(a => a.ns === 'llm-draft') ?? []).map(a => a.payload as Record<string, unknown>)
}

function scriptAnnotations(mission: FakeMission, runId: string, missionId: string): unknown[] {
  const record = mission.runs.get(runId)?.missions.get(missionId)
  return (record?.annotations.filter(a => a.ns === 'script') ?? []).map(a => a.payload)
}

describe('runPlan — the LLM judge (frozen decision 9)', () => {
  it('samples every judge condition twice, each a fresh delegation in its own cwd, and archives both', async () => {
    const root = makeDatasetTree()
    const judgeId = writeJudgeCondition(root)
    const planPath = writeJudgingPlan(root, [judgeId], 2)
    const localAgent = new FakeLocalAgent()
    const mission = new FakeMission(join(root, 'mission'))
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root, { grading: new Map([['P0-placeholder/rubric.yml', RUBRIC]]) }), mission, localAgent })

    const cell = report.cells[0] as { missionId: string; finalState: string; verdicts?: { script: number; llmDraft: number } }
    expect(cell.finalState).toBe('archived')
    // Two samples × two llm-draft criteria (J1, J2). The objective and human
    // rows of the rubric never reached the judge.
    expect(cell.verdicts).toEqual({ script: 0, llmDraft: 4 })

    const judgeCalls = localAgent.calls.filter(call => call.judge === true)
    expect(judgeCalls).toHaveLength(2)
    expect(judgeCalls.every(call => call.kind === 'start')).toBe(true) // never resume: samples must be independent
    expect(new Set(judgeCalls.map(call => call.cwd)).size).toBe(2)
    // T30b: the judge REQUESTS its declared model rather than inheriting the
    // instance default and being compared against it afterwards — the T22
    // step-5 failure, where a judge declaring one model silently ran another.
    expect(judgeCalls.every(call => call.model === 'judge-model-r1')).toBe(true)
    expect(judgeCalls[0]?.prompt).toContain('J1')
    expect(judgeCalls[0]?.prompt).toContain('J2')
    expect(judgeCalls[0]?.prompt).not.toContain('A2-1') // objective → the probes
    expect(judgeCalls[0]?.prompt).not.toContain('H1') // human → the judge bench

    // One annotation per SAMPLE, provenance beside the verdicts.
    const annotations = llmDraftAnnotations(mission, report.runId, cell.missionId)
    expect(annotations).toHaveLength(2)
    expect(annotations.map(a => a['sample'])).toEqual([1, 2])
    for (const annotation of annotations) {
      expect(annotation['judgeCondition']).toBe(judgeId)
      expect(annotation['judgeSha']).toMatch(/^[0-9a-f]{64}$/)
      expect(annotation['promptSha']).toMatch(/^[0-9a-f]{64}$/)
      const verdicts = annotation['verdicts'] as Array<Record<string, unknown>>
      expect(verdicts.map(v => v['criterion'])).toEqual(['J1', 'J2'])
      // The orchestrator's coordinates win over whatever the judge wrote.
      expect(verdicts.every(v => v['task'] === 'P0-placeholder' && v['by'] === judgeId)).toBe(true)
    }
    // Both samples share one prompt: the only difference between them is the model's own variance.
    expect(annotations[0]?.['promptSha']).toBe(annotations[1]?.['promptSha'])

    const verdictsDir = join(root, 'mission', 'runs', report.runId, 'data', cell.missionId, 'attempt-1', 'archive', 'verdicts')
    expect(JSON.parse(readFileSync(join(verdictsDir, `llm-draft-${judgeId}-1.json`), 'utf8'))).toHaveLength(2)
    expect(existsSync(join(verdictsDir, `llm-draft-${judgeId}-2.json`))).toBe(true)

    // Decision 6 of the brief: judging cost is `kind: judge`, never `delegation`
    // — the report's efficiency table reads `delegation` and nothing else.
    const entries = orchestratorNs(mission, report.runId, cell.missionId)
    expect(entries.filter(e => e['kind'] === 'delegation')).toHaveLength(2) // stage1, stage2 — the players' only
    const judgeEntries = entries.filter(e => e['kind'] === 'judge')
    expect(judgeEntries).toHaveLength(2)
    expect(judgeEntries[0]).toMatchObject({ judgeCondition: judgeId, sample: 1, attempt: 1, usage: null })
    expect(judgeEntries[0]?.['durationMs']).toBeGreaterThanOrEqual(0)

    // The material directory survives the run, for review.
    expect(existsSync(join(root, 'state', 'judge', report.runId, cell.missionId, 'attempt-1', judgeId, 'sample-1', 'prompt.md'))).toBe(true)
    expect(existsSync(join(root, 'state', 'judge', report.runId, cell.missionId, 'attempt-1', judgeId, 'sample-2', 'verdicts.json'))).toBe(true)
  })

  it('de-fingerprints the material, records the replacement table, and leaves the originals alone', async () => {
    const root = makeDatasetTree()
    const judgeId = writeJudgeCondition(root)
    // The player declares a model; both it and the harness names are fingerprints.
    writeCondition(root, 'dsh-exec', { model: { declared: 'deepseek-chat', endpoint: null } })
    const planPath = writeJudgingPlan(root, [judgeId], 2)
    const localAgent = new FakeLocalAgent({
      stageNarrative: 'I am Codex, running on deepseek-chat via the dsh harness. Claude Code would do this differently.\n',
    })
    const mission = new FakeMission(join(root, 'mission'))
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root, { grading: new Map([['P0-placeholder/rubric.yml', RUBRIC]]) }), mission, localAgent })
    const cell = report.cells[0] as { missionId: string }

    const judgePrompt = localAgent.calls.find(call => call.judge === true)?.prompt as string
    expect(judgePrompt).not.toMatch(/codex/i)
    expect(judgePrompt).not.toMatch(/claude/i)
    expect(judgePrompt).not.toMatch(/deepseek-chat/i)
    expect(judgePrompt).toContain('I am <harness>, running on <model> via the <harness> harness. <harness> would do this differently.')

    const table = orchestratorNs(mission, report.runId, cell.missionId).find(e => e['kind'] === 'deidentify') as {
      files: string[]
      table: Array<{ pattern: string; replacement: string; count: number }>
      total: number
    }
    expect(table.files).toEqual(['stage1.json', 'stage1.md', 'stage2.json', 'stage2.md'])
    const byPattern = Object.fromEntries(table.table.map(row => [row.pattern, row]))
    // `deepseek-chat` is consumed before `deepseek`, and `claude code` before `claude`.
    expect(byPattern['deepseek-chat']).toEqual({ pattern: 'deepseek-chat', replacement: '<model>', count: 2 })
    expect(byPattern['claude code']).toEqual({ pattern: 'claude code', replacement: '<harness>', count: 2 })
    expect(byPattern['codex']).toEqual({ pattern: 'codex', replacement: '<harness>', count: 2 })
    expect(byPattern['deepseek']).toBeUndefined()
    expect(byPattern['claude']).toBeUndefined()
    expect(table.total).toBe(table.table.reduce((sum, row) => sum + row.count, 0))

    // The material the cell produced is untouched — only the judge's copy was rewritten.
    const cellDir = join(root, 'state', 'cells', report.runId, cell.missionId, 'attempt-1')
    expect(readFileSync(join(cellDir, 'stage1.md'), 'utf8')).toContain('I am Codex')
  })

  it('retries a sample whose verdicts.json cannot be read, exactly once', async () => {
    const root = makeDatasetTree()
    const judgeId = writeJudgeCondition(root)
    const planPath = writeJudgingPlan(root, [judgeId], 2)
    // Call 1 writes nothing; call 2 (the retry) answers. Sample 2 answers first time.
    const localAgent = new FakeLocalAgent({
      judgeAnswer: (call, cwd, criteria) => {
        if (call === 1) return
        writeFileSync(join(cwd, 'verdicts.json'), JSON.stringify(criteria.map(criterion => ({
          schema: 'dataseek.verdict/1', task: 'P0-placeholder', criterion, pass: call === 2, evidence: `call ${call}`, by: 'fake',
        }))))
      },
    })
    const mission = new FakeMission(join(root, 'mission'))
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root, { grading: new Map([['P0-placeholder/rubric.yml', RUBRIC]]) }), mission, localAgent })
    const cell = report.cells[0] as { missionId: string }

    expect(localAgent.judgeCalls).toBe(3) // sample 1 twice, sample 2 once
    const failures = orchestratorNs(mission, report.runId, cell.missionId).filter(e => e['kind'] === 'judge-parse-failed')
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ judgeCondition: judgeId, sample: 1, attempt: 1 })
    expect(String(failures[0]?.['error'])).toContain('no verdicts.json was written')
    // Both samples still landed — the retry rescued the first one.
    expect(llmDraftAnnotations(mission, report.runId, cell.missionId)).toHaveLength(2)
    expect(existsSync(join(root, 'state', 'judge', report.runId, cell.missionId, 'attempt-1', judgeId, 'sample-1-retry', 'prompt.md'))).toBe(true)
  })

  it('drops a sample that fails twice rather than inventing one', async () => {
    const root = makeDatasetTree()
    const judgeId = writeJudgeCondition(root)
    const planPath = writeJudgingPlan(root, [judgeId], 1)
    const localAgent = new FakeLocalAgent({
      judgeAnswer: (_call, cwd) => { writeFileSync(join(cwd, 'verdicts.json'), '{ this is not json') },
    })
    const mission = new FakeMission(join(root, 'mission'))
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root, { grading: new Map([['P0-placeholder/rubric.yml', RUBRIC]]) }), mission, localAgent })
    const cell = report.cells[0] as { missionId: string; verdicts?: { llmDraft: number } }

    expect(localAgent.judgeCalls).toBe(2)
    expect(orchestratorNs(mission, report.runId, cell.missionId).filter(e => e['kind'] === 'judge-parse-failed')).toHaveLength(2)
    expect(llmDraftAnnotations(mission, report.runId, cell.missionId)).toHaveLength(0)
    expect(cell.verdicts?.llmDraft).toBe(0)
  })

  it('says so honestly when the item ships no rubric — no judging, no empty verdict', async () => {
    const root = makeDatasetTree()
    const judgeId = writeJudgeCondition(root)
    const planPath = writeJudgingPlan(root, [judgeId], 2)
    const localAgent = new FakeLocalAgent()
    const mission = new FakeMission(join(root, 'mission'))
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root), mission, localAgent }) // no grading layer at all
    const cell = report.cells[0] as { missionId: string; verdicts?: { llmDraft: number } }

    expect(localAgent.judgeCalls).toBe(0)
    expect(cell.verdicts?.llmDraft).toBe(0)
    const skipped = orchestratorNs(mission, report.runId, cell.missionId).find(e => e['kind'] === 'judge-skipped')
    expect(String(skipped?.['reason'])).toContain('ships no rubric')
  })
})

describe('runPlan — the judge panel (decision 9, relaxed 2026-09-10)', () => {
  it('runs a judge that shares a model with a player, and marks those cells selfJudged', async () => {
    const root = makeDatasetTree()
    // A different id, the same subject: dsh + the same declared model the
    // fixture player carries (T8b filled it in from the real dataset). Before
    // the relaxation this refused the whole run; now it runs and is DISCLOSED.
    writeCondition(root, 'judge-twin', { model: { declared: DECLARED_MODEL, endpoint: null } })
    const planPath = writeJudgingPlan(root, ['judge-twin'], 1)
    const localAgent = new FakeLocalAgent()
    const mission = new FakeMission(join(root, 'mission'))

    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root, { grading: new Map([['P0-placeholder/rubric.yml', RUBRIC]]) }), mission, localAgent })
    const cell = report.cells[0] as { missionId: string }
    const envelopes = llmDraftAnnotations(mission, report.runId, cell.missionId)
    expect(envelopes).toHaveLength(1)
    expect(envelopes[0]?.['judgeCondition']).toBe('judge-twin')
    expect(envelopes[0]?.['judgeModel']).toBe(DECLARED_MODEL)
    expect(envelopes[0]?.['selfJudged']).toBe(true)
  })

  it('refuses a judge that pins no model — self-judgement would be undecidable', async () => {
    const root = makeDatasetTree()
    writeCondition(root, 'judge-unpinned') // model.declared: null
    const planPath = writeJudgingPlan(root, ['judge-unpinned'], 2)
    const localAgent = new FakeLocalAgent()
    const mission = new FakeMission(join(root, 'mission'))

    // Refused OFFLINE, by validate: the plan never reaches the run loop's own
    // copy of the rule, which is the right order — a plan that cannot run
    // should fail review, not execution.
    const refused = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root), mission, localAgent }).catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(EvalRunRefused)
    expect((refused as EvalRunRefused).diagnostics.map(d => d.code)).toContain('JUDGE_MODEL_UNDECLARED')
    expect(mission.runs.size).toBe(0)
    expect(localAgent.calls).toHaveLength(0)
  })

  it('runs a PANEL: every judge judges every cell, and only the twin is marked selfJudged', async () => {
    const root = makeDatasetTree()
    writeCondition(root, 'judge-twin', { model: { declared: DECLARED_MODEL, endpoint: null } })
    const other = writeJudgeCondition(root, 'judge-other')
    const planPath = writeJudgingPlan(root, ['judge-twin', other], 1)
    const localAgent = new FakeLocalAgent()
    const mission = new FakeMission(join(root, 'mission'))

    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root, { grading: new Map([['P0-placeholder/rubric.yml', RUBRIC]]) }), mission, localAgent })
    const cell = report.cells[0] as { missionId: string }
    const envelopes = llmDraftAnnotations(mission, report.runId, cell.missionId)
    expect(envelopes.map(envelope => [envelope['judgeCondition'], envelope['selfJudged']])).toEqual([
      ['judge-twin', true],
      ['judge-other', false],
    ])
  })

  it('accepts the same harness on a different declared model', async () => {
    const root = makeDatasetTree()
    const judgeId = writeJudgeCondition(root, 'judge-other-model')
    const planPath = writeJudgingPlan(root, [judgeId], 1)
    const mission = new FakeMission(join(root, 'mission'))
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root, { grading: new Map([['P0-placeholder/rubric.yml', RUBRIC]]) }), mission, localAgent: new FakeLocalAgent() })
    expect((report.meta['judge'] as { conditions: Array<{ id: string }> }).conditions).toEqual([
      { id: judgeId, sha: expect.stringMatching(/^[0-9a-f]{64}$/) },
    ])
  })
})

describe('runPlan — probes write the script ns (protocol §6.7)', () => {
  const probes = (): Map<string, string> => new Map([
    ['P0-placeholder/checklist.yml', 'task_id: P0-placeholder\nschema_version: dataseek.verify/1\n'],
    ['P0-placeholder/probes/a-ok.mjs', PROBE_OK],
    ['P0-placeholder/probes/b-fails.mjs', PROBE_FAILS],
    ['P0-placeholder/probes/c-silent.mjs', PROBE_SILENT],
    ['P0-placeholder/probes/d-not-applicable.mjs', PROBE_NOT_APPLICABLE],
  ])

  it('keeps the exit-0 probe, drops the non-zero one and the silent one, and records all four', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root)
    const mission = new FakeMission(join(root, 'mission'))
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') }, {
      datasets: fakeDatasets(root, { grading: new Map([['P0-placeholder/rubric.yml', RUBRIC]]), verify: probes() }),
      mission,
      localAgent: new FakeLocalAgent(),
    })
    const cell = report.cells[0] as { missionId: string; verdicts?: { script: number } }
    expect(cell.verdicts?.script).toBe(1)

    const recorded = orchestratorNs(mission, report.runId, cell.missionId).find(e => e['kind'] === 'probes') as {
      probes: Array<{
        probe: string
        origin: string
        exitCode: number | null
        outcome: string
        ok: boolean
        verdicts: number
        error?: string
        reason?: string
        overwritten?: string[]
      }>
    }
    expect(recorded.probes.map(p => p.probe)).toEqual([
      'probes/a-ok.mjs', 'probes/b-fails.mjs', 'probes/c-silent.mjs', 'probes/d-not-applicable.mjs',
    ])
    expect(recorded.probes[0]).toMatchObject({ origin: 'item', exitCode: 0, outcome: 'judged', ok: true, verdicts: 1 })
    // Non-zero exit: the PROBE failed, so it produced no verdict.
    expect(recorded.probes[1]).toMatchObject({ exitCode: 1, outcome: 'probe-failed', ok: false, verdicts: 0 })
    expect(String(recorded.probes[1]?.error)).toContain('no deployment to inspect')
    // Exit 0 with nothing written is a contract violation, not a verdict.
    expect(recorded.probes[2]).toMatchObject({ exitCode: 0, outcome: 'probe-failed', ok: false, verdicts: 0 })
    expect(String(recorded.probes[2]?.error)).toContain('exited 0 but produced no readable verdict')
    // Exit 3 is the third state: recorded with its reason, and NOT a failure.
    expect(recorded.probes[3]).toMatchObject({ exitCode: 3, outcome: 'probe-skipped', ok: false, verdicts: 0 })
    expect(recorded.probes[3]?.reason).toBe('stage three never ran in this cell — nothing to roll up')
    expect(recorded.probes[3]?.error).toBeUndefined()

    const verdicts = scriptAnnotations(mission, report.runId, cell.missionId)[0] as Array<Record<string, unknown>>
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]).toMatchObject({ criterion: 'A2-1', pass: true })
    // The orchestrator's coordinates overwrite whatever the probe claimed.
    expect(verdicts[0]?.['task']).toBe('P0-placeholder')
    expect(verdicts[0]?.['by']).toBe('probes/a-ok.mjs')
    expect(recorded.probes[0]?.overwritten).toEqual(['by', 'task'])
    // The probe really was handed --rubric (it reported the byte count it read).
    expect(String(verdicts[0]?.['evidence'])).toContain(`rubric ${RUBRIC.length} 字节`)

    const archived = JSON.parse(readFileSync(
      join(root, 'mission', 'runs', report.runId, 'data', cell.missionId, 'attempt-1', 'archive', 'verdicts', 'script.json'), 'utf8',
    )) as unknown[]
    expect(archived).toHaveLength(1)
    // The verify layer does not outlive its use.
    expect(existsSync(join(root, 'state', 'probes', report.runId, cell.missionId, 'attempt-1'))).toBe(false)
  })

  it('runs the dataset’s shared probes too, once for this item, in its verify root', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root)
    const mission = new FakeMission(join(root, 'mission'))
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') }, {
      datasets: fakeDatasets(root, {
        grading: new Map([['P0-placeholder/rubric.yml', RUBRIC]]),
        verify: new Map([
          ['P0-placeholder/checklist.yml', 'task_id: P0-placeholder\n'],
          ['P0-placeholder/probes/own.mjs', PROBE_OK],
        ]),
        datasetVerify: new Map([['helpers/probes/shared.mjs', SHARED_PROBE]]),
      }),
      mission,
      localAgent: new FakeLocalAgent(),
    })
    const cell = report.cells[0] as { missionId: string; verdicts?: { script: number } }
    expect(cell.verdicts?.script).toBe(2)

    const recorded = orchestratorNs(mission, report.runId, cell.missionId).find(e => e['kind'] === 'probes') as {
      probes: Array<{ probe: string; origin: string; outcome: string }>
    }
    // The shared probe goes first (the dataset's veto probe lives there), and
    // is namespaced so its verdicts never collide with an item probe's.
    expect(recorded.probes.map(p => [p.probe, p.origin])).toEqual([
      ['shared/helpers/probes/shared.mjs', 'dataset'],
      ['probes/own.mjs', 'item'],
    ])
    const verdicts = scriptAnnotations(mission, report.runId, cell.missionId)[0] as Array<Record<string, unknown>>
    expect(verdicts[0]).toMatchObject({
      task: 'P0-placeholder',
      criterion: 'X-no-patch',
      by: 'shared/helpers/probes/shared.mjs',
      // It read the ITEM's checklist beside it — the cwd is the item's root.
      evidence: 'checklist beside me says P0-placeholder',
    })
  })

  it('writes nothing at all when the item ships no probes', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root)
    const mission = new FakeMission(join(root, 'mission'))
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root, { grading: new Map([['P0-placeholder/rubric.yml', RUBRIC]]) }), mission, localAgent: new FakeLocalAgent() })
    const cell = report.cells[0] as { missionId: string; verdicts?: { script: number } }
    expect(cell.verdicts?.script).toBe(0)
    expect(scriptAnnotations(mission, report.runId, cell.missionId)).toHaveLength(0)
    expect(orchestratorNs(mission, report.runId, cell.missionId).some(e => e['kind'] === 'probes')).toBe(false)
    expect(existsSync(join(root, 'mission', 'runs', report.runId, 'data', cell.missionId, 'attempt-1', 'archive', 'verdicts', 'script.json'))).toBe(false)
  })
})

describe('runPlan — --finalize and the archive gate', () => {
  it('reaches released once verdicts exist (script alone is enough — no judge configured)', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root)
    const mission = new FakeMission(join(root, 'mission'))
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state'), finalize: true }, {
      datasets: fakeDatasets(root, {
        grading: new Map([['P0-placeholder/rubric.yml', RUBRIC]]),
        verify: new Map([['P0-placeholder/probes/a-ok.mjs', PROBE_OK]]),
      }),
      mission,
      localAgent: new FakeLocalAgent(),
    })
    const cell = report.cells[0] as { missionId: string; finalState: string; verdicts?: { script: number; llmDraft: number } }
    expect(cell.verdicts).toEqual({ script: 1, llmDraft: 0 })
    expect(cell.finalState).toBe('released')
    expect(orchestratorNs(mission, report.runId, cell.missionId).some(e => e['kind'] === 'finalize-refused')).toBe(false)
  })

  it('reaches released on llm-draft alone', async () => {
    const root = makeDatasetTree()
    const judgeId = writeJudgeCondition(root)
    const planPath = writeJudgingPlan(root, [judgeId], 2)
    const mission = new FakeMission(join(root, 'mission'))
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state'), finalize: true },
      { datasets: fakeDatasets(root, { grading: new Map([['P0-placeholder/rubric.yml', RUBRIC]]) }), mission, localAgent: new FakeLocalAgent() })
    expect((report.cells[0] as { finalState: string }).finalState).toBe('released')
  })

  it('still refuses honestly when neither source produced anything', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root)
    const mission = new FakeMission(join(root, 'mission'))
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state'), finalize: true },
      { datasets: fakeDatasets(root), mission, localAgent: new FakeLocalAgent() })
    const cell = report.cells[0] as { missionId: string; finalState: string }
    expect(cell.finalState).toBe('archived')
    const refusal = orchestratorNs(mission, report.runId, cell.missionId).find(e => e['kind'] === 'finalize-refused')
    expect(String(refusal?.['error'])).toContain('empty verdicts/')
  })
})

/* ────────── the pre-run readiness check (pilot A · G4) ─────────── */

describe('runPlan — readiness refuses before the run is created', () => {
  it('probes every condition with one minimal delegation and creates nothing when one fails', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root)
    // The G4 case: the delegation is refused, which no status surface sees.
    const localAgent = new FakeLocalAgent({ readiness: 'refused' })
    const mission = new FakeMission(join(root, 'mission'))

    await expect(runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root), mission, localAgent }))
      .rejects.toThrow(/1 of 1 condition\(s\) failed the pre-run readiness check/)

    // Nothing was created: no run, no cell, no snapshot-driven work.
    expect(mission.runs.size).toBe(0)
    // Exactly one delegation was spent — the probe.
    expect(localAgent.calls).toHaveLength(1)
    expect(localAgent.calls[0]?.readiness).toBe(true)
    expect(localAgent.calls[0]?.prompt).toBe(READINESS_PROMPT)
    // Same cwd rule as a cell: the probe gets its own directory.
    expect(localAgent.calls[0]?.cwd).toContain(join(root, 'state', 'readiness'))
  })

  it('carries the refusal reason so the operator reads the 401, not "a condition failed"', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root)
    const localAgent = new FakeLocalAgent({ readiness: 'refused' })
    const mission = new FakeMission(join(root, 'mission'))
    const error = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root), mission, localAgent }).catch((caught: unknown) => caught as EvalRunRefused)
    expect(error).toBeInstanceOf(EvalRunRefused)
    expect((error as EvalRunRefused).diagnostics[0]?.code).toBe('READINESS_FAILED')
    expect((error as EvalRunRefused).diagnostics[0]?.message).toContain('401 authentication failed')
    expect((error as EvalRunRefused).diagnostics[0]?.message).toContain('dsh-exec')
  })

  it('refuses a condition whose probe cannot even start', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root)
    const localAgent = new FakeLocalAgent({ readiness: 'throw' })
    const mission = new FakeMission(join(root, 'mission'))
    await expect(runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root), mission, localAgent }))
      .rejects.toThrow(/failed the pre-run readiness check/)
    expect(mission.runs.size).toBe(0)
  })

  it('records the ready verdict on run.meta and on every cell of the condition', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root)
    const localAgent = new FakeLocalAgent()
    const mission = new FakeMission(join(root, 'mission'))
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root), mission, localAgent })

    expect(report.readiness).toEqual([expect.objectContaining({
      kind: 'readiness', condition: 'dsh-exec', harness: 'dsh', provider: 'subagent_dsh',
      ok: true, declaredModel: DECLARED_MODEL, observedModel: null,
    })])
    expect(report.meta['readiness']).toEqual(report.readiness)
    const cellId = report.cells[0]?.missionId as string
    const readinessNotes = orchestratorNs(mission, report.runId, cellId).filter(e => e['kind'] === 'readiness')
    expect(readinessNotes).toHaveLength(1)
    expect(readinessNotes[0]?.['ok']).toBe(true)
  })

  it('fails the condition when the probe reads back a model the condition does not declare', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root)
    // Frozen decision 5, caught at the probe instead of at the first stage round.
    const localAgent = new FakeLocalAgent({ readback: { settledModel: 'some-other-model' } })
    const mission = new FakeMission(join(root, 'mission'))
    const error = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root), mission, localAgent }).catch((caught: unknown) => caught as EvalRunRefused)
    expect((error as EvalRunRefused).diagnostics[0]?.message).toContain('misattributed')
    expect(mission.runs.size).toBe(0)
  })
})

describe('runPlan — --ignore-readiness starts anyway and records why the cells produced nothing', () => {
  it('skips every cell of the failed condition with the reason, without delegating', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root, { reps: 2 })
    const localAgent = new FakeLocalAgent({ readiness: 'refused' })
    const mission = new FakeMission(join(root, 'mission'))
    const report = await runPlan(planPath, {
      parentSessionId: PARENT_SESSION,
      stateRoot: join(root, 'state'),
      ignoreReadiness: true,
    }, { datasets: fakeDatasets(root), mission, localAgent })

    expect(report.cells).toHaveLength(2)
    for (const cell of report.cells) {
      expect(cell.skipped?.reason).toContain('failed the pre-run readiness check')
      expect(cell.skipped?.reason).toContain('401 authentication failed')
      expect(cell.finalState).toBe('pending')
      expect(cell.activeMs).toBe(0)
      expect(cell.childSessionIds).toEqual([])
    }
    // Only the probe was delegated: the doomed cells cost nothing more.
    expect(localAgent.calls.filter(call => call.readiness !== true)).toEqual([])
    const skipped = orchestratorNs(mission, report.runId, report.cells[0]?.missionId as string)
      .filter(entry => entry['kind'] === 'cell-skipped')
    expect(skipped).toHaveLength(1)
    expect(skipped[0]?.['reason']).toContain('--ignore-readiness')
  })
})

/* ────────── the run subset: --only / --max-cells ─────────── */

describe('runPlan — the subset is recorded, never implicit', () => {
  it('--only runs exactly the named cells and records the subset in run.meta', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root, { reps: 3 })
    const localAgent = new FakeLocalAgent()
    const mission = new FakeMission(join(root, 'mission'))
    const report = await runPlan(planPath, {
      parentSessionId: PARENT_SESSION,
      stateRoot: join(root, 'state'),
      only: ['p0-placeholder-dsh-exec-rep2'],
    }, { datasets: fakeDatasets(root), mission, localAgent })

    expect(report.cells.map(cell => cell.missionId)).toEqual(['p0-placeholder-dsh-exec-rep2'])
    expect(report.subset).toEqual({ only: ['p0-placeholder-dsh-exec-rep2'], maxCells: null, totalCells: 3, selectedCells: 1 })
    expect(report.meta['subset']).toEqual(report.subset)
    expect(report.meta['order']).toEqual({ seed: 42, sequence: ['p0-placeholder-dsh-exec-rep2'] })
    // The template carries only the selected cell: an unselected mission
    // would sit `pending` in the ledger forever and read as abandoned.
    expect(report.template.missions?.map(m => m.id)).toEqual(['p0-placeholder-dsh-exec-rep2'])
    expect([...(mission.runs.get(report.runId)?.missions.keys() ?? [])]).toEqual(['p0-placeholder-dsh-exec-rep2'])
  })

  it('--max-cells caps the seeded order and records the cap', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root, { reps: 3 })
    const localAgent = new FakeLocalAgent()
    const mission = new FakeMission(join(root, 'mission'))
    const full = orderCells(expandMatrix({ dataset: { items: ['P0-placeholder'] }, conditions: ['dsh-exec'], reps: 3 }), 42, false)
    const report = await runPlan(planPath, {
      parentSessionId: PARENT_SESSION,
      stateRoot: join(root, 'state'),
      maxCells: 2,
    }, { datasets: fakeDatasets(root), mission, localAgent })

    expect(report.cells.map(cell => cell.missionId)).toEqual(full.slice(0, 2).map(cell => cell.missionId))
    expect(report.subset).toEqual({ only: null, maxCells: 2, totalCells: 3, selectedCells: 2 })
    expect(report.meta['subset']).toEqual(report.subset)
  })

  it('refuses an --only id the matrix does not contain, before anything runs', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root)
    const localAgent = new FakeLocalAgent()
    const mission = new FakeMission(join(root, 'mission'))
    const error = await runPlan(planPath, {
      parentSessionId: PARENT_SESSION,
      stateRoot: join(root, 'state'),
      only: ['p0-placeholder-dsh-exec-rep9'],
    }, { datasets: fakeDatasets(root), mission, localAgent }).catch((caught: unknown) => caught as EvalRunRefused)
    expect(error).toBeInstanceOf(EvalRunRefused)
    expect((error as EvalRunRefused).diagnostics[0]?.code).toBe('ONLY_UNKNOWN_CELL')
    expect(mission.runs.size).toBe(0)
    // Refused before the readiness probe: no delegation was spent.
    expect(localAgent.calls).toEqual([])
  })

  it('a dry run rehearses the subset too', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root, { reps: 3 })
    const report = await runPlan(planPath, { dryRun: true, maxCells: 2 })
    expect(report.subset).toEqual({ only: null, maxCells: 2, totalCells: 3, selectedCells: 2 })
    expect((report.meta['order'] as { sequence: string[] }).sequence).toHaveLength(2)
    expect(report.readiness).toEqual([])
  })
})

/* ──────────────────────── the container path (T20) ────────────────────── */

/**
 * A lab face that is a real simulation rather than a stub: a host directory
 * stands in for each unit's workspace, `populate` and `collect` really copy,
 * `archive` really writes `workspace/` plus a manifest, `verify` really runs
 * the command the executor built (with the three in-container roots
 * translated back to their host stand-ins), and `release` really consults the
 * mission gate. That is what makes the assertions below about ORDER and
 * ARGUMENTS mean something: the same call sequence against a stub would pass
 * while producing nothing.
 */
class FakeLab implements LabFace {
  /** Every verb, in call order — the trajectory table, as executed. */
  calls: Array<{ verb: string; unitId?: string; options?: Record<string, unknown> }> = []
  /** Units that still exist. A released one is gone; a gate-refused one is not. */
  live = new Map<string, { info: LabUnitInfo; workspace: string; verdicts: string; spec: LabAcquireSpec }>()
  /** Every unit ever acquired, released or not. */
  acquired: LabAcquireSpec[] = []
  private seq = 0

  constructor(private readonly root: string, private readonly mission: FakeMission) {}

  private locate(unitId: string): { info: LabUnitInfo; workspace: string; verdicts: string; spec: LabAcquireSpec } {
    const held = this.live.get(unitId)
    if (held === undefined) throw new Error(`fake lab: unknown unit ${JSON.stringify(unitId)}`)
    return held
  }

  /** The three in-container roots, mapped onto their host stand-ins. */
  private toHost(text: string, unitId: string, material: string | undefined): string {
    const held = this.locate(unitId)
    let out = text.replaceAll('/workspace', held.workspace).replaceAll('/run/dsh-lab/verdicts', held.verdicts)
    if (material !== undefined) out = out.replaceAll('/run/dsh-lab/verify', material)
    return out.replaceAll('exec node ', `exec ${process.execPath} `).replaceAll('exec sh ', 'exec /bin/sh ')
  }

  async acquire(spec: LabAcquireSpec): Promise<LabUnitInfo> {
    this.calls.push({ verb: 'acquire', options: spec as unknown as Record<string, unknown> })
    this.acquired.push(spec)
    const id = `u${++this.seq}`
    const workspace = join(this.root, id, 'workspace')
    const verdicts = join(this.root, id, 'verdicts')
    mkdirSync(workspace, { recursive: true })
    // The components lab would compute for this spec, in lab's own shape —
    // and the fingerprint is their hash, so a class derived by removing
    // components is comparable with a unit's own by construction.
    const components = {
      version: 1,
      image: `registry/${spec.image}@sha256:fixed`,
      resources: { cpus: spec.resources?.cpus === undefined ? null : String(spec.resources.cpus), memory: spec.resources?.memory === undefined ? null : String(spec.resources.memory) },
      mounts: (spec.mounts ?? []).map(mount => ({ target: mount.target, type: mount.type ?? 'bind', readonly: mount.readonly === true }))
        .sort((a, b) => a.target.localeCompare(b.target)),
      envKeys: Object.keys(spec.env ?? {}).sort(),
      network: spec.network ?? null,
      user: spec.user ?? null,
    }
    const info: LabUnitInfo = {
      id,
      provider: 'docker',
      resource: `dsh-lab-${id}`,
      fingerprint: this.fingerprintOf(components),
      fingerprintComponents: components,
      workspace: '/workspace',
      createdAt: 0,
      ...(spec.missionId !== undefined ? { missionId: spec.missionId } : {}),
      ...(spec.runId !== undefined ? { runId: spec.runId } : {}),
    }
    this.live.set(id, { info, workspace, verdicts, spec })
    return info
  }

  async populate(unitId: string, options: { source: string; target?: string; manifestPath?: string; artifactPath?: string }): Promise<{ sha: string; count: number; files: Array<{ path: string; sha: string }> }> {
    this.calls.push({ verb: 'populate', unitId, options })
    const held = this.locate(unitId)
    cpSync(options.source, held.workspace, { recursive: true })
    const files = readdirSync(options.source, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => ({
        path: join(entry.parentPath, entry.name).slice(options.source.length + 1),
        sha: createHash('sha256').update(readFileSync(join(entry.parentPath, entry.name))).digest('hex'),
      }))
      .sort((a, b) => (a.path < b.path ? -1 : 1))
    const sha = createHash('sha256').update(files.map(file => `${file.path}  ${file.sha}`).join('\n')).digest('hex')
    if (options.manifestPath !== undefined) {
      writeFileSync(options.manifestPath, `${JSON.stringify({ source: options.source, target: options.target, sha, count: files.length, files, populatedAt: 0 }, null, 2)}\n`)
      await this.mission.addArtifact(unitId === '' ? '' : held.info.missionId as string, { path: options.artifactPath ?? options.manifestPath, kind: 'materialization' }, { runId: held.info.runId as string })
    }
    return { sha, count: files.length, files }
  }

  async collect(unitId: string, options: { source: string; target: string; kind?: string; artifactPath?: string }): Promise<void> {
    this.calls.push({ verb: 'collect', unitId, options })
    const held = this.locate(unitId)
    const source = options.source === '/workspace' ? held.workspace : held.verdicts
    mkdirSync(options.target, { recursive: true })
    if (existsSync(source)) cpSync(source, options.target, { recursive: true })
    else throw new Error(`fake lab: ${options.source} does not exist in ${held.info.resource}`)
    if (held.info.missionId !== undefined) {
      await this.mission.addArtifact(held.info.missionId, { path: options.artifactPath ?? options.target, kind: options.kind ?? 'collection' }, { runId: held.info.runId as string })
    }
  }

  async checkpoint(unitId: string, options: { name: string }): Promise<{ ref: string }> {
    this.calls.push({ verb: 'checkpoint', unitId, options })
    return { ref: createHash('sha1').update(`${unitId}/${options.name}`).digest('hex') }
  }

  async verify(unitId: string, options: { command: string[]; source?: string; timeoutMs?: number }): Promise<LabVerifyResult> {
    this.calls.push({ verb: 'verify', unitId, options })
    const held = this.locate(unitId)
    let material: string | undefined
    if (options.source !== undefined) {
      material = join(this.root, held.info.id, 'material')
      rmSync(material, { recursive: true, force: true })
      mkdirSync(material, { recursive: true })
      cpSync(options.source, material, { recursive: true })
    }
    const script = this.toHost(options.command[2] as string, unitId, material)
    try {
      const stdout = execFileSync('/bin/sh', ['-c', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      return { exitCode: 0, stdout, stderr: '', durationMs: 1, timedOut: false }
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string }
      return { exitCode: failure.status ?? -1, stdout: String(failure.stdout ?? ''), stderr: String(failure.stderr ?? ''), durationMs: 1, timedOut: false }
    } finally {
      if (material !== undefined) rmSync(material, { recursive: true, force: true })
    }
  }

  async archive(unitId: string, options: { target: string; kind?: string; artifactPath?: string }): Promise<void> {
    this.calls.push({ verb: 'archive', unitId, options })
    const held = this.locate(unitId)
    cpSync(held.workspace, join(options.target, 'workspace'), { recursive: true })
    writeFileSync(join(options.target, 'manifest.json'), `${JSON.stringify({ unit: held.info, archivedAt: 0 }, null, 2)}\n`)
    if (held.info.missionId !== undefined) {
      await this.mission.addArtifact(held.info.missionId, { path: options.artifactPath ?? options.target, kind: options.kind ?? 'archive' }, { runId: held.info.runId as string })
    }
  }

  async release(unitId: string, options?: { force?: boolean }): Promise<void> {
    this.calls.push({ verb: 'release', unitId, ...(options !== undefined ? { options } : {}) })
    const held = this.locate(unitId)
    if (held.info.missionId === undefined) {
      // No mission binding, so no gate: lab requires the caller's own guarantee.
      if (options?.force !== true) throw new Error(`lab: release of ${unitId} refused — it is registered to no mission; pass force`)
    } else if (!this.mission.isReleasable(held.info.missionId, held.info.runId)) {
      throw new Error(`lab: release of ${unitId} refused — mission ${held.info.missionId} is not in a releasable state; archive and pass its gate first`)
    }
    this.live.delete(unitId)
  }

  /** lab's pure hashing verb: the same rule, over whatever components it is handed. */
  fingerprintOf(components: LabFingerprintComponents): string {
    return `lab-env:${createHash('sha256').update(canonicalJson(components)).digest('hex')}`
  }

  async status(unitId?: string): Promise<Array<{ id: string; resource: string; running: boolean }>> {
    this.calls.push({ verb: 'status', ...(unitId !== undefined ? { unitId } : {}) })
    return [...this.live.values()].map(held => ({ id: held.info.id, resource: held.info.resource, running: true }))
  }
}

const UNIT_SEGMENT = { image: 'eval-env:pinned', network: 'eval-net', user: '1000', resources: { cpus: '2', memory: '4g' } }

/** The fixture condition plus the unit segment a container run requires. */
function writeUnitCondition(root: string, id = 'dsh-unit'): void {
  const base = JSON.parse(readFileSync(join(FIXTURE_DATASET, 'conditions', 'dsh-exec.json'), 'utf8')) as Record<string, unknown>
  writeFileSync(join(root, 'datasets', 'harness-comparison', 'conditions', `${id}.json`), `${JSON.stringify({
    ...base,
    env: { keys: ['DEEPSEEK_API_KEY', 'DSH_HOME'] },
    unit: { scopedHome: { container: '/creds/dsh', var: 'DSH_HOME' } },
  }, null, 2)}\n`)
}

/**
 * The scoped home local-agent would have provisioned for a harness, with a
 * credential in it. The container path mounts THIS — the instance's own — so
 * a round's rollout lands where the read-back reads it. With a `scope` it is
 * the NAMED scoped home (`<harness>@<scope>`), the sibling directory that
 * scope's own `/<harness> login --scope <name>` writes into.
 */
function stageScopedHome(root: string, harness = 'dsh', scope?: string): string {
  const homesRoot = join(root, 'homes')
  const dir = join(homesRoot, scope === undefined ? harness : `${harness}@${scope}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'auth.json'), '{"written by /<harness> login": true}\n')
  return homesRoot
}

/** The unit condition, plus the named harness scope its rounds run against. */
function writeScopedUnitCondition(root: string, id: string, scope: string): void {
  const base = JSON.parse(readFileSync(join(FIXTURE_DATASET, 'conditions', 'dsh-exec.json'), 'utf8')) as Record<string, unknown>
  writeFileSync(join(root, 'datasets', 'harness-comparison', 'conditions', `${id}.json`), `${JSON.stringify({
    ...base,
    scope,
    env: { keys: ['DEEPSEEK_API_KEY', 'DSH_HOME'] },
    unit: { scopedHome: { container: '/creds/dsh', var: 'DSH_HOME' } },
  }, null, 2)}\n`)
}

/** The probes the container cells judge with (the same fixtures the host path uses). */
function unitProbes(): Map<string, string> {
  return new Map([
    ['P0-placeholder/checklist.yml', 'task_id: P0-placeholder\nschema_version: dataseek.verify/1\n'],
    ['P0-placeholder/probes/a-ok.mjs', PROBE_OK],
    ['P0-placeholder/probes/d-not-applicable.mjs', PROBE_NOT_APPLICABLE],
  ])
}

describe('runPlan — the container path drives one unit per cell (I3·T20)', () => {
  it('takes the eight verbs in the order the trajectory table declares, and no others', async () => {
    const root = makeDatasetTree()
    writeUnitCondition(root)
    const homesRoot = stageScopedHome(root)
    const planPath = writePlan(root, { conditions: ['dsh-unit'], unit: UNIT_SEGMENT }, 'container')
    const mission = new FakeMission(join(root, 'mission'))
    const lab = new FakeLab(join(root, 'units'), mission)
    const agent = new FakeLocalAgent({ homesRoot, workspaceOf: (container) => {
      const held = [...lab.live.values()].find(unit => unit.info.resource === container)
      return held?.workspace ?? ''
    } })
    const report = await runPlan(planPath, {
      parentSessionId: PARENT_SESSION,
      stateRoot: join(root, 'state'),
      finalize: true,
    }, { datasets: fakeDatasets(root, { grading: new Map([['P0-placeholder/rubric.yml', RUBRIC]]), verify: unitProbes() }), mission, localAgent: agent, lab })

    const cell = report.cells[0] as { missionId: string; finalState: string; verdicts?: { script: number } }
    expect(cell.finalState).toBe('released')
    expect(cell.verdicts?.script).toBe(1)

    // Two acquires: the readiness probe unit first (bound to no mission), then
    // the cell's own. Everything after that is the cell's, in trajectory order.
    const verbs = lab.calls.map(call => call.verb)
    expect(verbs).toEqual([
      'acquire', 'release', // the readiness probe unit
      'acquire', 'populate',
      'checkpoint', 'collect', // stage1
      'checkpoint', 'collect', // stage2
      'verify', 'verify', 'collect', 'verify', // two probes, the verdict collect, the scratch removal
      'archive', 'release',
    ])
    // `status` is a human surface: the loop reads the mission ledger, never
    // asks the provider what state a cell is in.
    expect(verbs).not.toContain('status')

    const cellAcquire = lab.acquired[1] as LabAcquireSpec
    expect(cellAcquire).toMatchObject({
      image: 'eval-env:pinned',
      network: 'eval-net',
      user: '1000',
      resources: { cpus: '2', memory: '4g' },
      workdir: '/workspace',
      ownWorkdir: true,
      missionId: cell.missionId,
      runId: report.runId,
    })
    // THE mount source: the instance's own scoped home for that harness, which
    // is where the CLI writes its rollout and where the read-back looks.
    expect(cellAcquire.mounts).toEqual([{ source: join(homesRoot, 'dsh'), target: '/creds/dsh', type: 'bind' }])
    expect(cellAcquire.mounts?.[0]?.source).toBe(agent.homeDir('dsh'))
    expect(cellAcquire.env).toEqual({ DSH_HOME: '/creds/dsh', NODE_OPTIONS: '--use-env-proxy' })
    // The readiness unit is the same environment minus the mission binding —
    // a probe against a different environment would prove nothing.
    expect(lab.acquired[0]).toMatchObject({ image: 'eval-env:pinned', network: 'eval-net', user: '1000' })
    expect(lab.acquired[0]?.missionId).toBeUndefined()

    const checkpoints = lab.calls.filter(call => call.verb === 'checkpoint')
    expect(checkpoints.map(call => (call.options as { name: string }).name)).toEqual(['stage1', 'stage2'])
    // The unit is gone, and it went through the gate rather than around it.
    expect(lab.live.size).toBe(0)
    expect(lab.calls.filter(call => call.verb === 'release').map(call => call.options)).toEqual([{ force: true }, undefined])
  })

  it('addresses every round at the unit and never at a host cwd', async () => {
    const root = makeDatasetTree()
    writeUnitCondition(root)
    const homesRoot = stageScopedHome(root)
    const planPath = writePlan(root, { conditions: ['dsh-unit'], unit: UNIT_SEGMENT }, 'container')
    const mission = new FakeMission(join(root, 'mission'))
    const lab = new FakeLab(join(root, 'units'), mission)
    const agent = new FakeLocalAgent({ homesRoot, workspaceOf: (container) => {
      const held = [...lab.live.values()].find(unit => unit.info.resource === container)
      return held?.workspace ?? ''
    } })
    await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') }, {
      datasets: fakeDatasets(root, { verify: unitProbes() }), mission, localAgent: agent, lab,
    })
    const stageRounds = agent.calls.filter(call => call.readiness !== true && call.judge !== true)
    expect(stageRounds).toHaveLength(2)
    for (const round of stageRounds) {
      expect(round.cwd).toBeUndefined()
      // The scoped-home variable is the one thing the target must carry: T17
      // refuses the round outright without it, because a host path there would
      // start the CLI in a directory the unit does not have.
      expect(round.exec).toEqual({ container: 'dsh-lab-u2', workdir: '/workspace', env: { DSH_HOME: '/creds/dsh' } })
    }
    // The readiness probe ran in its own unit, on the same rule.
    const probe = agent.calls.find(call => call.readiness === true)
    expect(probe?.cwd).toBeUndefined()
    expect(probe?.exec).toMatchObject({ container: 'dsh-lab-u1', workdir: '/workspace' })
  })

  it('gives two conditions that differ only in scope two scoped homes, two probes and two mounts', async () => {
    // T29's whole point: one harness, two logins. The two conditions are
    // byte-identical except for `scope`, which makes them two SUBJECTS — and
    // every directory the run touches for them has to be two directories.
    const root = makeDatasetTree()
    writeUnitCondition(root, 'dsh-unit-a')
    writeScopedUnitCondition(root, 'dsh-unit-b', 'eval-b')
    const homesRoot = stageScopedHome(root)
    stageScopedHome(root, 'dsh', 'eval-b')
    const planPath = writePlan(root, { conditions: ['dsh-unit-a', 'dsh-unit-b'], unit: UNIT_SEGMENT }, 'container-scoped')
    const mission = new FakeMission(join(root, 'mission'))
    const lab = new FakeLab(join(root, 'units'), mission)
    const agent = new FakeLocalAgent({ homesRoot, workspaceOf: (container) => {
      const held = [...lab.live.values()].find(unit => unit.info.resource === container)
      return held?.workspace ?? ''
    } })
    const report = await runPlan(planPath, {
      parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state'), finalize: true,
    }, { datasets: fakeDatasets(root, { verify: unitProbes() }), mission, localAgent: agent, lab })

    // Two cells, and two conditions with different hashes: `scope` is a
    // factor, so the two documents are not the same subject.
    expect(report.cells).toHaveLength(2)
    const shas = (report.meta['conditions'] as Array<{ id: string; sha: string }>).map(entry => entry.sha)
    expect(new Set(shas).size).toBe(2)

    // The mount source per cell: each condition's OWN scoped home.
    const sources = lab.acquired.filter(spec => spec.missionId !== undefined).map(spec => spec.mounts?.[0]?.source)
    expect(new Set(sources)).toEqual(new Set([join(homesRoot, 'dsh'), join(homesRoot, 'dsh@eval-b')]))
    expect(sources).toContain(agent.homeDir('dsh', 'eval-b'))

    // The readiness probe proves the credential of the scope the cells use.
    const probes = agent.calls.filter(call => call.readiness === true)
    expect(probes).toHaveLength(2)
    expect(probes.filter(call => call.scope === 'eval-b')).toHaveLength(1)
    expect(probes.filter(call => call.scope === undefined)).toHaveLength(1)
    expect((report.meta['readiness'] as Array<{ condition: string; ok: boolean; scope?: string }>)
      .map(record => [record.condition, record.ok, record.scope ?? null]))
      .toEqual([['dsh-unit-a', true, null], ['dsh-unit-b', true, 'eval-b']])

    // Every stage round of the scoped cell names the scope; the default
    // cell's rounds name none — byte for byte the pre-scope call.
    const stageRounds = agent.calls.filter(call => call.readiness !== true && call.judge !== true)
    expect(stageRounds.filter(call => call.scope === 'eval-b').length).toBeGreaterThan(0)
    expect(stageRounds.filter(call => call.scope === undefined).length).toBeGreaterThan(0)

    // run.meta records which scope each condition ran against. The HOST paths
    // stay out of the bundle (an operator fact), so the scope NAME is what
    // makes the two entries legible as two directories.
    expect(report.meta['unit']).toMatchObject({
      scopedHomes: [
        { condition: 'dsh-unit-a', container: '/creds/dsh', var: 'DSH_HOME' },
        { condition: 'dsh-unit-b', container: '/creds/dsh', var: 'DSH_HOME', scope: 'eval-b' },
      ],
    })
    for (const cell of report.cells) expect(cell.finalState).toBe('released')
  })

  it('writes the unit fingerprint into refs, which is what makes «环境一致» checkable', async () => {
    const root = makeDatasetTree()
    writeUnitCondition(root)
    const homesRoot = stageScopedHome(root)
    const planPath = writePlan(root, { conditions: ['dsh-unit'], reps: 2, unit: UNIT_SEGMENT }, 'container')
    const mission = new FakeMission(join(root, 'mission'))
    const lab = new FakeLab(join(root, 'units'), mission)
    const agent = new FakeLocalAgent({ homesRoot, workspaceOf: (container) => {
      const held = [...lab.live.values()].find(unit => unit.info.resource === container)
      return held?.workspace ?? ''
    } })
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state'), finalize: true }, {
      datasets: fakeDatasets(root, { verify: unitProbes() }), mission, localAgent: agent, lab,
    })
    const fingerprints = report.cells.map(cell => mission.refsOf(cell.missionId, report.runId).fingerprint)
    expect(fingerprints).toHaveLength(2)
    expect(fingerprints[0]).toMatch(/^lab-env:[0-9a-f]{64}$/)
    // Same declared environment, same fingerprint: that is the invariant.
    expect(new Set(fingerprints).size).toBe(1)
    for (const cell of report.cells) {
      expect(mission.refsOf(cell.missionId, report.runId).resource).toMatch(/^dsh-lab-u\d+$/)
    }
    const unitAnnotation = orchestratorNs(mission, report.runId, report.cells[0]?.missionId as string).find(e => e['kind'] === 'unit')
    expect(unitAnnotation).toMatchObject({ image: 'eval-env:pinned', scopedHome: { container: '/creds/dsh', var: 'DSH_HOME' } })
  })

  it('judges inside the unit and keeps the judging output out of the archived workspace', async () => {
    const root = makeDatasetTree()
    writeUnitCondition(root)
    const homesRoot = stageScopedHome(root)
    const planPath = writePlan(root, { conditions: ['dsh-unit'], unit: UNIT_SEGMENT }, 'container')
    const mission = new FakeMission(join(root, 'mission'))
    const lab = new FakeLab(join(root, 'units'), mission)
    const agent = new FakeLocalAgent({ homesRoot, workspaceOf: (container) => {
      const held = [...lab.live.values()].find(unit => unit.info.resource === container)
      return held?.workspace ?? ''
    } })
    const report = await runPlan(planPath, {
      parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state'), finalize: true,
    }, { datasets: fakeDatasets(root, { grading: new Map([['P0-placeholder/rubric.yml', RUBRIC]]), verify: unitProbes() }), mission, localAgent: agent, lab })

    const missionId = report.cells[0]?.missionId as string
    const probed = orchestratorNs(mission, report.runId, missionId).find(e => e['kind'] === 'probes') as {
      where: string
      probes: Array<{ probe: string; outcome: string; exitCode: number | null }>
    }
    expect(probed.where).toBe('unit')
    expect(probed.probes.map(probe => [probe.probe, probe.outcome])).toEqual([
      ['probes/a-ok.mjs', 'judged'],
      ['probes/d-not-applicable.mjs', 'probe-skipped'],
    ])
    const archive = join(root, 'mission', 'runs', report.runId, 'data', missionId, 'attempt-1', 'archive')
    expect(existsSync(join(archive, 'workspace', 'stage2.json'))).toBe(true)
    expect(existsSync(join(archive, 'verdicts', 'script.json'))).toBe(true)
    expect(existsSync(join(archive, 'manifest.json'))).toBe(true)
    // The archive is the player's work: no verdict tree inside the workspace.
    expect(existsSync(join(archive, 'workspace', 'verdicts'))).toBe(false)
    // …and the raw per-probe output came back beside it, as one artifact.
    expect(existsSync(join(root, 'mission', 'runs', report.runId, 'data', missionId, 'attempt-1', 'probe-verdicts', 'probes-a-ok.mjs', 'verdicts.json'))).toBe(true)
  })

  it('keeps the container when the gate refuses, and says so on the cell', async () => {
    const root = makeDatasetTree()
    writeUnitCondition(root)
    const homesRoot = stageScopedHome(root)
    // No probes and no judge: verdicts/ is empty, so the archive gate refuses.
    const planPath = writePlan(root, { conditions: ['dsh-unit'], unit: UNIT_SEGMENT }, 'container')
    const mission = new FakeMission(join(root, 'mission'))
    const lab = new FakeLab(join(root, 'units'), mission)
    const agent = new FakeLocalAgent({ homesRoot, workspaceOf: (container) => {
      const held = [...lab.live.values()].find(unit => unit.info.resource === container)
      return held?.workspace ?? ''
    } })
    const report = await runPlan(planPath, {
      parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state'), finalize: true,
    }, { datasets: fakeDatasets(root), mission, localAgent: agent, lab })

    const missionId = report.cells[0]?.missionId as string
    expect(report.cells[0]?.finalState).toBe('archived')
    // The unit is still there. That is the point of a single destroy path: a
    // cell nobody has looked at keeps its evidence.
    expect(lab.live.size).toBe(1)
    const retained = orchestratorNs(mission, report.runId, missionId).find(e => e['kind'] === 'unit-retained') as { reason: string }
    expect(retained.reason).toContain('not in a releasable state')
  })

  it('leaves the host path alone: a plan with no unit segment touches no lab verb', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root)
    const mission = new FakeMission(join(root, 'mission'))
    const lab = new FakeLab(join(root, 'units'), mission)
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') }, {
      datasets: fakeDatasets(root), mission, localAgent: new FakeLocalAgent(), lab,
    })
    expect(lab.calls).toEqual([])
    const missionId = report.cells[0]?.missionId as string
    // The host path still writes its OWN materialization record, with the
    // sha256 field the report reads — unchanged, mounted lab or not.
    const record = JSON.parse(readFileSync(join(root, 'mission', 'runs', report.runId, 'data', missionId, 'attempt-1', 'materialization.json'), 'utf8')) as { sha256?: string }
    expect(record.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(mission.refsOf(missionId, report.runId).fingerprint).toBeUndefined()
  })

  it('refuses before anything executes when the container path is not satisfiable', async () => {
    const root = makeDatasetTree()
    writeUnitCondition(root)
    const homesRoot = stageScopedHome(root)
    const planPath = writePlan(root, { conditions: ['dsh-unit'], unit: UNIT_SEGMENT }, 'container')
    const mission = new FakeMission(join(root, 'mission'))
    const lab = new FakeLab(join(root, 'units'), mission)
    const deps = { datasets: fakeDatasets(root), mission, localAgent: new FakeLocalAgent(), lab }

    await expect(runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') }, { ...deps, lab: undefined }))
      .rejects.toThrow(/needs the lab service/)
    await expect(runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state'), concurrency: 2 }, deps))
      .rejects.toThrow(/serial in this line/)
    // A lab predating the hashing verb: the environment class cannot be
    // derived, and deriving it by a second rule is exactly what must not
    // happen — so the run is refused and says which verb is missing.
    const older = Object.create(Object.getPrototypeOf(lab) as object, Object.getOwnPropertyDescriptors(lab)) as LabFace & { fingerprintOf?: unknown }
    older.fingerprintOf = undefined
    await expect(runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') }, { ...deps, lab: older }))
      .rejects.toThrow(/fingerprintOf/)
    // A harness nobody has logged in on: its scoped home is empty (or absent),
    // and every cell would 401 — refused before the run exists.
    const loggedOut = new FakeLocalAgent({ homesRoot: join(root, 'never-logged-in') })
    await expect(runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') }, { ...deps, localAgent: loggedOut }))
      .rejects.toThrow(/nothing was executed/)
    // …and a facade with no homeDir at all is a refusal that names the method,
    // never a mount of some other directory.
    const noHomeDir = new FakeLocalAgent({ homesRoot }) as FakeLocalAgent & { homeDir?: unknown }
    noHomeDir.homeDir = undefined
    await expect(runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') }, { ...deps, localAgent: noHomeDir }))
      .rejects.toThrow(/homeDir/)
    // Nothing was acquired by any of the four refusals.
    expect(lab.calls).toEqual([])

    // …and a condition that never said where its scoped home is mounted is a
    // validation error, so the plan does not even reach the run loop.
    const planNoUnit = writePlan(root, { conditions: ['dsh-exec'], unit: UNIT_SEGMENT }, 'container-bad')
    await expect(runPlan(planNoUnit, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') }, deps))
      .rejects.toThrow(/validation error/)
  })

  it('rehearses the acquire spec on a dry run, with env NAMES and no values', async () => {
    const root = makeDatasetTree()
    writeUnitCondition(root)
    const planPath = writePlan(root, { conditions: ['dsh-unit'], unit: UNIT_SEGMENT }, 'container')
    const report = await runPlan(planPath, { dryRun: true })
    const units = report.meta['units'] as Array<{ condition: string; acquire: Record<string, unknown> }>
    expect(units).toHaveLength(1)
    expect(units[0]?.condition).toBe('dsh-unit')
    expect(units[0]?.acquire).toMatchObject({ image: 'eval-env:pinned', network: 'eval-net', user: '1000', workdir: '/workspace' })
    // A dry run has no facade to ask, so the mount source is named by shape.
    expect(JSON.stringify(units[0]?.acquire)).toContain('scoped home of dsh')
    expect(units[0]?.acquire['envKeys']).toEqual(['DSH_HOME', 'NODE_OPTIONS'])
    expect(units[0]?.acquire).not.toHaveProperty('env')
  })

  it('names the scope in the rehearsed mount shape when a condition declares one', async () => {
    const root = makeDatasetTree()
    writeScopedUnitCondition(root, 'dsh-unit-b', 'eval-b')
    const planPath = writePlan(root, { conditions: ['dsh-unit-b'], unit: UNIT_SEGMENT }, 'container-scoped-dry')
    const report = await runPlan(planPath, { dryRun: true })
    const units = report.meta['units'] as Array<{ condition: string; acquire: Record<string, unknown> }>
    // The shape says WHICH scoped home, so a reviewer of the rehearsal can see
    // that two conditions of one harness mount two directories.
    expect(JSON.stringify(units[0]?.acquire)).toContain('scoped home of dsh@eval-b')
  })
})

describe('runPlan — «环境一致» compares the environment class, not the unit (T20b)', () => {
  /** Four conditions differing ONLY in the scoped home each one mounts. */
  const HARNESSES = [
    { id: 'codex-unit', name: 'codex', permissions: 'danger-full-access', container: '/creds/codex', variable: 'CODEX_HOME' },
    { id: 'claude-unit', name: 'claude-code', permissions: 'skip', container: '/creds/claude', variable: 'CLAUDE_CONFIG_DIR' },
    { id: 'kimi-unit', name: 'kimi', permissions: 'auto-approve', container: '/creds/kimi', variable: 'KIMI_CODE_HOME' },
    { id: 'dsh-unit', name: 'dsh', permissions: 'unrestricted', container: '/creds/dsh', variable: 'DSH_HOME' },
  ]

  function writeFourConditions(root: string): string {
    const base = JSON.parse(readFileSync(join(FIXTURE_DATASET, 'conditions', 'dsh-exec.json'), 'utf8')) as Record<string, unknown>
    const homesRoot = join(root, 'homes')
    for (const harness of HARNESSES) {
      writeFileSync(join(root, 'datasets', 'harness-comparison', 'conditions', `${harness.id}.json`), `${JSON.stringify({
        ...base,
        harness: { name: harness.name, version: null, drive: 'exec' },
        // Every model declared null: four harnesses cannot share one, and the
        // subject invariant is not what this test is about.
        model: { declared: null, endpoint: null },
        permissions: harness.permissions,
        env: { keys: [harness.variable] },
        unit: { scopedHome: { container: harness.container, var: harness.variable } },
      }, null, 2)}\n`)
      mkdirSync(join(homesRoot, harness.name), { recursive: true })
      writeFileSync(join(homesRoot, harness.name, 'auth.json'), '{"written by /<harness> login": true}\n')
    }
    return homesRoot
  }

  it('gives four harnesses one class and four unit fingerprints, and records what it left out', async () => {
    const root = makeDatasetTree()
    const homesRoot = writeFourConditions(root)
    const planPath = writePlan(root, { conditions: HARNESSES.map(h => h.id), unit: UNIT_SEGMENT }, 'four')
    const mission = new FakeMission(join(root, 'mission'))
    const lab = new FakeLab(join(root, 'units'), mission)
    const agent = new FakeLocalAgent({
      harnesses: HARNESSES.map(harness => harness.name),
      homesRoot,
      workspaceOf: (container) => {
        const held = [...lab.live.values()].find(unit => unit.info.resource === container)
        return held?.workspace ?? ''
      },
    })
    const report = await runPlan(planPath, {
      parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state'), finalize: true,
    }, { datasets: fakeDatasets(root, { verify: unitProbes() }), mission, localAgent: agent, lab })

    expect(report.cells).toHaveLength(4)
    const classes = new Set(report.cells.map(cell => mission.refsOf(cell.missionId, report.runId).fingerprint))
    // One environment: same image, ceilings, network, user. That is what the
    // report compares, and before this it compared four different units.
    expect(classes.size).toBe(1)
    expect([...classes][0]).toMatch(/^lab-env:[0-9a-f]{64}$/)

    // Cells come back in the seeded order, so each one is matched by the
    // condition it names rather than by position.
    const units = new Map(report.cells.map(cell => [cell.condition,
      orchestratorNs(mission, report.runId, cell.missionId).find(e => e['kind'] === 'unit') as {
        fingerprint: string
        unitFingerprint: string
        envExcluded: { mounts: string[]; envKeys: string[] }
      }]))
    // Four units, still distinct — the class did not paper over a real
    // difference, it named which components the difference is in.
    expect(new Set([...units.values()].map(unit => unit.unitFingerprint)).size).toBe(4)
    for (const harness of HARNESSES) {
      const unit = units.get(harness.id) as NonNullable<ReturnType<typeof units.get>>
      expect(unit.fingerprint).toBe([...classes][0])
      expect(unit.envExcluded.mounts).toEqual([harness.container])
      expect(unit.envExcluded.envKeys).toContain(harness.variable)
      if (harness.name === 'dsh') expect(unit.envExcluded.envKeys).toContain('NODE_OPTIONS')
    }
  })
})

describe('runPlan — one materialization hash for both paths (T20b)', () => {
  function shaOf(root: string, runId: string, missionId: string): string {
    const record = JSON.parse(readFileSync(join(root, 'mission', 'runs', runId, 'data', missionId, 'attempt-1', 'materialization.json'), 'utf8')) as { sha256?: string }
    return record.sha256 as string
  }

  it('hashes the same item at the same commit to the same sha on the host and in a unit', async () => {
    const hostRoot = makeDatasetTree()
    const hostMission = new FakeMission(join(hostRoot, 'mission'))
    const hostReport = await runPlan(writePlan(hostRoot), { parentSessionId: PARENT_SESSION, stateRoot: join(hostRoot, 'state') }, {
      datasets: fakeDatasets(hostRoot), mission: hostMission, localAgent: new FakeLocalAgent(),
    })

    const unitRoot = makeDatasetTree()
    writeUnitCondition(unitRoot)
    const homesRoot = stageScopedHome(unitRoot)
    const unitMission = new FakeMission(join(unitRoot, 'mission'))
    const lab = new FakeLab(join(unitRoot, 'units'), unitMission)
    const agent = new FakeLocalAgent({ homesRoot, workspaceOf: (container) => {
      const held = [...lab.live.values()].find(unit => unit.info.resource === container)
      return held?.workspace ?? ''
    } })
    const unitReport = await runPlan(writePlan(unitRoot, { conditions: ['dsh-unit'], unit: UNIT_SEGMENT }, 'container'), {
      parentSessionId: PARENT_SESSION, stateRoot: join(unitRoot, 'state'),
    }, { datasets: fakeDatasets(unitRoot), mission: unitMission, localAgent: agent, lab })

    const hostSha = shaOf(hostRoot, hostReport.runId, hostReport.cells[0]?.missionId as string)
    const unitSha = shaOf(unitRoot, unitReport.runId, unitReport.cells[0]?.missionId as string)
    expect(hostSha).toMatch(/^[0-9a-f]{64}$/)
    // Same item, same commit, same bytes: one number. Two algorithms made the
    // «题面一致» invariant answerable only within a path.
    expect(unitSha).toBe(hostSha)
  })

  it('keeps lab\'s own hash of what it copied in, under its own name', async () => {
    const root = makeDatasetTree()
    writeUnitCondition(root)
    const homesRoot = stageScopedHome(root)
    const mission = new FakeMission(join(root, 'mission'))
    const lab = new FakeLab(join(root, 'units'), mission)
    const agent = new FakeLocalAgent({ homesRoot, workspaceOf: (container) => {
      const held = [...lab.live.values()].find(unit => unit.info.resource === container)
      return held?.workspace ?? ''
    } })
    const report = await runPlan(writePlan(root, { conditions: ['dsh-unit'], unit: UNIT_SEGMENT }, 'container'), {
      parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state'),
    }, { datasets: fakeDatasets(root), mission, localAgent: agent, lab })

    const attemptDir = join(root, 'mission', 'runs', report.runId, 'data', report.cells[0]?.missionId as string, 'attempt-1')
    const populate = JSON.parse(readFileSync(join(attemptDir, 'populate-manifest.json'), 'utf8')) as { sha: string; count: number }
    expect(populate.sha).toMatch(/^[0-9a-f]{64}$/)
    expect(populate.count).toBeGreaterThan(0)
    // Two records, two claims: what the item is, and what went into the unit.
    expect(populate.sha).not.toBe(shaOf(root, report.runId, report.cells[0]?.missionId as string))
    // …and the workspace still carries no manifest of either kind.
    expect(existsSync(join(attemptDir, 'archive', 'workspace', 'materialization.json'))).toBe(false)
  })
})

describe('runPlan — the judge is probed too (T20c)', () => {
  it('records a judge row in run.meta.readiness beside the players', async () => {
    const root = makeDatasetTree()
    const judgeId = writeJudgeCondition(root)
    const planPath = writeJudgingPlan(root, [judgeId], 2)
    const mission = new FakeMission(join(root, 'mission'))
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root, { grading: new Map([['P0-placeholder/rubric.yml', RUBRIC]]) }), mission, localAgent: new FakeLocalAgent() })

    const roles = report.readiness.map(record => [record.condition, record.role, record.ok])
    expect(roles).toEqual([['dsh-exec', 'player', true], [judgeId, 'judge', true]])
    // …and it is in the ledger, not only in the returned report.
    const meta = mission.runs.get(report.runId)?.meta as { readiness: Array<{ condition: string; role: string }> }
    expect(meta.readiness.filter(record => record.role === 'judge').map(record => record.condition)).toEqual([judgeId])
  })

  it('refuses the whole run when the judge cannot be delegated to', async () => {
    const root = makeDatasetTree()
    const judgeId = writeJudgeCondition(root)
    const planPath = writeJudgingPlan(root, [judgeId], 2)
    const mission = new FakeMission(join(root, 'mission'))
    // Only the judge's probe fails — every player is live. Pilot B ran exactly
    // this and reached `released` with both judge samples dropped and an empty
    // llm-draft namespace; the cost of the failure is the whole round's
    // judging, so it refuses like any other unready condition.
    const localAgent = new FakeLocalAgent({ readinessFailFor: [judgeId] })
    await expect(runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root), mission, localAgent }))
      .rejects.toThrow(/failed the pre-run readiness check/)
    // Nothing was created: the refusal is before the run exists.
    expect(mission.runs.size).toBe(0)
  })

  it('names the judge in the refusal, so the reader knows which half is down', async () => {
    const root = makeDatasetTree()
    const judgeId = writeJudgeCondition(root)
    const planPath = writeJudgingPlan(root, [judgeId], 2)
    const localAgent = new FakeLocalAgent({ readinessFailFor: [judgeId] })
    let refused: unknown
    try {
      await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
        { datasets: fakeDatasets(root), mission: new FakeMission(join(root, 'mission')), localAgent })
    } catch (error) {
      refused = error
    }
    const diagnostics = (refused as { diagnostics: Array<{ code: string; message: string }> }).diagnostics
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.code).toBe('READINESS_FAILED')
    expect(diagnostics[0]?.message).toContain(`judge ${judgeId}`)
  })

  it('--ignore-readiness starts anyway, and skips no cell for a judge that has none', async () => {
    const root = makeDatasetTree()
    const judgeId = writeJudgeCondition(root)
    const planPath = writeJudgingPlan(root, [judgeId], 2)
    const mission = new FakeMission(join(root, 'mission'))
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state'), ignoreReadiness: true },
      { datasets: fakeDatasets(root, { grading: new Map([['P0-placeholder/rubric.yml', RUBRIC]]) }), mission, localAgent: new FakeLocalAgent({ readinessFailFor: [judgeId] }) })
    // The player's cells still run — a failed judge is not a failed player.
    expect(report.cells[0]?.skipped).toBeUndefined()
    expect(report.readiness.find(record => record.role === 'judge')?.ok).toBe(false)
  })
})

describe('runPlan — T30b the declared model is REQUESTED, not only compared', () => {
  it('names the condition\u2019s model on the first round and lets the resume inherit it', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root, {}, 't30b-request')
    const mission = new FakeMission(join(root, 'mission'))
    const localAgent = new FakeLocalAgent({})
    await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root), mission, localAgent })

    const stageStarts = localAgent.calls.filter(c => c.kind === 'start' && c.readiness !== true && c.judge !== true)
    expect(stageStarts.length).toBeGreaterThan(0)
    for (const call of stageStarts) expect(call.model).toBe(DECLARED_MODEL)
    // The resume rounds carry NO model: the family records the first round's
    // request and re-asks for it, and naming one on a resume is refused.
    const resumes = localAgent.calls.filter(c => c.kind === 'resume')
    expect(resumes.length).toBeGreaterThan(0)
    for (const call of resumes) expect('model' in call).toBe(false)
  })

  it('the readiness probe asks for the same model the cells will', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root, {}, 't30b-readiness')
    const mission = new FakeMission(join(root, 'mission'))
    const localAgent = new FakeLocalAgent({})
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root), mission, localAgent })

    const probes = localAgent.calls.filter(c => c.readiness === true)
    expect(probes.length).toBeGreaterThan(0)
    for (const probe of probes) expect(probe.model).toBe(DECLARED_MODEL)
    // …and the record says what it asked for, beside what it read back.
    const readiness = (report.meta as { readiness?: Array<Record<string, unknown>> }).readiness ?? []
    expect(readiness.length).toBeGreaterThan(0)
    for (const record of readiness) expect(record['requestedModel']).toBe(DECLARED_MODEL)
  })

  it('the delegation annotation records what the round requested', async () => {
    const root = makeDatasetTree()
    const planPath = writePlan(root, {}, 't30b-annotation')
    const mission = new FakeMission(join(root, 'mission'))
    const localAgent = new FakeLocalAgent({ readback: { settledModel: DECLARED_MODEL } })
    const report = await runPlan(planPath, { parentSessionId: PARENT_SESSION, stateRoot: join(root, 'state') },
      { datasets: fakeDatasets(root), mission, localAgent })

    const cell = report.cells[0] as { missionId: string }
    const delegations = orchestratorNs(mission, report.runId, cell.missionId).filter(e => e['kind'] === 'delegation')
    expect(delegations.length).toBeGreaterThan(0)
    for (const entry of delegations) expect(entry['requestedModel']).toBe(DECLARED_MODEL)
  })
})
