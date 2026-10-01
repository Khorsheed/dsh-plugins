/**
 * Judging one cell: probes (script ns) and the blind LLM judge samples
 * (llm-draft ns), written so the archive gate's `verdicts/` check can pass.
 * Moved verbatim from run.ts (T89).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatasetsFace, LabFace, LocalAgentFace, MissionFace } from '../faces.ts'
import { deidentify, judgedCriteria, mergeReplacements, pickRubricPath, runJudgeSamples, runProbes, JUDGE_MATERIAL_FILES, type ReplacementCount, type RubricCriterion } from '../judge/judge.ts'
import { hostProbeExecutor, unitProbeExecutor, type ProbeExecutor } from './probe-exec.ts'
import { type JudgeEnv, PROBE_VERDICTS } from './cell-shared.ts'

/**
 * The judging phase of one cell (architecture steps 16 and 19), run once the
 * stage loop has parked the cell in its terminal stage state and BEFORE the
 * archive copy — the verdicts are part of what gets archived, and the archive
 * gate refuses an empty `verdicts/`.
 *
 * Two sources, both mechanical, both honest about absence: an item with no
 * probes writes no `script.json`, and a run with no judge conditions (or a
 * rubric with no `llm-draft` rows) writes no `llm-draft-*.json`. Nothing here
 * throws: a judging failure must not undo a cell that actually ran — it is
 * recorded in the orchestrator ns and the cell archives with fewer verdicts.
 * @returns how many verdicts each source contributed.
 */
