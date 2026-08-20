/**
 * The service core: the single implementation behind the cordis service face
 * (`ctx.mission`), the model tools, and the CLI. Every write goes through
 * {@link MissionStore.update} (per-run lock, atomic rename), so an in-host
 * call and an out-of-process CLI call writing the same run are safe.
 *
 * Enforcement contract (proposal §2): transitions must be declared by the
 * run's frozen state machine — anything else fails loud; guards execute
 * deterministically; there is no automatic transition anywhere. Retries open
 * a NEW attempt and leave the old one immutable. Writes are idempotent:
 * repeating a call with identical effect is a no-op (transition already in
 * the target state, identical annotation payload, same attestation key,
 * same-name checkpoint, same submission bytes).
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { currentAttempt, viewOf } from './projection.ts'
import { assertSchemaSubset, jsonEquals, validateJson } from './schema.ts'
import { MissionStore, resolveInside } from './store.ts'
import {
  deriveShape, lintTemplate, loadTemplateFile, parseTemplate, resolveSchemaPath, SIMPLE_TEMPLATE,
  type LintResult, type LoadedTemplate,
} from './template.ts'
import type {
  AnnotationRecord, AttemptRecord, AttemptRefs, Guard, MissionRecord, MissionView, RunRecord, TemplateMission,
} from './types.ts'

/** Who performs a call — recorded into history/attestations/annotations. */
export type Caller = string

/** Options accepted by every call. */
export interface CallOptions {
  by?: Caller
  now?: number
}

export interface RunCreateOptions extends CallOptions {
  /** Inline template document (already parsed JSON)… */
  template?: unknown
  /** …or a template JSON file (its directory becomes the schemaPath base). */
  templatePath?: string
  runId?: string
  meta?: Record<string, unknown>
  originSession?: string
}

export interface MissionCreateOptions extends CallOptions {
  runId?: string
  id?: string
  title?: string
  labels?: Record<string, string>
  dependsOn?: string[]
  scheduledAt?: number
  originSession?: string
}

export interface SubmitFile {
  /** Relative path inside the attempt's run-data directory. */
  path: string
  content: string
  encoding?: 'utf8' | 'base64'
}

export interface SubmitOptions extends CallOptions {
  files?: SubmitFile[]
  json?: unknown
  /** Checkpoint name for this submission (default `submit`). Never carries a ref. */
  checkpoint?: string
}

export interface RunSummary {
  id: string
  createdAt: number
  state: RunRecord['state']
  templateName?: string
  originSession?: string
  missions: number
}

export interface RunStatus {
  run: RunSummary & { meta: Record<string, unknown>; releasableStates: string[] }
  rows: MissionView[]
  buckets: Record<string, string[]>
  /** Missions holding `refs.resource` while not releasable — the leak warning. */
  unreleased: string[]
}

export interface TransitionResult {
  changed: boolean
  from: string
  to: string
}

export interface SubmitResult {
  written: string[]
  artifacts: number
  checkpoint: string
}

function newAttempt(attempt: number, initialState: string, now: number): AttemptRecord {
  return {
    attempt,
    state: initialState,
    refs: {},
    enteredAt: { [initialState]: now },
    checkpoints: [],
    history: [],
    artifacts: [],
    attestations: [],
  }
}

function templateMissionToRecord(m: TemplateMission, initialState: string, now: number): MissionRecord {
  const record: MissionRecord = {
    id: m.id,
    labels: m.labels ?? {},
    currentAttempt: 1,
    attempts: [newAttempt(1, initialState, now)],
    annotations: [],
  }
  if (m.title !== undefined) record.title = m.title
  if (m.dependsOn !== undefined) record.dependsOn = m.dependsOn
  if (m.scheduledAt !== undefined) record.scheduledAt = m.scheduledAt
  return record
}

let runSeq = 0

/** Default run id: timestamped plus a per-process sequence/random suffix. */
export function defaultRunId(now: number): string {
  const stamp = new Date(now).toISOString().replace(/[-:T]/g, '').slice(0, 14)
  runSeq += 1
  return `run-${stamp}-${runSeq.toString(36)}${Math.random().toString(36).slice(2, 5)}`
}

