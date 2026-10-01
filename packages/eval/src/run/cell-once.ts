/**
 * Running one cell: one attempt end to end (`runCellOnce`) and the
 * infrastructure-retry loop around it (`runCellWithRetry`). Moved verbatim
 * from run.ts (T89).
 */
import { effortEvidence, frozenConfigurationOptions, requireEffortAdmission } from '../frozen-configuration.ts'
import type { DelegationConfiguration } from '../faces.ts'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { DelegationProgress, DelegationResult, DelegationToolCalls, DelegationUsage, DatasetsFace, LabUnitInfo, LocalAgentFace, MissionFace } from '../faces.ts'
import { stageStateName } from '../contract/template.ts'
import { type SuiteManifest } from '../contract/manifest.ts'
import { type EvalCell } from './matrix.ts'
import { awaitObservedModel } from './readback.ts'
import { checkUnitEgress } from './egress.ts'
import { acquireSpecFor, conditionOwnedComponents, environmentClassComponents } from './unit.ts'
import { InfrastructureFailure, SubmissionRejected, MisattributedRun, RunCancelled, sha256, type ResolvedCondition, type JudgeEnv, type CellState, type CellUnitBinding, WORKSPACE_MIRROR, POPULATE_MANIFEST } from './cell-shared.ts'
import { acquireUnit, destroyUnit, salvageUnit } from './unit-lifecycle.ts'
import { judgeCell } from './judge-cell.ts'
import type { RunCellReport } from './run.ts'

