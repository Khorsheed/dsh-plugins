/**
 * The unit lifecycle of one cell on the container path: acquire (with the
 * holders named when lab's ceiling refuses), destroy through the release
 * gate, and salvage after a failure. Moved verbatim from run.ts (T89).
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { LabAcquireSpec, LabFace, LabUnitInfo, MissionFace } from '../faces.ts'
import { WORKSPACE_MIRROR } from './cell-shared.ts'

/**
 * Lab's held units, written out as the sentence a blocked acquire needs:
 * WHICH runs are holding the ceiling and which unit each one holds.
 *
 * lab's own refusal is correct and says nothing actionable — "release a unit
 * first" leaves the reader to `docker ps`, guess which container belongs to
 * which run, and find out the hard way that a stranger's run owns three of
 * them. The list is the orchestrator's to add, not lab's: lab does not know
 * what a run is, and giving it the vocabulary to say so would be the wrong
 * half of the boundary to move.
 *
 * Never throws: this runs on a path that is ALREADY failing, and a second
 * failure here would replace a useful refusal with a useless one.
 * @param lab - the lab face to ask.
 * @returns one line naming the holders, or why they could not be named.
 */
export async function describeUnitHolders(lab: LabFace): Promise<string> {
  let rows: Awaited<ReturnType<LabFace['status']>>
  try {
    rows = await lab.status()
  } catch (error) {
    return `the units holding it could not be listed: ${error instanceof Error ? error.message : String(error)}`
  }
  if (rows.length === 0) {
    return 'lab reports no held unit, so whatever holds the ceiling was not acquired through this face'
  }
  const byRun = new Map<string, string[]>()
  for (const row of rows) {
    const key = row.runId ?? ''
    const cell = row.missionId === undefined ? '' : `, cell ${row.missionId}`
    const entry = `${row.id} (${row.resource}${cell})`
    const held = byRun.get(key)
    if (held === undefined) byRun.set(key, [entry])
    else held.push(entry)
  }
  const groups = [...byRun].map(([runId, held]) =>
    `${runId === '' ? 'no run recorded' : `run ${runId}`}: ${held.join(', ')}`)
  return `the ${rows.length} unit(s) holding it — ${groups.join('; ')}.`
    + ' Release a run\'s units with `/eval finalize <runId>` (the report page\'s 回收 button walks the same gate);'
    + ' a unit no mission gates needs `dsh-lab release <unit> --force`, which is a human\'s call.'
}

/**
 * `lab.acquire`, with the one refusal a container run actually meets made
 * actionable. Everything else is re-thrown untouched — a missing image and a
 * dead daemon are not improved by a list of containers.
 * @param lab - the lab face.
 * @param spec - the acquire spec, unchanged.
 * @param where - what was being acquired, for the refusal's first clause.
 * @returns the acquired unit.
 */
export async function acquireUnit(lab: LabFace, spec: LabAcquireSpec, where: string): Promise<LabUnitInfo> {
  try {
    return await lab.acquire(spec)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    // Matching on lab's own wording is a seam, and a shallow one on purpose:
    // if lab ever rewords the refusal the enrichment stops happening and the
    // raw message still reaches the reader. The alternative — a typed error
    // across the package boundary — is a contract change to a package this
    // task does not touch.
    if (!/maxconcurrentunits/i.test(reason)) throw error
    throw new Error(`${where}: ${reason}\n  ${await describeUnitHolders(lab)}`)
  }
}

/**
 * THE destroy path. Every unit this orchestrator acquires dies here and
 * nowhere else — frozen decision 12 says the destroy path is unique, and a
 * second `release` call site is how that stops being true.
 *
 * `force` appears in exactly one caller: the readiness probe unit, which is
 * bound to no mission and therefore has no gate to pass; lab requires the
 * flag precisely so that a gate-less destroy is a deliberate sentence rather
 * than a default. A cell's unit never carries it — its gate is
 * `mission.isReleasable`, and a refusal LEAVES THE CONTAINER, which is the
 * behavior a human wants when a cell needs looking at.
 * @returns whether the unit was actually destroyed.
 */
export async function destroyUnit(
  faces: { lab: LabFace; mission: MissionFace },
  env: { runId: string; by: string; log: (message: string) => void; missionId?: string },
  unit: { id: string; resource: string },
  why: string,
  options: { force?: boolean } = {},
): Promise<boolean> {
  try {
    await faces.lab.release(unit.id, options.force === true ? { force: true } : undefined)
    return true
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    env.log(`unit ${unit.resource} was NOT released (${why}): ${reason}`)
    if (env.missionId !== undefined) {
      await faces.mission.annotate(env.missionId, 'orchestrator', {
        kind: 'unit-retained',
        unit: unit.id,
        resource: unit.resource,
        why,
        reason,
      }, { runId: env.runId, by: env.by }).catch(() => {})
    }
    return false
  }
}

/**
 * The failure path of lab's own recovery loop (lab README «失败恢复循环»),
 * driven from here because the orchestrator is the only thing that knows a
 * cell failed: collect whatever exists (a partial workspace is the normal
 * case), archive the scene — a crashed cell's half-finished workspace, its
 * crash output and its checkpoints are the most valuable data of the round,
 * and releasing without archiving destroys the evidence — and then take the
 * SAME gate the success path takes.
 *
 * There is no force here on purpose. A cell that never reached a releasable
 * state keeps its container, and that is exactly the container a human wants
 * to open. The cost is that a failed cell holds a unit until someone looks at
 * it; the alternative is a destroy path that can be reached by failing, which
 * is the one thing frozen decision 12 is about.
 */
export async function salvageUnit(
  faces: { lab: LabFace; mission: MissionFace },
  env: { runId: string; by: string; log: (message: string) => void; missionId: string },
  unit: LabUnitInfo,
  paths: { cellDir: string; archiveDir: string },
): Promise<void> {
  try {
    await faces.lab.collect(unit.id, {
      source: unit.workspace,
      target: paths.cellDir,
      kind: 'workspace-mirror',
      artifactPath: WORKSPACE_MIRROR,
    })
  } catch (error) {
    env.log(`unit ${unit.resource}: collect after failure did not complete — ${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    mkdirSync(join(paths.archiveDir, 'verdicts'), { recursive: true })
    await faces.lab.archive(unit.id, { target: paths.archiveDir, kind: 'archive', artifactPath: 'archive' })
  } catch (error) {
    env.log(`unit ${unit.resource}: archive after failure did not complete — ${error instanceof Error ? error.message : String(error)}`)
  }
  await destroyUnit(faces, env, unit, 'the cell failed')
}