/** The implicit run an everyday `create` lands in when no run is named. */
export function implicitRunId(originSession: string | undefined): string {
  if (originSession === undefined || originSession === '') return 'default'
  return `session-${originSession.replace(/[^A-Za-z0-9._-]/g, '-')}`
}

/**
 * The mission service. Construct with a resolved data root; the cordis
 * plugin, the tools, and the CLI each hold one over the SAME root.
 */
export class MissionService {
  readonly store: MissionStore

  constructor(readonly dataDir: string) {
    this.store = new MissionStore(dataDir)
  }

  private now(options: CallOptions | undefined): number {
    return options?.now ?? Date.now()
  }

  private by(options: CallOptions | undefined): Caller {
    return options?.by ?? 'service'
  }

  /** Lint a template file without creating anything (the `run lint` command). */
  lintTemplateFile(templatePath: string): LintResult {
    const loaded = loadTemplateFile(templatePath)
    return lintTemplate(loaded.template, loaded.templateDir)
  }

  private resolveTemplate(options: RunCreateOptions): LoadedTemplate {
    if (options.templatePath !== undefined) return loadTemplateFile(options.templatePath)
    if (options.template !== undefined) return { template: parseTemplate(options.template, '(inline)') }
    throw new Error('mission: runCreate needs a template (inline) or templatePath (file)')
  }

  /**
   * Create a run from a template: the state machine freezes into the run and
   * the template's mission batch materializes. A lint ERROR refuses creation.
   * Re-creating with an identical id + template + meta is an idempotent no-op.
   */
  async runCreate(options: RunCreateOptions): Promise<{ run: RunRecord; existed: boolean; lint: LintResult }> {
    const loaded = this.resolveTemplate(options)
    const lint = lintTemplate(loaded.template, loaded.templateDir)
    if (lint.errors.length > 0) {
      throw new Error(`mission: template failed lint, run not created:\n${lint.errors.map(e => `  - ${e}`).join('\n')}`)
    }
    const now = this.now(options)
    const runId = options.runId ?? defaultRunId(now)
    const meta = options.meta ?? {}
    const created = await this.store.update<{ run: RunRecord; existed: boolean }>(runId, (existing) => {
      if (existing !== null) {
        if (!jsonEquals(existing.stateMachine, loaded.template.stateMachine) || !jsonEquals(existing.meta, meta)) {
          throw new Error(`mission: run ${runId} already exists with a different template or meta`)
        }
        return { run: null, result: { run: existing, existed: true } }
      }
      const initial = deriveShape(loaded.template.stateMachine).initials[0] as string
      const run: RunRecord = {
        id: runId,
        createdAt: now,
        state: 'active',
        meta,
        stateMachine: loaded.template.stateMachine,
        missions: loaded.template.missions.map(m => templateMissionToRecord(m, initial, now)),
      }
      if (options.originSession !== undefined) run.originSession = options.originSession
      if (loaded.template.name !== undefined) run.templateName = loaded.template.name
      if (loaded.templateDir !== undefined) run.templateDir = loaded.templateDir
      return { run, result: { run, existed: false } }
    })
    return { ...created, lint }
  }

  /** Summaries of every run, oldest first. */
  runList(): RunSummary[] {
    return this.store.listRunIds().map((id) => {
      const run = this.store.readRun(id) as RunRecord
      return runSummary(run)
    })
  }

  private requireRun(runId: string): RunRecord {
    const run = this.store.readRun(runId)
    if (run === null) throw new Error(`mission: run ${runId} does not exist`)
    return run
  }