export async function runCellOnce(
  faces: { datasets: DatasetsFace; mission: MissionFace; localAgent: LocalAgentFace },
  env: {
    runId: string
    by: string
    now: () => number
    log: (message: string) => void
    cell: EvalCell
    attempt: number
    planStages: string[]
    manifest: SuiteManifest
    datasetRoot: string
    datasetId: string
    commit: string
    repo: string
    cellDirBase: string
    budgetMs: number
    condition: ResolvedCondition
    parentSessionId: string
    finalize: boolean
    readbackWaitMs: number
    judge: JudgeEnv
    /** Set when the plan declares a `unit` segment: this cell runs in a container. */
    unit?: CellUnitBinding
    /** The run's cancellation signal (see {@link RunOptions.signal}). */
    signal?: AbortSignal
    /**
     * Where the acquired unit is published for the retry wrapper. A unit is
     * held by the ATTEMPT, and an attempt that throws must still be able to
     * archive and release it — so the handle has to outlive this frame.
     */
    held?: { unit?: LabUnitInfo }
  },
  state: CellState,
): Promise<RunCellReport> {
  const { datasets, mission, localAgent } = faces
  const missionId = env.cell.missionId

  // Per-cell working directory (decision 3).
  const cellDir = join(env.cellDirBase, missionId, `attempt-${env.attempt}`)
  mkdirSync(cellDir, { recursive: true })

  await mission.transition(missionId, 'ws-ready', { runId: env.runId, by: env.by, note: `attempt ${env.attempt}` })

  // Materialize: the item's visible layer into the cell directory, with a
  // sorted per-file sha256 manifest (the comparability invariant's input).
  const worktree = await datasets.worktreePath({ repo: env.repo }, env.datasetId, { commit: env.commit, layers: ['visible'] })
  const shown = await datasets.show({ repo: env.repo }, env.datasetId, env.cell.labels.task, env.commit)
  const item = shown.items.find(candidate => candidate.id === env.cell.labels.task)
  const visibleFiles = item?.layers['visible'] ?? []
  const materialized: Array<{ path: string; sha256: string }> = []
  for (const rel of visibleFiles) {
    const file = await datasets.read({ repo: env.repo }, { dataset: env.datasetId, item: env.cell.labels.task, layer: 'visible', path: rel, commit: env.commit })
    const bytes = Buffer.from(file.content, 'utf8')
    mkdirSync(dirname(join(cellDir, rel)), { recursive: true })
    writeFileSync(join(cellDir, rel), bytes)
    materialized.push({ path: rel, sha256: sha256(bytes) })
  }
  materialized.sort((a, b) => (a.path < b.path ? -1 : 1))
  // The layout is mission's: ask, never rebuild (T89).
  const attemptDataDir = faces.mission.attemptDataDir(env.runId, missionId, env.attempt)
  mkdirSync(attemptDataDir, { recursive: true })

  // The comparability invariant's input, computed the SAME way on both paths.
  // It has to be: «题面一致» asks whether the cells of one item received the
  // same bytes, and two paths hashing the same bytes by two different rules
  // can only answer that within a path. The number is over the materialized
  // file set, not over the directory, so it does not depend on what else the
  // working directory happens to hold.
  const overall = createHash('sha256')
  for (const file of materialized) {
    overall.update(file.path)
    overall.update('\0')
    overall.update(file.sha256)
    overall.update('\0')
  }
  const materializationText = `${JSON.stringify({
    dataset: env.datasetId,
    task: env.cell.labels.task,
    commit: env.commit,
    layers: ['visible'],
    source: { worktree: worktree.path, reused: worktree.reused },
    files: materialized,
    sha256: overall.digest('hex'),
  }, null, 2)}\n`
  writeFileSync(join(attemptDataDir, 'materialization.json'), materializationText, 'utf8')
  await mission.addArtifact(missionId, { path: 'materialization.json', kind: 'materialization' }, { runId: env.runId, by: env.by })

  let unit: LabUnitInfo | undefined
  if (env.unit === undefined) {
    // The host path also puts the record in the cell directory — that is what
    // the child sees, and it has been there since the loop's first version.
    // The container path deliberately does not: the workspace holds the item's
    // bytes and nothing of the orchestrator's (a host path inside the unit).
    writeFileSync(join(cellDir, 'materialization.json'), materializationText, 'utf8')
  } else {
    // ── Container path, architecture steps 11 and 12. ──────────────────
    // acquire first, then populate: mounts cannot be added to a container
    // that already exists, so everything the unit will ever have is declared
    // once, and the fingerprint that describes it exists before any work does.
    unit = await acquireUnit(
      env.unit.lab,
      acquireSpecFor(env.unit.plan, { missionId, runId: env.runId }),
      `cell ${missionId} could not acquire a unit`,
    )
    if (env.held !== undefined) env.held.unit = unit
    // Between acquire and populate, for the same reason the readiness probe
    // asks before delegating: a unit that cannot reach its endpoints wastes
    // the whole cell and then reports nothing about why. The readiness gate
    // already asked this of a unit of the same class; asking again per cell
    // catches a sidecar that died mid-run, which is exactly how T29c's
    // containers ended up unreachable in the first place.
    if (env.unit.egressCheck !== undefined) {
      await checkUnitEgress(env.unit.lab, unit.id, env.unit.egressCheck, `cell ${missionId}`)
    }
    // The «环境一致» invariant's input, written by the ORCHESTRATOR the moment
    // the unit exists. lab registers the same two refs itself, but that write
    // is best-effort by design (it warns and skips), and an invariant may not
    // rest on a write that is allowed to skip — pilot A's fingerprint column
    // was blank for exactly one run, and the invariant read `unverifiable`
    // for the whole iteration.
    // What «环境一致» compares is the environment the PLAN declared, so the
    // ref carries the environment CLASS: the unit's components minus the ones
    // this condition contributed (its own credential mount, its own env
    // variable). Four harnesses in one run mount four different credential
    // directories under four different variables — comparing unit
    // fingerprints would read `violated` on a run whose environment is, in
    // every sense the comparison cares about, identical.
    const owned = conditionOwnedComponents(env.unit.plan, env.condition.document)
    const klass = unit.fingerprintComponents === undefined
      ? undefined
      : environmentClassComponents(unit.fingerprintComponents, owned)
    const envClass = klass === undefined ? undefined : env.unit.lab.fingerprintOf(klass.components)
    // The unit's OWN fingerprint stays recorded — on the cell's annotation and
    // in lab's archive manifest — because "which environment class" and "which
    // unit" are different questions and a bundle should answer both. It does
    // not go into refs: mission's refs carry `resource`, `fingerprint` and
    // `sessions`, and adding a fourth key is a mission change this task does
    // not own.
    await mission.setRefs(missionId, {
      resource: unit.resource,
      fingerprint: envClass ?? unit.fingerprint,
    }, { runId: env.runId, by: env.by })
    await mission.annotate(missionId, 'orchestrator', {
      kind: 'unit',
      unit: unit.id,
      resource: unit.resource,
      // The class is what refs carries; both are printed so a reader can see
      // the difference rather than infer it.
      fingerprint: envClass ?? unit.fingerprint,
      unitFingerprint: unit.fingerprint,
      ...(klass !== undefined ? { envExcluded: klass.excluded } : {}),
      image: env.unit.plan.image,
      workspace: unit.workspace,
      scopedHome: { container: env.unit.plan.scopedHome.container, var: env.unit.plan.scopedHome.var },
    }, { runId: env.runId, by: env.by }).catch(() => {})
    // lab hashes the tree it copies too. That number is a different claim —
    // "what went into the unit is this" — so it is kept under its own name;
    // `materialization.json` stays the orchestrator's, computed identically
    // on both paths. The workspace holds exactly the item's visible bytes: no
    // manifest, and so no host path, inside the unit.
    const populated = await env.unit.lab.populate(unit.id, { source: cellDir, target: unit.workspace })
    writeFileSync(join(attemptDataDir, POPULATE_MANIFEST), `${JSON.stringify({
      unit: unit.id,
      source: cellDir,
      target: unit.workspace,
      sha: populated.sha,
      count: populated.count,
      files: populated.files,
      note: 'lab populate: what was copied into the unit, hashed by lab\'s own rule. The comparability number is materialization.json.',
    }, null, 2)}\n`, 'utf8')
    await mission.addArtifact(missionId, { path: POPULATE_MANIFEST, kind: 'populate-manifest' }, { runId: env.runId, by: env.by })
    writeFileSync(join(attemptDataDir, WORKSPACE_MIRROR), `${JSON.stringify({
      unit: unit.id,
      resource: unit.resource,
      workspace: unit.workspace,
      hostMirror: cellDir,
      note: 'the workspace is collected here after every stage round; the sealed copy is archive/workspace',
    }, null, 2)}\n`, 'utf8')
    env.log(`cell ${missionId}: unit ${unit.resource} · ${unit.fingerprint.slice(0, 20)}… · ${populated.count} file(s) populated into ${unit.workspace}`)
  }

  // Stage loop: one delegation round per stage (fresh start in round one,
  // resume of the same child afterwards), byte-exact prompts (decision 4).
  // Entering the FIRST stage is the loop's own transition; every later stage
  // is entered by the previous iteration's submit+transition (the template's
  // exit edge), so submissions happen while the mission sits IN the stage
  // state — exactly the semantics the generated machine declares.
  let childSessionId: string | undefined
  let round = 1
  let diverted = false
  for (const [stageIndex, stageId] of env.planStages.entries()) {
    if (stageIndex === 0) {
      await mission.transition(missionId, stageStateName(env.manifest, stageId), { runId: env.runId, by: env.by })
    }

    const promptFile = await datasets.read({ repo: env.repo }, { dataset: env.datasetId, layer: 'visible', path: `prompts/${stageId}.md`, commit: env.commit })
    const taskFile = await datasets.read({ repo: env.repo }, { dataset: env.datasetId, item: env.cell.labels.task, layer: 'visible', path: 'task.md', commit: env.commit })
    const promptBytes = Buffer.concat([
      Buffer.from(promptFile.content, 'utf8'),
      Buffer.from('\n', 'utf8'),
      Buffer.from(taskFile.content, 'utf8'),
    ])
    const promptSha = sha256(promptBytes)
    state.promptShas[stageId] = promptSha

    const remainingMs = env.budgetMs - state.spentMs
    if (remainingMs <= 0) {
      throw new InfrastructureFailure(`stage ${stageId}: the cell's active-minutes budget is exhausted`)
    }
    // A cancel that arrives between rounds stops here, before a new round
    // spawns anything: the cell is left in this stage's state. Read through a
    // call, not a property test: `aborted` is a readonly property, so a
    // control-flow narrowing of it would outlive the abort that flips it.
    const runCancelled = (): boolean => env.signal?.aborted === true
    if (runCancelled()) {
      throw new RunCancelled(`stage ${stageId}: the run was cancelled before the round started`)
    }
    const startedAt = env.now()
    const controller = new AbortController()
    let timedOut = false
    let cancelled = false
    // ONE lever, two pullers: the cell's budget timer and the run's cancel.
    // Both abort the round's signal (which the delegation carries) and cancel
    // the in-flight delegation by child session id — the facade's own
    // cancellation channel. A second, different stop path is exactly what
    // this design refuses to grow.
    const stopRound = (): void => {
      controller.abort()
      if (childSessionId !== undefined) localAgent.cancel(childSessionId)
    }
    const timer = setTimeout(() => {
      timedOut = true
      stopRound()
    }, remainingMs)
    const onRunCancel = (): void => {
      cancelled = true
      stopRound()
    }
    env.signal?.addEventListener('abort', onRunCancel, { once: true })
    const releaseRoundSignal = (): void => { env.signal?.removeEventListener('abort', onRunCancel) }
    // T11 read-back: the settled progress event carries the round's observed
    // model and usage; kept here and merged with delegationOf after settle
    // (either channel may have the value the other missed).
    let admitted: DelegationConfiguration | undefined
    let settled: {
      observedEffort?: string
      observedModel?: string
      cliVersion?: string
      usage?: DelegationUsage
      toolCalls?: DelegationToolCalls
    } | undefined
    // What the record already carried before this round — a later value that
    // differs from it is this round's own observation.
    const priorObserved = childSessionId === undefined
      ? undefined
      : localAgent.delegationOf?.(childSessionId)?.observedModel
    let run: Awaited<ReturnType<LocalAgentFace['start']>>
    try {
      requireEffortAdmission(localAgent, env.condition.provider, env.condition.declaredEffort)
      const delegationOptions = {
        label: `${env.runId}/${missionId} ${stageId}`,
        signal: controller.signal,
        // Inside a unit the host cwd is meaningless, so it is NOT passed: the
        // round runs in the unit's workspace, and the one variable the target
        // carries is the in-container scoped home the provider requires (a
        // host path there would start the CLI in a directory the unit has no
        // copy of — T17 refuses the round rather than let that happen).
        ...(unit === undefined
          ? { cwd: cellDir }
          : {
            exec: {
              container: unit.resource,
              workdir: unit.workspace,
              env: { [(env.unit as CellUnitBinding).plan.scopedHome.var]: (env.unit as CellUnitBinding).plan.scopedHome.container },
            },
          }),
        // Which scoped home the round reads its credentials from — the
        // condition's own, on the host and inside a unit alike. Every round of
        // this cell repeats it, because the family anchors the scope in the
        // delegation record and refuses a resume that names another.
        ...(env.condition.scope === undefined ? {} : { scope: env.condition.scope }),
        onProgress: (event: DelegationProgress) => {
          // Only the settled kind carries the read-back; the round's own
          // event wins over a later record read (last settle = this round).
          if (event.kind !== 'settled') return
          settled = {
            ...event.observedEffort !== undefined ? { observedEffort: event.observedEffort } : {},
            ...event.observedModel !== undefined ? { observedModel: event.observedModel } : {},
            ...event.cliVersion !== undefined ? { cliVersion: event.cliVersion } : {},
            ...event.usage !== undefined ? { usage: event.usage } : {},
            ...event.toolCalls !== undefined ? { toolCalls: event.toolCalls } : {},
          }
        },
      }
      const promptBlocks = [{ type: 'text' as const, text: promptBytes.toString('utf8') }]
      // The declared model is REQUESTED, not merely compared against: the
      // first round names it and the family records it, so every later round
      // of the same cell re-requests exactly that value — which is why
      // `resume` neither takes it nor needs it. A condition that declares no
      // model asks for none and the harness's own configuration decides, the
      // behavior before this option existed.
      run = childSessionId === undefined
        ? await localAgent.start(env.parentSessionId, env.condition.provider, promptBlocks, {
          ...delegationOptions,
          ...frozenConfigurationOptions(env.condition.sha, env.condition.declaredEffort),
          ...(env.condition.declaredModel === null ? {} : { model: env.condition.declaredModel }),
        })
        : await localAgent.resume(env.parentSessionId, env.condition.provider, childSessionId, promptBlocks, delegationOptions)
      admitted = localAgent.runConfiguration?.(run)
    } catch (error) {
      clearTimeout(timer)
      releaseRoundSignal()
      const durationMs = env.now() - startedAt
      state.spentMs += durationMs
      await mission.annotate(missionId, 'orchestrator', {
        kind: 'delegation-failed',
        stage: stageId,
        round,
        ...(childSessionId !== undefined ? { childSessionId } : {}),
        promptSha,
        startedAt,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      }, { runId: env.runId, by: env.by })
      if (cancelled || runCancelled()) {
        throw new RunCancelled(`stage ${stageId}: the run was cancelled while the round was starting`)
      }
      throw new InfrastructureFailure(`stage ${stageId} delegation failed to start: ${error instanceof Error ? error.message : String(error)}`)
    }
    state.childSessionIds.push(run.id)
    childSessionId = run.id
    await mission.setRefs(missionId, { sessions: [run.id] }, { runId: env.runId, by: env.by })

    let result: DelegationResult
    try {
      result = await run.result
    } catch (error) {
      clearTimeout(timer)
      releaseRoundSignal()
      const durationMs = env.now() - startedAt
      state.spentMs += durationMs
      await mission.annotate(missionId, 'orchestrator', {
        kind: 'delegation-failed',
        stage: stageId,
        round,
        childSessionId: run.id,
        promptSha,
        startedAt,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      }, { runId: env.runId, by: env.by })
      throw new InfrastructureFailure(`stage ${stageId} delegation faulted: ${error instanceof Error ? error.message : String(error)}`)
    }
    const durationMs = env.now() - startedAt
    state.spentMs += durationMs
    clearTimeout(timer)
    releaseRoundSignal()
    // The read-back after settle: this round's own settled event wins; else
    // the delegation record, waited for because the provider merges it a beat
    // after the result resolves. A facade that delivers neither leaves null —
    // absence is recorded, never guessed. `usage` rides the settled event
    // only: a facade that clears the tracked run before its settle pass
    // records no usage here, and null is the honest answer.
    const observedModel = settled?.observedModel
      ?? await awaitObservedModel(localAgent, run.id, priorObserved, env.readbackWaitMs)
    const reasoning = effortEvidence(env.condition.declaredEffort, admitted, settled?.observedEffort ?? result.observedEffort)
    const usage = settled?.usage ?? null
    // `usage` stays an explicit null (its shape predates this field and the
    // report reads the key), but the two newer facts are OMITTED when the
    // round did not report them: absence is what "the harness counted none"
    // has to look like, and a zero would read as a round that used no tools.
    await mission.annotate(missionId, 'orchestrator', {
      kind: 'delegation',
      stage: stageId,
      round,
      childSessionId: run.id,
      promptSha,
      startedAt,
      durationMs,
      usage,
      ...settled?.toolCalls !== undefined ? { toolCalls: settled.toolCalls } : {},
      ...settled?.cliVersion !== undefined ? { cliVersion: settled.cliVersion } : {},
      // `requested` is what the round ASKED the harness for — the declared
      // model when the condition names one. It is the same value as
      // `declared` by construction today, and recorded separately because the
      // two answer different questions: what the condition claims, and what
      // this round actually put on the CLI's command line.
      requestedModel: env.condition.declaredModel,
      model: { declared: env.condition.declaredModel, observed: observedModel },
      reasoning,
      ...(admitted === undefined ? {} : { configuration: admitted }),
    }, { runId: env.runId, by: env.by })
    // The cancel is checked FIRST: when both fired, the run was cancelled
    // during the round's last budgeted second, and "the operator stopped it"
    // is the truer sentence than "it ran out of budget" — and the one that
    // decides whether the cell is retried.
    if (cancelled) {
      throw new RunCancelled(`stage ${stageId} delegation cancelled with the run (${run.id})`)
    }
    if (timedOut) {
      throw new InfrastructureFailure(`stage ${stageId} delegation exceeded the cell's ${Math.round(env.budgetMs / 60_000)}min active budget — cancelled (${run.id})`)
    }
    if (result.stopReason !== 'completed') {
      throw new InfrastructureFailure(`stage ${stageId} delegation ended with stopReason ${JSON.stringify(result.stopReason)}${result.diagnostic !== undefined ? `: ${result.diagnostic}` : ''}`)
    }
    // Declared ≠ observed is fail loud (frozen decision 5): the run is
    // misattributed and must not quietly continue. The annotation above
    // carries the mismatch for the report.
    if (reasoning.status === 'mismatch') throw new MisattributedRun(`condition ${env.condition.id}: frozen reasoning effort does not match admitted/observed configuration — this sample is not comparable`)
    if (observedModel !== null && env.condition.declaredModel !== null && observedModel !== env.condition.declaredModel) {
      throw new MisattributedRun(
        `condition ${env.condition.id} declares model ${JSON.stringify(env.condition.declaredModel)} but the delegation ran ${JSON.stringify(observedModel)} (child ${run.id}, stage ${stageId}) — the run is misattributed`,
      )
    }

    // Architecture step 14, then 15: tag the return point inside the unit,
    // bring the workspace back to the host, and only then read, validate and
    // submit. The checkpoint's ref reaches mission through lab.
    if (unit !== undefined) {
      const lab = (env.unit as CellUnitBinding).lab
      const checkpoint = await lab.checkpoint(unit.id, { name: stageId })
      await lab.collect(unit.id, {
        source: unit.workspace,
        target: cellDir,
        kind: 'workspace-mirror',
        artifactPath: WORKSPACE_MIRROR,
      })
      env.log(`cell ${missionId}: ${stageId} checkpointed at ${checkpoint.ref.slice(0, 12)} and mirrored to the host`)
    }

    // Collect the stage outputs from the cell directory (decision 7).
    const jsonPath = join(cellDir, `${stageId}.json`)
    const mdPath = join(cellDir, `${stageId}.md`)
    const missing: string[] = []
    if (!existsSync(jsonPath)) {
      missing.push(unit === undefined
        ? `${stageId}.json missing from the cell directory (a facade without the cwd option runs the child in the parent session cwd — the file would land there)`
        : `${stageId}.json missing from the unit's workspace (${unit.workspace}) after collect — the round wrote it somewhere else, or wrote nothing`)
    }
    if (!existsSync(mdPath)) missing.push(`${stageId}.md missing from the cell directory`)
    if (missing.length > 0) throw new SubmissionRejected(stageId, missing)
    const jsonText = readFileSync(jsonPath, 'utf8')
    let json: unknown
    try {
      json = JSON.parse(jsonText)
    } catch (error) {
      throw new SubmissionRejected(stageId, [`${stageId}.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`])
    }
    const mdText = readFileSync(mdPath, 'utf8')

    // The halt check (decision 7): the manifest's halt_on diverts the edge.
    const stageDecl = env.manifest.stages.find(stage => stage.id === stageId)
    const haltOn = stageDecl?.halt_on
    const nextStageId = env.planStages[stageIndex + 1]
    const halted = haltOn !== undefined && (json as Record<string, unknown>)[haltOn.field] === haltOn.equals
    const target = halted
      ? 'halted'
      : nextStageId === undefined
        ? 'judged'
        : stageStateName(env.manifest, nextStageId)
    if (halted) diverted = true

    try {
      await mission.submit(missionId, {
        runId: env.runId,
        by: env.by,
        to: target,
        json,
        files: [
          { path: `${stageId}.json`, content: jsonText },
          { path: `${stageId}.md`, content: mdText },
        ],
      })
    } catch (error) {
      // Schema violations are not retried (decision 7): submit writes
      // nothing on a refused payload; the cell stays in its current state.
      throw new SubmissionRejected(stageId, [error instanceof Error ? error.message : String(error)])
    }
    try {
      await mission.transition(missionId, target, { runId: env.runId, by: env.by })
    } catch (error) {
      throw new SubmissionRejected(stageId, [`transition to ${target} refused: ${error instanceof Error ? error.message : String(error)}`])
    }
    round += 1
    if (halted || nextStageId === undefined) break
  }

  // Judge, then archive. The order is forced by the gate: `verdicts/` must be
  // non-empty to leave `archived`, so the two mechanical sources run here,
  // before the workspace copy (architecture steps 16 and 19).
  const current = mission.get(missionId, env.runId)
  const archiveDir = join(faces.mission.attemptDataDir(env.runId, missionId, current.mission.currentAttempt), 'archive')
  mkdirSync(join(archiveDir, 'verdicts'), { recursive: true })
  const verdictCounts = await judgeCell(faces, {
    runId: env.runId,
    by: env.by,
    now: env.now,
    log: env.log,
    missionId,
    taskId: env.cell.labels.task,
    datasetId: env.datasetId,
    commit: env.commit,
    repo: env.repo,
    cellDir,
    archiveDir,
    attemptDataDir,
    attempt: current.mission.currentAttempt,
    parentSessionId: env.parentSessionId,
    condition: { id: env.condition.id, declaredModel: env.condition.declaredModel },
    planStages: env.planStages,
    judge: env.judge,
    ...(unit !== undefined ? { unit: { lab: (env.unit as CellUnitBinding).lab, unitId: unit.id } } : {}),
  })
  if (unit === undefined) {
    cpSync(cellDir, join(archiveDir, 'workspace'), { recursive: true })
    await mission.addArtifact(missionId, { path: 'archive', kind: 'archive' }, { runId: env.runId, by: env.by })
  } else {
    // lab exports the workspace AND the integrity manifest, and registers the
    // artifact itself. `verdicts/` is already beside it: the judging phase ran
    // first, because the archive gate refuses an empty one.
    await (env.unit as CellUnitBinding).lab.archive(unit.id, { target: archiveDir, kind: 'archive', artifactPath: 'archive' })
  }
  await mission.transition(missionId, 'archived', { runId: env.runId, by: env.by })

  const destroy = async (why: string): Promise<void> => {
    if (unit === undefined) return
    await destroyUnit(
      { lab: (env.unit as CellUnitBinding).lab, mission },
      { runId: env.runId, by: env.by, log: env.log, missionId },
      unit,
      why,
    )
    unit = undefined
    if (env.held !== undefined) delete env.held.unit
  }

  if (env.finalize) {
    try {
      await mission.transition(missionId, 'releasable', { runId: env.runId, by: env.by })
      // The gate has just said yes, and `releasable` is the ONLY state it says
      // yes in — `isReleasable` reads the current state against the template's
      // releasableStates. So the unit dies HERE, between the two transitions,
      // which is also the order architecture step 17 spells out: archive →
      // pass the gate → release. Destroying after `released` would ask the
      // gate a question it answers no to, and every container would survive.
      await destroy('the cell passed the archive gate')
      await mission.transition(missionId, 'released', { runId: env.runId, by: env.by })
    } catch (error) {
      // The archive gate refused (an empty verdicts/ — no probes and no judge
      // produced anything): the cell stays at archived and the refusal is
      // recorded, not bypassed.
      await mission.annotate(missionId, 'orchestrator', {
        kind: 'finalize-refused',
        error: error instanceof Error ? error.message : String(error),
      }, { runId: env.runId, by: env.by }).catch(() => {})
    }
  }
  // A cell that did not pass the gate — no --finalize, or a refused one —
  // still asks, and is still refused, and its container STAYS. That is the
  // correct answer for a cell nobody has looked at yet, and the reason there
  // is no force on this path.
  await destroy('the cell finished without passing the archive gate')

  const finalRecord = mission.get(missionId, env.runId)
  const finalAttempt = finalRecord.mission.attempts[finalRecord.mission.currentAttempt - 1]
  return {
    missionId,
    task: env.cell.labels.task,
    condition: env.cell.labels.condition,
    rep: Number(env.cell.labels.rep),
    attempts: finalRecord.mission.currentAttempt,
    finalState: finalAttempt?.state ?? 'unknown',
    childSessionIds: state.childSessionIds,
    promptShas: state.promptShas,
    activeMs: state.spentMs,
    verdicts: { script: verdictCounts.script, llmDraft: verdictCounts.llmDraft },
    ...(diverted ? { halted: true } : {}),
  }
}

