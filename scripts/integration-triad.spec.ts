/**
 * Three-package integration spec: datasets → lab → mission, first half of the
 * evaluation chain (no model). The chain itself runs in the driver
 * (./integration-triad.mts); this spec asserts the per-step evidence.
 *
 * CI compatibility: with no docker daemon (and no usable image) the whole
 * suite skips with a printed reason. Cleanup (container + temp tree) is
 * guaranteed by afterAll regardless of where the chain failed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  probeDocker, runTriad, runTriadFailures, TRIAD_MISSION_ID, TRIAD_RUN_ID,
  type TriadFailureResult, type TriadResult,
} from './integration-triad.mts'

const docker = probeDocker()
if (!docker.ok) console.warn(`integration-triad: SUITE SKIPPED — ${docker.reason ?? 'docker unavailable'}`)

describe.runIf(docker.ok)('datasets → lab → mission integration (first half, no model)', () => {
  let result: TriadResult | undefined
  beforeAll(async () => {
    result = await runTriad(docker.image as string)
  }, 300_000)
  afterAll(async () => {
    await result?.cleanup()
  }, 60_000)

  const ev = (): TriadResult['evidence'] => {
    if (result === undefined) throw new Error('the chain did not complete — see the beforeAll failure')
    return result.evidence
  }

  it('step 1 datasets: snapshot pins the fixture commit; worktree physically holds ONLY the visible layer', () => {
    const { snapshot, repoCommit, worktree, worktreeTree } = ev()
    expect(snapshot).toMatchObject({ commit: repoCommit, datasetId: 'qa' })
    expect(snapshot.repoPath).toBeTruthy()
    expect(worktree.commit).toBe(repoCommit)
    expect(worktree.layers).toEqual(['visible'])
    // Sparse-checkout is the mechanism: grading/verify never materialize.
    expect(worktreeTree).toEqual(['datasets/qa/items/t1/visible/task.md'])
    expect(worktreeTree.some(path => path.includes('grading'))).toBe(false)
    expect(worktreeTree.some(path => path.includes('verify'))).toBe(false)
  })

  it('step 2 mission: run created from the bench template; lint has no errors', () => {
    const { lint } = ev()
    expect(lint.errors).toEqual([])
  })

  it('step 3 lab: acquire wrote refs.resource + environment fingerprint into mission via the service face', () => {
    const { unit, refsAfterAcquire, image } = ev()
    expect(unit.resource).toBe(`dsh-lab-${unit.id}`)
    expect(refsAfterAcquire.resource).toBe(unit.resource)
    expect(refsAfterAcquire.fingerprint).toBe(unit.fingerprint)
    // The fingerprint is composite; the real daemon-resolved digest this
    // assertion used to check is now its image component.
    expect(unit.fingerprint).toMatch(/^lab-env:[0-9a-f]{64}$/)
    expect(unit.fingerprintComponents?.image).toMatch(/sha256:/)
    expect(unit.missionId).toBe(TRIAD_MISSION_ID)
    expect(unit.runId).toBe(TRIAD_RUN_ID)
    expect(image).toBeTruthy()
  })

  it('step 3 lab: the populated container sees the visible layer and NOT grading/verify', () => {
    const { visibilityProbe, workspaceListing } = ev()
    expect(visibilityProbe.exitCode).toBe(0)
    expect(workspaceListing).toContain('visible')
    expect(workspaceListing).toContain('task.md')
    expect(workspaceListing).not.toContain('grading')
    expect(workspaceListing).not.toContain('verify')
  })

  it('step 3 lab: collect brought the produced file back and registered it as a mission artifact', () => {
    const { outputProduction, collectedContent, artifactsAfterCollect } = ev()
    expect(outputProduction.exitCode).toBe(0)
    expect(collectedContent).toBe('triad output\n')
    const collection = artifactsAfterCollect.find(a => a.kind === 'collection')
    expect(collection?.path).toContain('collected')
  })

  it('step 3 lab: populate returned the materialization manifest and registered it (kind materialization)', () => {
    const { materialization, artifactsAfterCollect } = ev()
    expect(materialization.sha).toMatch(/^[0-9a-f]{64}$/)
    expect(materialization.count).toBe(2) // visible/task.md + the worktree's .git pointer file
    const artifact = artifactsAfterCollect.find(a => a.kind === 'materialization')
    expect(artifact?.path).toContain('materialization.json')
  })

  it('step 4 gate: before the archive export, both the transition and the release are refused', () => {
    const {
      prematureTransitionError, prematureReleaseError,
      releasableBeforeArchive, containerPresentAfterFailedRelease,
    } = ev()
    expect(releasableBeforeArchive).toBe(false)
    // file-check guard fails loud and names the missing file.
    expect(prematureTransitionError).toMatch(/file-check guard failed/)
    expect(prematureTransitionError).toMatch(/output\.txt/)
    // lab's gate: isReleasable=false refuses the irreversible destroy.
    expect(prematureReleaseError).toMatch(/not in a releasable state/)
    // The refused release really destroyed nothing.
    expect(containerPresentAfterFailedRelease).toBe(true)
  })

  it('step 4 gate: after the orchestrator export, file-check passes, release destroys the container', () => {
    const { releasableAfterGate, containerGoneAfterRelease, finalState } = ev()
    expect(releasableAfterGate).toBe(true)
    expect(containerGoneAfterRelease).toBe(true)
    expect(finalState).toBe('released')
  })

  it('step 5 audit: history records exactly the six declared transitions, in order, with actor + time', () => {
    const { history } = ev()
    expect(history.map(h => `${h.from}→${h.to}`)).toEqual([
      'pending→ws-ready',
      'ws-ready→working',
      'working→collected',
      'collected→archived',
      'archived→releasable',
      'releasable→released',
    ])
    // The two REFUSED attempts left no history entries (append-only, no phantom moves).
    expect(history).toHaveLength(6)
    for (const entry of history) {
      expect(entry.by).toBe('driver')
      expect(entry.at).toBeGreaterThan(0)
    }
  })

  it('step 5 audit: lab verify outcomes are append-only annotations in the fixed lab namespace', () => {
    const { annotations } = ev()
    expect(annotations).toHaveLength(2) // visibility probe + output production
    for (const annotation of annotations) {
      expect(annotation.missionId).toBe(TRIAD_MISSION_ID)
      expect(annotation.attempt).toBe(1)
      expect(annotation.ns).toBe('lab')
      expect(annotation.createdAt).toBeGreaterThan(0)
      const payload = annotation.payload as { kind: string; exitCode: number; stdout: string; stderr: string; timedOut: boolean }
      expect(payload.kind).toBe('verify')
      expect(payload.exitCode).toBe(0)
      expect(payload.timedOut).toBe(false)
    }
    // Append-only order: the probe was recorded before the production run.
    expect(annotations[0]?.createdAt).toBeLessThanOrEqual(annotations[1]?.createdAt as number)
  })

  it('lab emitted no degradation warnings on the happy path', () => {
    expect(ev().warnings).toEqual([])
  })
})

describe.runIf(docker.ok)('lab ↔ mission failure paths (second contact round)', () => {
  let result: TriadFailureResult | undefined
  beforeAll(async () => {
    result = await runTriadFailures(docker.image as string)
  }, 300_000)
  afterAll(async () => {
    await result?.cleanup()
  }, 60_000)

  const ev = (): TriadFailureResult['evidence'] => {
    if (result === undefined) throw new Error('the failure chains did not complete — see the beforeAll failure')
    return result.evidence
  }

  it('populate failure fails loud AND the unit stays tracked (no silent leak)', () => {
    const { populateError, unitStillListed, containerPresentAfterPopulateFailure } = ev()
    expect(populateError).toMatch(/ENOENT|no such file/)
    // The unit is neither lost nor silently destroyed: it remains listed and
    // its container exists — teardown is an orchestrator decision, not lab's.
    expect(unitStillListed).toBe(true)
    expect(containerPresentAfterPopulateFailure).toBe(true)
  })

  it('a failed populate never moves mission state and leaves no phantom history', () => {
    const { missionStateAfterPopulateFailure, historyLengthAfterFailure } = ev()
    expect(missionStateAfterPopulateFailure).toBe('working')
    // pending→ws-ready, ws-ready→working — and nothing else.
    expect(historyLengthAfterFailure).toBe(2)
  })

  it('the gate refuses release while the mission is not in a releasable state', () => {
    expect(ev().prematureReleaseError).toMatch(/not in a releasable state/)
  })

  it('a unit bound to an unknown mission: acquire warns, release fails CLOSED on the query error', () => {
    const { ghostAcquireWarned, ghostReleaseError, ghostReleaseForceError } = ev()
    expect(ghostAcquireWarned).toBe(true)
    expect(ghostReleaseError).toMatch(/failed closed/)
    // force is not a bypass when the gate exists but its query errors.
    expect(ghostReleaseForceError).toMatch(/failed closed/)
  })

  it('failure recovery loop: the crash scene must be archived before failed is reachable, then release destroys', () => {
    const { teardown } = ev()
    // No gate exception on the failure path: without the dump, file-check refuses.
    expect(teardown.prematureFailedError).toMatch(/file-check guard failed/)
    expect(teardown.prematureFailedError).toMatch(/crash-dump\.txt/)
    expect(teardown.stateAfter).toBe('failed')
    expect(teardown.releasable).toBe(true)
    expect(teardown.containerGone).toBe(true)
  })
})