  /**
   * Resolve a mission by id. Without a runId every run is searched: no match
   * is "not found", several is "ambiguous — name the run".
   */
  private locate(missionId: string, runId?: string): { run: RunRecord; mission: MissionRecord } {
    if (runId !== undefined) {
      const run = this.requireRun(runId)
      const mission = run.missions.find(m => m.id === missionId)
      if (mission === undefined) throw new Error(`mission: mission ${missionId} does not exist in run ${runId}`)
      return { run, mission }
    }
    const matches: Array<{ run: RunRecord; mission: MissionRecord }> = []
    for (const id of this.store.listRunIds()) {
      const run = this.store.readRun(id) as RunRecord
      const mission = run.missions.find(m => m.id === missionId)
      if (mission !== undefined) matches.push({ run, mission })
    }
    if (matches.length === 0) throw new Error(`mission: mission ${missionId} does not exist in any run`)
    if (matches.length > 1) {
      throw new Error(`mission: mission ${missionId} exists in several runs (${matches.map(m => m.run.id).join(', ')}) — pass a run id`)
    }
    return matches[0] as { run: RunRecord; mission: MissionRecord }
  }

  /** The projected status of one run: rows in template order plus the five-bucket grouping. */
  runStatus(runId: string, options?: CallOptions): RunStatus {
    const run = this.requireRun(runId)
    const now = this.now(options)
    const rows = run.missions.map(m => viewOf(m, run, now))
    const buckets: Record<string, string[]> = { ready: [], scheduled: [], blocked: [], active: [], done: [] }
    for (const row of rows) (buckets[row.bucket] as string[]).push(row.id)
    return {
      run: { ...runSummary(run), meta: run.meta, releasableStates: run.stateMachine.releasableStates },
      rows,
      buckets,
      unreleased: rows.filter(r => r.resourceHeld).map(r => r.id),
    }
  }

  /**
   * Queue one work item. Without a runId it lands in the implicit run (the
   * session's own, or `default` from the CLI) backed by the built-in `simple`
   * template — zero configuration. An identical re-create (same id, same
   * parameters) is a no-op returning the existing mission.
   */
  async create(options: MissionCreateOptions): Promise<{ run: RunRecord; mission: MissionRecord; existed: boolean }> {
    const now = this.now(options)
    // Ensure the target run exists (implicit runs are created lazily).
    let runId = options.runId
    if (runId === undefined) {
      runId = implicitRunId(options.originSession)
      if (this.store.readRun(runId) === null) {
        await this.runCreate({
          template: SIMPLE_TEMPLATE, runId, meta: {},
          ...(options.originSession !== undefined ? { originSession: options.originSession } : {}),
          by: this.by(options), now,
        })
      }
    } else {
      this.requireRun(runId)
    }
    const targetRunId = runId
    return await this.store.update<{ run: RunRecord; mission: MissionRecord; existed: boolean }>(targetRunId, (existing) => {
      const run = existing as RunRecord
      const id = options.id ?? String(nextMissionNumber(run))
      const found = run.missions.find(m => m.id === id)
      if (found !== undefined) {
        const same = (found.title ?? undefined) === (options.title ?? undefined)
          && jsonEquals(found.labels, options.labels ?? {})
          && jsonEquals(found.dependsOn ?? null, options.dependsOn ?? null)
          && (found.scheduledAt ?? null) === (options.scheduledAt ?? null)
        if (!same) throw new Error(`mission: mission ${id} already exists in run ${targetRunId} with different parameters`)
        return { run: null, result: { run, mission: found, existed: true } }
      }
      for (const dep of options.dependsOn ?? []) {
        if (!run.missions.some(m => m.id === dep)) {
          throw new Error(`mission: dependsOn ${JSON.stringify(dep)} is not a mission of run ${targetRunId}`)
        }
        if (dep === id) throw new Error(`mission: a mission cannot depend on itself (${id})`)
      }
      const initial = deriveShape(run.stateMachine).initials[0] as string
      const mission: MissionRecord = {
        id,
        labels: options.labels ?? {},
        currentAttempt: 1,
        attempts: [newAttempt(1, initial, now)],
        annotations: [],
      }
      if (options.title !== undefined) mission.title = options.title
      if (options.dependsOn !== undefined) mission.dependsOn = options.dependsOn
      if (options.scheduledAt !== undefined) mission.scheduledAt = options.scheduledAt
      run.missions.push(mission)
      return { run, result: { run, mission, existed: false } }
    })
  }