export async function judgeCell(
  faces: { datasets: DatasetsFace; mission: MissionFace; localAgent: LocalAgentFace },
  env: {
    runId: string
    by: string
    now: () => number
    log: (message: string) => void
    missionId: string
    taskId: string
    datasetId: string
    commit: string
    repo: string
    cellDir: string
    archiveDir: string
    attemptDataDir: string
    attempt: number
    parentSessionId: string
    /** The cell's own condition — the judging side needs it to mark a self-judged sample. */
    condition: { id: string; declaredModel: string | null }
    /** The plan's `stages`: the judge is asked only the llm-draft criteria in that scope (T84). */
    planStages: readonly string[]
    judge: JudgeEnv
    /** Set on the container path: the probes run inside this cell's unit. */
    unit?: { lab: LabFace; unitId: string }
  },
): Promise<{ script: number; llmDraft: number }> {
  const verdictsDir = join(env.archiveDir, 'verdicts')
  const counts = { script: 0, llmDraft: 0 }

  // The grading layer is read with an EXPLICIT single-layer scope and never
  // reaches the cell: this listing is how both sources find the rubric.
  let rubricPath: string | null = null
  let runIn: string[] | null = null
  try {
    const graded = await faces.datasets.show({ repo: env.repo, layers: ['grading'] }, env.datasetId, env.taskId, env.commit)
    const gradedItem = graded.items.find(item => item.id === env.taskId)
    rubricPath = pickRubricPath(gradedItem?.layers['grading'] ?? [])
    const meta = gradedItem?.metadata
    if (typeof meta === 'object' && meta !== null && Array.isArray((meta as Record<string, unknown>)['runIn'])) {
      runIn = ((meta as Record<string, unknown>)['runIn'] as unknown[]).filter((s): s is string => typeof s === 'string')
    }
  } catch (error) {
    await faces.mission.annotate(env.missionId, 'orchestrator', {
      kind: 'judge-skipped',
      reason: `the grading layer could not be listed: ${error instanceof Error ? error.message : String(error)}`,
    }, { runId: env.runId, by: env.by }).catch(() => {})
  }

  // ── script ns: the item's probes (protocol §6.7). ─────────────────────
  // Same contract either side of the seam: the executor decides only WHERE
  // the process runs. On the container path it runs in the cell's own unit,
  // against `/workspace`, writing its verdicts outside the workspace so the
  // archive stays the player's work.
  const probeDir = join(env.judge.probeDirBase, env.missionId, `attempt-${env.attempt}`)
  const executor: ProbeExecutor = env.unit === undefined
    ? hostProbeExecutor({ probeDir, cellDir: env.cellDir })
    : unitProbeExecutor({
      lab: env.unit.lab,
      unitId: env.unit.unitId,
      probeDir,
      collectDir: join(env.attemptDataDir, PROBE_VERDICTS),
      artifactPath: PROBE_VERDICTS,
    })
  try {
    const probed = await runProbes({
      datasets: faces.datasets,
      repo: env.repo,
      datasetId: env.datasetId,
      taskId: env.taskId,
      commit: env.commit,
      cellDir: env.cellDir,
      probeDir,
      rubricPath,
      timeoutMs: env.judge.probeTimeoutMs,
      executor,
    })
    if (probed.outcomes.length > 0) {
      await faces.mission.annotate(env.missionId, 'orchestrator', {
        kind: 'probes',
        where: probed.where,
        probes: probed.outcomes.map(outcome => ({
          probe: outcome.probe,
          origin: outcome.origin,
          exitCode: outcome.exitCode,
          outcome: outcome.outcome,
          ok: outcome.ok,
          verdicts: outcome.verdicts.length,
          durationMs: outcome.durationMs,
          ...(outcome.error !== undefined ? { error: outcome.error } : {}),
          ...(outcome.reason !== undefined ? { reason: outcome.reason } : {}),
          ...(outcome.overwritten !== undefined ? { overwritten: outcome.overwritten } : {}),
          ...(outcome.dropped !== undefined ? { dropped: outcome.dropped } : {}),
        })),
      }, { runId: env.runId, by: env.by }).catch(() => {})
    }
    if (probed.verdicts.length > 0) {
      writeFileSync(join(verdictsDir, 'script.json'), `${JSON.stringify(probed.verdicts, null, 2)}\n`, 'utf8')
      await faces.mission.annotate(env.missionId, 'script', probed.verdicts, { runId: env.runId, by: env.by })
      counts.script = probed.verdicts.length
    }
    if (probed.outcomes.length > 0) {
      // The three states are counted separately on purpose: a cell that reads
      // "2 not applicable this round" knows two criteria went unanswered for
      // want of input, where the old "2/4 probe(s)" read as two broken probes.
      // The line is printed even with no verdicts at all — an all-skipped cell
      // is exactly the case the old counting made invisible.
      const skipped = probed.outcomes.filter(outcome => outcome.outcome === 'probe-skipped').length
      const failed = probed.outcomes.filter(outcome => outcome.outcome === 'probe-failed').length
      env.log(`cell ${env.missionId}: ${probed.verdicts.length} script verdict(s) from ${probed.outcomes.filter(o => o.ok).length}/${probed.outcomes.length} probe(s)`
        + `${failed > 0 ? `, ${failed} failed` : ''}${skipped > 0 ? `, ${skipped} not applicable this round` : ''}`)
    }
  } catch (error) {
    await faces.mission.annotate(env.missionId, 'orchestrator', {
      kind: 'probes-failed',
      error: error instanceof Error ? error.message : String(error),
    }, { runId: env.runId, by: env.by }).catch(() => {})
    env.log(`cell ${env.missionId}: probes failed — ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    // The verify layer is the answer key: it does not outlive its use, on the
    // host OR inside the unit (architecture §4).
    await executor.discard()
  }

  // ── llm-draft ns: the blind judging (decision 9). ─────────────────────
  if (env.judge.judges.length === 0 || env.judge.samples < 1) return counts
  if (rubricPath === null) {
    await faces.mission.annotate(env.missionId, 'orchestrator', {
      kind: 'judge-skipped',
      reason: `item ${env.taskId} ships no rubric in its grading layer — nothing to judge against`,
    }, { runId: env.runId, by: env.by }).catch(() => {})
    return counts
  }
  let criteria: RubricCriterion[]
  try {
    const rubric = await faces.datasets.read({ repo: env.repo, layers: ['grading'] }, {
      dataset: env.datasetId, item: env.taskId, layer: 'grading', path: rubricPath, commit: env.commit,
    })
    const judged = judgedCriteria(rubric.content, { task: env.taskId, runIn, planStages: env.planStages })
    criteria = judged.criteria
    if (judged.outOfScope.length > 0) {
      env.log(`cell ${env.missionId}: ${judged.outOfScope.length} llm-draft criterion(s) outside the plan's stages are not put to the judge (${judged.outOfScope.join(', ')})`)
    }
  } catch (error) {
    await faces.mission.annotate(env.missionId, 'orchestrator', {
      kind: 'judge-skipped',
      reason: `the rubric ${rubricPath} could not be read or parsed: ${error instanceof Error ? error.message : String(error)}`,
    }, { runId: env.runId, by: env.by }).catch(() => {})
    return counts
  }
  if (criteria.length === 0) {
    await faces.mission.annotate(env.missionId, 'orchestrator', {
      kind: 'judge-skipped',
      reason: `rubric ${rubricPath} declares no kind: llm-draft criteria inside the plan's stages — the LLM judge has nothing to answer`,
    }, { runId: env.runId, by: env.by }).catch(() => {})
    return counts
  }

  // De-fingerprint the material. The ORIGINALS stay untouched in the cell;
  // the judge only ever sees these copies (decision 9).
  const materials: Array<{ path: string; text: string }> = []
  const tables: ReplacementCount[][] = []
  for (const rel of JUDGE_MATERIAL_FILES) {
    const source = join(env.cellDir, rel)
    if (!existsSync(source)) continue
    const cleaned = deidentify(readFileSync(source, 'utf8'), env.judge.rules)
    materials.push({ path: rel, text: cleaned.text })
    tables.push(cleaned.replacements)
  }
  if (materials.length === 0) {
    await faces.mission.annotate(env.missionId, 'orchestrator', {
      kind: 'judge-skipped',
      reason: 'the cell produced none of the judged material files',
    }, { runId: env.runId, by: env.by }).catch(() => {})
    return counts
  }
  const table = mergeReplacements(tables)
  await faces.mission.annotate(env.missionId, 'orchestrator', {
    kind: 'deidentify',
    files: materials.map(material => material.path),
    table,
    total: table.reduce((sum, row) => sum + row.count, 0),
  }, { runId: env.runId, by: env.by }).catch(() => {})

  const judged = await runJudgeSamples({
    localAgent: faces.localAgent,
    mission: faces.mission,
    missionId: env.missionId,
    runId: env.runId,
    by: env.by,
    now: env.now,
    taskId: env.taskId,
    parentSessionId: env.parentSessionId,
    cell: { condition: env.condition.id, declaredModel: env.condition.declaredModel },
    judges: env.judge.judges,
    samples: env.judge.samples,
    criteria,
    materials,
    judgeDirBase: join(env.judge.judgeDirBase, env.missionId, `attempt-${env.attempt}`),
    log: env.log,
  })
  for (const record of judged.records) {
    // One annotation per SAMPLE, carrying the sample's provenance around its
    // verdicts — the report unwraps the envelope and counts the samples.
    await faces.mission.annotate(env.missionId, 'llm-draft', {
      sample: record.sample,
      judgeCondition: record.judgeCondition,
      judgeSha: record.judgeSha,
      // Who judged, in the two words a reader needs: the condition id and the
      // model. Decision 9 stopped forbidding the overlap, so the report has to
      // be able to SAY which cells a model judged — including its own.
      judgeModel: record.judgeModel,
      selfJudged: record.selfJudged,
      promptSha: record.promptSha,
      verdicts: record.verdicts,
    }, { runId: env.runId, by: env.by })
    writeFileSync(
      join(verdictsDir, `llm-draft-${record.judgeCondition}-${record.sample}.json`),
      `${JSON.stringify(record.verdicts, null, 2)}\n`,
      'utf8',
    )
    counts.llmDraft += record.verdicts.length
  }
  env.log(`cell ${env.missionId}: ${judged.records.length}/${env.judge.judges.length * env.judge.samples} judge sample(s) landed${judged.failures.length > 0 ? `, ${judged.failures.length} dropped` : ''}`)
  return counts
}

/** One attempt's execution of one cell (materialize → delegate → submit → judge → archive). */