/** Run one cell with the infrastructure-retry policy (decision 8). */
export async function runCellWithRetry(
  faces: { datasets: DatasetsFace; mission: MissionFace; localAgent: LocalAgentFace },
  env: {
    runId: string
    by: string
    now: () => number
    log: (message: string) => void
    cell: EvalCell
    retryLimit: number
    planStages: string[]
    manifest: SuiteManifest
    datasetRoot: string
    datasetId: string
    commit: string
    repo: string
    cellDirBase: string
    budgetMs: number
    condition: ResolvedCondition
    parentSessionId: string
    finalize: boolean
    readbackWaitMs: number
    judge: JudgeEnv
    unit?: CellUnitBinding
    /** The run's cancellation signal (see {@link RunOptions.signal}). */
    signal?: AbortSignal
  },
): Promise<RunCellReport> {
  const { mission } = faces
  const state: CellState = { childSessionIds: [], promptShas: {}, spentMs: 0 }
  for (;;) {
    const current = mission.get(env.cell.missionId, env.runId)
    const attempt = current.mission.currentAttempt
    const held: { unit?: LabUnitInfo } = {}
    try {
      return await runCellOnce(faces, { ...env, attempt, held }, state)
    } catch (error) {
      // Whatever went wrong, the unit is salvaged before anything else is
      // decided: the retry below opens a NEW attempt and acquires a NEW unit,
      // and a held container that nobody archived is both a lost crash scene
      // and one step closer to the concurrency ceiling.
      if (held.unit !== undefined && env.unit !== undefined) {
        await salvageUnit(
          { lab: env.unit.lab, mission },
          { runId: env.runId, by: env.by, log: env.log, missionId: env.cell.missionId },
          held.unit,
          {
            cellDir: join(env.cellDirBase, env.cell.missionId, `attempt-${attempt}`),
            archiveDir: join(mission.attemptDataDir(env.runId, env.cell.missionId, attempt), 'archive'),
          },
        )
        delete held.unit
      }
      if (error instanceof RunCancelled) {
        // Recorded, then left alone. No retry (the operator stopped this run),
        // no transition (the cell's state IS the evidence of where it got to),
        // and the annotation is what a reader — and `finalize`'s
        // `interrupted` bucket — sees afterwards.
        const reason = error.message
        await mission.annotate(env.cell.missionId, 'orchestrator', {
          kind: 'cell-cancelled',
          reason,
          attempts: attempt,
        }, { runId: env.runId, by: env.by }).catch(() => {})
        env.log(`cell ${env.cell.missionId}: cancelled — ${reason}`)
        const after = mission.get(env.cell.missionId, env.runId)
        const attemptRecord = after.mission.attempts[after.mission.currentAttempt - 1]
        return {
          missionId: env.cell.missionId,
          task: env.cell.labels.task,
          condition: env.cell.labels.condition,
          rep: Number(env.cell.labels.rep),
          attempts: after.mission.currentAttempt,
          finalState: attemptRecord?.state ?? 'unknown',
          childSessionIds: state.childSessionIds,
          promptShas: state.promptShas,
          activeMs: state.spentMs,
          cancelled: { reason },
        }
      }
      if (error instanceof SubmissionRejected) {
        await mission.annotate(env.cell.missionId, 'orchestrator', {
          kind: 'submission-rejected',
          stage: error.stage,
          violations: error.violations,
        }, { runId: env.runId, by: env.by }).catch(() => {})
        const after = mission.get(env.cell.missionId, env.runId)
        const attemptRecord = after.mission.attempts[after.mission.currentAttempt - 1]
        env.log(`cell ${env.cell.missionId}: submission rejected — the cell stops in ${attemptRecord?.state ?? 'its current state'}`)
        return {
          missionId: env.cell.missionId,
          task: env.cell.labels.task,
          condition: env.cell.labels.condition,
          rep: Number(env.cell.labels.rep),
          attempts: after.mission.currentAttempt,
          finalState: attemptRecord?.state ?? 'unknown',
          childSessionIds: state.childSessionIds,
          promptShas: state.promptShas,
          activeMs: state.spentMs,
          rejected: { stage: error.stage, violations: error.violations },
        }
      }
      if (!(error instanceof InfrastructureFailure)) throw error
      const reason = error.message
      if (current.mission.currentAttempt - 1 >= env.retryLimit) {
        await mission.annotate(env.cell.missionId, 'orchestrator', {
          kind: 'cell-skipped',
          reason,
          attempts: current.mission.currentAttempt,
        }, { runId: env.runId, by: env.by }).catch(() => {})
        env.log(`cell ${env.cell.missionId}: infrastructure budget exhausted — skipped (${reason})`)
        const attemptRecord = current.mission.attempts[current.mission.currentAttempt - 1]
        return {
          missionId: env.cell.missionId,
          task: env.cell.labels.task,
          condition: env.cell.labels.condition,
          rep: Number(env.cell.labels.rep),
          attempts: current.mission.currentAttempt,
          finalState: attemptRecord?.state ?? 'unknown',
          childSessionIds: state.childSessionIds,
          promptShas: state.promptShas,
          activeMs: state.spentMs,
          skipped: { reason },
        }
      }
      env.log(`cell ${env.cell.missionId}: infrastructure failure — ${reason}; retrying`)
      await mission.retry(env.cell.missionId, { runId: env.runId, reason, category: 'infrastructure', by: env.by })
    }
  }
}