  /** Projected mission rows, optionally filtered by run, bucket, and exact-label match. */
  list(filter?: { runId?: string; bucket?: string; labels?: Record<string, string> }, options?: CallOptions): MissionView[] {
    const now = this.now(options)
    const runIds = filter?.runId !== undefined ? [filter.runId] : this.store.listRunIds()
    const views: MissionView[] = []
    for (const id of runIds) {
      const run = this.requireRun(id)
      for (const mission of run.missions) {
        const view = viewOf(mission, run, now)
        if (filter?.bucket !== undefined && view.bucket !== filter.bucket) continue
        if (filter?.labels !== undefined
          && !Object.entries(filter.labels).every(([k, v]) => view.labels[k] === v)) continue
        views.push(view)
      }
    }
    return views
  }

  /** One mission's full record (attempts, annotations included). */
  get(missionId: string, runId?: string): { run: RunRecord; mission: MissionRecord } {
    return this.locate(missionId, runId)
  }

  /** Execute a declared transition's guard; throws (fails loud) on any violation. */
  private runGuard(guard: Guard, run: RunRecord, mission: MissionRecord, attempt: AttemptRecord): void {
    switch (guard.type) {
      case 'file-check': {
        if (isAbsolute(guard.dir) || guard.dir === '') {
          throw new Error(`mission: file-check dir must be relative, got ${JSON.stringify(guard.dir)}`)
        }
        const base = resolveInside(this.store.attemptDataDir(run.id, mission.id, attempt.attempt), guard.dir, 'file-check dir')
        const missing: string[] = []
        for (const expected of guard.expectedFiles) {
          const target = resolveInside(base, expected, 'file-check expected file')
          if (!existsSync(target)) {
            missing.push(expected)
            continue
          }
          const stat = statSync(target)
          if (expected.endsWith('/') ? !stat.isDirectory() : !stat.isFile()) missing.push(expected)
        }
        if (missing.length > 0) {
          throw new Error(`mission: file-check guard failed for ${mission.id} attempt ${attempt.attempt}: missing under ${guard.dir}/: ${missing.join(', ')}`)
        }
        return
      }
      case 'schema-check': {
        const schemaFile = resolveSchemaPath(guard.schemaPath, run.templateDir)
        let schema: unknown
        try {
          schema = JSON.parse(readFileSync(schemaFile, 'utf8'))
        } catch (error) {
          throw new Error(`mission: schema-check schema unreadable at ${schemaFile}: ${String(error)}`)
        }
        assertSchemaSubset(schema, schemaFile)
        if (guard.inputFrom === 'run-meta') {
          // The run's meta (e.g. a template-required dataset snapshot) — not
          // the submission. mission reads only JSON Schema; the fields are
          // scene data declared by the template.
          const violations = validateJson(schema, run.meta)
          if (violations.length > 0) {
            throw new Error(`mission: schema-check guard (run meta) failed for ${mission.id} attempt ${attempt.attempt}:\n${violations.map(v => `  - ${v}`).join('\n')}`)
          }
          return
        }
        const submission = attempt.submission
        if (submission === undefined || submission.json === undefined) {
          throw new Error(`mission: schema-check guard for ${mission.id} attempt ${attempt.attempt}: no submission recorded (submit first)`)
        }
        const violations = validateJson(schema, submission.json)
        if (violations.length > 0) {
          throw new Error(`mission: schema-check guard failed for ${mission.id} attempt ${attempt.attempt}:\n${violations.map(v => `  - ${v}`).join('\n')}`)
        }
        return
      }
      case 'attested': {
        if (!attempt.attestations.some(a => a.key === guard.key)) {
          throw new Error(`mission: attested guard failed for ${mission.id} attempt ${attempt.attempt}: key ${JSON.stringify(guard.key)} has not been attested`)
        }
        return
      }
    }
  }

