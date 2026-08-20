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
  probeDocker, runTriad, TRIAD_MISSION_ID, TRIAD_RUN_ID, type TriadResult,
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
    expect(unit.fingerprint).toMatch(/sha256:/)
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
    expect(artifactsAfterCollect).toHaveLength(1)
    expect(artifactsAfterCollect[0]).toMatchObject({ kind: 'collection' })
    expect(artifactsAfterCollect[0]?.path).toContain('collected')
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