  /**
   * Move a mission along a DECLARED edge: undeclared → fail loud; guard
   * failure → the mission stays put. Repeating a transition already in the
   * target state is an idempotent no-op.
   */
  async transition(missionId: string, to: string, options?: CallOptions & { note?: string; runId?: string }): Promise<TransitionResult> {
    const { run } = this.locate(missionId, options?.runId)
    const now = this.now(options)
    return await this.store.update<TransitionResult>(run.id, (stored) => {
      const mission = (stored as RunRecord).missions.find(m => m.id === missionId) as MissionRecord
      const attempt = currentAttempt(mission)
      const from = attempt.state
      if (from === to) return { run: null, result: { changed: false, from, to } }
      const decl = (stored as RunRecord).stateMachine.transitions.find(t => t.from === from && t.to === to)
      if (decl === undefined) {
        throw new Error(`mission: transition ${from} → ${to} is not declared by run ${run.id}'s state machine`)
      }
      if (decl.guard !== undefined) this.runGuard(decl.guard, stored as RunRecord, mission, attempt)
      attempt.state = to
      attempt.enteredAt[to] = now
      const entry: AttemptRecord['history'][number] = { from, to, at: now, by: this.by(options) }
      if (options?.note !== undefined) entry.note = options.note
      attempt.history.push(entry)
      return { run: stored, result: { changed: true, from, to } }
    })
  }

  /**
   * Record a submission: validate the JSON payload against every
   * submission-input schema-check guard leaving the current state FIRST (a
   * failure writes nothing), then append the files into the attempt's
   * run-data directory, index them as artifacts, and register a NO-REF
   * checkpoint (the resource holder's own `addCheckpoint` fills the ref
   * later — same name merges, never duplicates).
   */
  async submit(missionId: string, options: SubmitOptions & { runId?: string }): Promise<SubmitResult> {
    const { run } = this.locate(missionId, options.runId)
    const now = this.now(options)
    return await this.store.update(run.id, (stored) => {
      const storedRun = stored as RunRecord
      const mission = storedRun.missions.find(m => m.id === missionId) as MissionRecord
      const attempt = currentAttempt(mission)
      if (options.json !== undefined) {
        for (const t of storedRun.stateMachine.transitions) {
          // run-meta guards validate the run's meta at transition time — a
          // submission payload is not their input, so submit skips them.
          if (t.from !== attempt.state || t.guard?.type !== 'schema-check' || t.guard.inputFrom === 'run-meta') continue
          const schemaFile = resolveSchemaPath(t.guard.schemaPath, storedRun.templateDir)
          let schema: unknown
          try {
            schema = JSON.parse(readFileSync(schemaFile, 'utf8'))
          } catch (error) {
            throw new Error(`mission: schema-check schema unreadable at ${schemaFile}: ${String(error)}`)
          }
          assertSchemaSubset(schema, schemaFile)
          const violations = validateJson(schema, options.json)
          if (violations.length > 0) {
            throw new Error(`mission: submission for ${missionId} violates the schema of the ${t.from} → ${t.to} guard — nothing was written:\n${violations.map(v => `  - ${v}`).join('\n')}`)
          }
        }
      }
      const written: string[] = []
      for (const file of options.files ?? []) {
        const bytes = file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : Buffer.from(file.content, 'utf8')
        const didWrite = this.store.appendDataFile(storedRun.id, mission.id, attempt.attempt, file.path, bytes)
        if (didWrite) written.push(file.path)
        const existing = attempt.artifacts.find(a => a.path === file.path)
        if (existing === undefined) {
          attempt.artifacts.push({ path: file.path, kind: 'submission', addedAt: now })
        }
      }
      if (options.json !== undefined) {
        attempt.submission = { json: options.json, at: now, by: this.by(options) }
      }
      const checkpointName = options.checkpoint ?? 'submit'
      upsertCheckpoint(attempt, { name: checkpointName, at: now, artifacts: (options.files ?? []).map(f => f.path) })
      return { run: storedRun, result: { written, artifacts: attempt.artifacts.length, checkpoint: checkpointName } }
    })
  }

  /** Append a namespace-isolated annotation. Identical (ns + payload) on the same attempt is a no-op. */
  async annotate(missionId: string, ns: string, payload: unknown, options?: CallOptions & { runId?: string }): Promise<{ added: boolean }> {
    if (ns === '') throw new Error('mission: annotation ns must be non-empty')
    const { run } = this.locate(missionId, options?.runId)
    const now = this.now(options)
    return await this.store.update<{ added: boolean }>(run.id, (stored) => {
      const mission = (stored as RunRecord).missions.find(m => m.id === missionId) as MissionRecord
      const attemptNo = mission.currentAttempt
      const duplicate = mission.annotations.some(a => a.attempt === attemptNo && a.ns === ns && jsonEquals(a.payload, payload))
      if (duplicate) return { run: null, result: { added: false } }
      const annotation: AnnotationRecord = {
        missionId, attempt: attemptNo, ns, payload, createdAt: now, by: this.by(options),
      }
      mission.annotations.push(annotation)
      return { run: stored, result: { added: true } }
    })
  }

  /** Register an `attested`-guard key for the current attempt (same key twice = no-op). */
  async attest(missionId: string, key: string, options?: CallOptions & { note?: string; runId?: string }): Promise<{ added: boolean }> {
    if (key === '') throw new Error('mission: attestation key must be non-empty')
    const { run } = this.locate(missionId, options?.runId)
    const now = this.now(options)
    return await this.store.update<{ added: boolean }>(run.id, (stored) => {
      const mission = (stored as RunRecord).missions.find(m => m.id === missionId) as MissionRecord
      const attempt = currentAttempt(mission)
      if (attempt.attestations.some(a => a.key === key)) return { run: null, result: { added: false } }
      const attestation: AttemptRecord['attestations'][number] = { key, by: this.by(options), at: now }
      if (options?.note !== undefined) attestation.note = options.note
      attempt.attestations.push(attestation)
      return { run: stored, result: { added: true } }
    })
  }

  /**
   * Re-run: open a NEW attempt at the initial state; the old attempts stay
   * immutable (annotations/artifacts/checkpoints carry their attempt number).
   * By nature NOT idempotent — every call is a real new attempt.
   */
  async retry(missionId: string, options?: CallOptions & { runId?: string }): Promise<{ attempt: number }> {
    const { run } = this.locate(missionId, options?.runId)
    const now = this.now(options)
    return await this.store.update(run.id, (stored) => {
      const storedRun = stored as RunRecord
      const mission = storedRun.missions.find(m => m.id === missionId) as MissionRecord
      const initial = deriveShape(storedRun.stateMachine).initials[0] as string
      const next = mission.currentAttempt + 1
      mission.attempts.push(newAttempt(next, initial, now))
      mission.currentAttempt = next
      return { run: storedRun, result: { attempt: next } }
    })
  }

  /** May this mission's held resources be destroyed? (state ∈ releasableStates) */
  isReleasable(missionId: string, runId?: string): boolean {
    const { run, mission } = this.locate(missionId, runId)
    return run.stateMachine.releasableStates.includes(currentAttempt(mission).state)
  }

  /** Write the current attempt's refs: resource handle, environment fingerprint, sessions (unioned). */
  async setRefs(missionId: string, refs: AttemptRefs, options?: CallOptions & { runId?: string }): Promise<void> {
    const { run } = this.locate(missionId, options?.runId)
    await this.store.update(run.id, (stored) => {
      const mission = (stored as RunRecord).missions.find(m => m.id === missionId) as MissionRecord
      const attempt = currentAttempt(mission)
      if (refs.resource !== undefined) attempt.refs.resource = refs.resource
      if (refs.fingerprint !== undefined) attempt.refs.fingerprint = refs.fingerprint
      if (refs.sessions !== undefined) {
        attempt.refs.sessions = [...new Set([...attempt.refs.sessions ?? [], ...refs.sessions])]
      }
      return { run: stored, result: undefined }
    })
  }

  /** Index one artifact of the current attempt (same path again = no-op; conflicting kind fails). */
  async addArtifact(missionId: string, artifact: { path: string; kind: string }, options?: CallOptions & { runId?: string }): Promise<{ added: boolean }> {
    const { run } = this.locate(missionId, options?.runId)
    const now = this.now(options)
    return await this.store.update<{ added: boolean }>(run.id, (stored) => {
      const mission = (stored as RunRecord).missions.find(m => m.id === missionId) as MissionRecord
      const attempt = currentAttempt(mission)
      const existing = attempt.artifacts.find(a => a.path === artifact.path)
      if (existing !== undefined) {
        if (existing.kind !== artifact.kind) {
          throw new Error(`mission: artifact ${artifact.path} is already indexed with kind ${JSON.stringify(existing.kind)}`)
        }
        return { run: null, result: { added: false } }
      }
      attempt.artifacts.push({ path: artifact.path, kind: artifact.kind, addedAt: now })
      return { run: stored, result: { added: true } }
    })
  }

  /**
   * Register a checkpoint. `ref` is filled ONLY by the resource holder; a
   * same-name checkpoint (e.g. `submit`'s ref-less one) MERGES — one moment,
   * one entry, never a duplicate.
   */
  async addCheckpoint(
    missionId: string,
    checkpoint: { name: string; ref?: string; artifacts?: string[] },
    options?: CallOptions & { runId?: string },
  ): Promise<{ added: boolean }> {
    if (checkpoint.name === '') throw new Error('mission: checkpoint name must be non-empty')
    const { run } = this.locate(missionId, options?.runId)
    const now = this.now(options)
    return await this.store.update<{ added: boolean }>(run.id, (stored) => {
      const mission = (stored as RunRecord).missions.find(m => m.id === missionId) as MissionRecord
      const attempt = currentAttempt(mission)
      const added = upsertCheckpoint(attempt, {
        name: checkpoint.name, at: now,
        ...(checkpoint.ref !== undefined ? { ref: checkpoint.ref } : {}),
        ...(checkpoint.artifacts !== undefined ? { artifacts: checkpoint.artifacts } : {}),
      })
      return { run: added ? stored : null, result: { added } }
    })
  }
}

function runSummary(run: RunRecord): RunSummary {
  const summary: RunSummary = { id: run.id, createdAt: run.createdAt, state: run.state, missions: run.missions.length }
  if (run.templateName !== undefined) summary.templateName = run.templateName
  if (run.originSession !== undefined) summary.originSession = run.originSession
  return summary
}

function nextMissionNumber(run: RunRecord): number {
  let max = 0
  for (const m of run.missions) {
    const n = Number(m.id)
    if (Number.isInteger(n) && n > max) max = n
  }
  return max + 1
}

/**
 * Insert or merge a checkpoint on an attempt: same name merges (fills an
 * empty ref, unions artifacts); a conflicting existing ref fails loud.
 * @returns whether the checkpoint list changed.
 */
function upsertCheckpoint(
  attempt: AttemptRecord,
  incoming: { name: string; at: number; ref?: string; artifacts?: string[] },
): boolean {
  const existing = attempt.checkpoints.find(c => c.name === incoming.name)
  if (existing === undefined) {
    const record: AttemptRecord['checkpoints'][number] = {
      name: incoming.name, at: incoming.at, artifacts: [...incoming.artifacts ?? []],
    }
    if (incoming.ref !== undefined) record.ref = incoming.ref
    attempt.checkpoints.push(record)
    return true
  }
  if (incoming.ref !== undefined) {
    if (existing.ref !== undefined && existing.ref !== incoming.ref) {
      throw new Error(`mission: checkpoint ${incoming.name} already carries ref ${JSON.stringify(existing.ref)}`)
    }
    if (existing.ref === undefined) {
      existing.ref = incoming.ref
      existing.artifacts = [...new Set([...existing.artifacts, ...incoming.artifacts ?? []])]
      return true
    }
  }
  const before = existing.artifacts.length
  existing.artifacts = [...new Set([...existing.artifacts, ...incoming.artifacts ?? []])]
  return existing.artifacts.length !== before
}
