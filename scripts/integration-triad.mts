/**
 * Three-package integration driver: datasets → lab → mission, the first half
 * of the evaluation chain (no model involved). Design basis:
 *   proposals/active/2026-08-19-datasets-store.md
 *   proposals/active/2026-08-19-mission-tasks.md
 *   proposals/active/2026-08-19-lab-experiment-units.md
 *
 * Chain (each step's facts land in the returned evidence object; the spec
 * asserts against it):
 *   1. datasets: a throwaway git fixture (layers visible/verify/grading,
 *      grading marked modelFacing:false) → snapshot → worktree_path limited
 *      to the `visible` layer (sparse-checkout is the mechanism).
 *   2. mission: a bench-style JSON template run with the gated state machine
 *      pending → ws-ready → working → collected → archived → releasable →
 *      released (archived → releasable carries a file-check guard on
 *      `archive/output.txt`; releasableStates = ['releasable']), one mission.
 *   3. lab: acquire (docker) — refs.resource + fingerprint land in mission —
 *      populate the worktree in, probe that the container CANNOT see the
 *      grading/verify layers, produce an output, collect it back (artifact).
 *   4. gate: transition to `archived`; a premature archived → releasable and
 *      a premature lab release must BOTH be refused; the driver then writes
 *      the archive file into the attempt's run-data directory (simulating the
 *      orchestrator's export — lab M2's archive verb is not on this path),
 *      the file-check transition passes, release succeeds, the container is
 *      gone from `docker ps -a`.
 *   5. history and the lab-namespace annotations are captured for the
 *      append-only assertions.
 *
 * Everything lives under one mkdtemp root (no machine-specific paths — the
 * repo is public and the hygiene gate rejects them); the caller gets a
 * cleanup handle that force-removes the container and the temp tree.
 */
import { execFile, execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createDatasetsService, type DatasetScope, type DatasetSnapshot } from '../packages/datasets/src/service.ts'
import type { ManagedWorktree } from '../packages/datasets/src/worktree.ts'
import { MissionService } from '../packages/mission/src/service.ts'
import type { AnnotationRecord, AttemptRecord } from '../packages/mission/src/types.ts'
import { DockerProvider } from '../packages/lab/src/docker.ts'
import { LabService } from '../packages/lab/src/service.ts'
import type { Exec, ExecResult, UnitInfo, VerifyResult } from '../packages/lab/src/types.ts'

/** The bench-style run template (JSON data — policy, not code). */
export const TRIAD_TEMPLATE = {
  name: 'triad-bench',
  states: ['pending', 'ws-ready', 'working', 'collected', 'archived', 'releasable', 'released'],
  transitions: [
    { from: 'pending', to: 'ws-ready' },
    { from: 'ws-ready', to: 'working' },
    { from: 'working', to: 'collected' },
    { from: 'collected', to: 'archived' },
    { from: 'archived', to: 'releasable', guard: { type: 'file-check', dir: 'archive', expectedFiles: ['output.txt'] } },
    { from: 'releasable', to: 'released' },
  ],
  releasableStates: ['releasable'],
  missions: [{ id: 'cell-1', title: 'triad cell', labels: { task: 't1', player: 'driver', rep: '1' } }],
} as const

export const TRIAD_RUN_ID = 'triad'
export const TRIAD_MISSION_ID = 'cell-1'

/** What the chain produced, step by step — the spec's assertion surface. */
export interface TriadEvidence {
  image: string
  repoCommit: string
  snapshot: DatasetSnapshot
  worktree: ManagedWorktree
  /** Sparse-checkout mechanism on the host side: grading/verify absent from the worktree. */
  worktreeTree: string[]
  /** populate's materialization manifest (fairness evidence). */
  materialization: { sha: string; count: number }
  lint: { errors: string[]; warnings: string[] }
  unit: UnitInfo
  refsAfterAcquire: AttemptRecord['refs']
  /** In-container `ls -R` of the populated workspace (visibility evidence). */
  workspaceListing: string
  visibilityProbe: VerifyResult
  outputProduction: VerifyResult
  collectedContent: string
  artifactsAfterCollect: AttemptRecord['artifacts']
  /** Guard refusal evidence, captured BEFORE the archive file exists. */
  prematureTransitionError: string
  prematureReleaseError: string
  containerPresentAfterFailedRelease: boolean
  releasableBeforeArchive: boolean
  releasableAfterGate: boolean
  containerGoneAfterRelease: boolean
  finalState: string
  history: AttemptRecord['history']
  annotations: AnnotationRecord[]
  warnings: string[]
}

export interface TriadResult {
  evidence: TriadEvidence
  /** Force-removes the container (fallback) and the whole temp tree. */
  cleanup: () => Promise<void>
}

/** Outcome of the docker availability probe (CI may have no daemon). */
export interface DockerProbe {
  ok: boolean
  reason?: string
  image?: string
  server?: string
}

function dockerOut(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/**
 * Probe the docker daemon and settle on an image: `alpine:latest` (pulled
 * when absent), else any local image, else a skip reason. The probe includes
 * the pull so a skipped spec never blocks CI on the network. The pull is
 * bounded (the layer is ~3 MB; beyond the bound the network is effectively
 * unusable and the local-image fallback is the better path).
 */
export function probeDocker(): DockerProbe {
  let server: string
  try {
    server = dockerOut(['version', '--format', '{{.Server.Version}}'])
  } catch (error) {
    return { ok: false, reason: `docker daemon unreachable: ${String(error)}` }
  }
  const hasAlpine = (): boolean => {
    try {
      dockerOut(['image', 'inspect', 'alpine:latest', '--format', '{{.Id}}'])
      return true
    } catch {
      return false
    }
  }
  if (!hasAlpine()) {
    try {
      execFileSync('docker', ['pull', 'alpine:latest'], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 })
    } catch { /* fall through to any local image */ }
  }
  if (hasAlpine()) return { ok: true, image: 'alpine:latest', server }
  let local: string[] = []
  try {
    local = dockerOut(['images', '--format', '{{.Repository}}:{{.Tag}}'])
      .split('\n').map(line => line.trim()).filter(line => line !== '' && !line.includes('<none>'))
  } catch { /* empty */ }
  const fallback = local[0]
  if (fallback !== undefined) return { ok: true, image: fallback, server }
  return { ok: false, reason: 'no network to pull alpine:latest and no local image to fall back on', server }
}

/** Host-side Exec adapter for the docker provider (the plugin adapts ctx.subprocess; the driver uses node). */
function nodeExec(): Exec {
  return (argv, options) => new Promise<ExecResult>((resolvePromise) => {
    execFile(argv[0] as string, argv.slice(1), {
      maxBuffer: 64 * 1024 * 1024,
      ...(options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
    }, (error, stdout, stderr) => {
      if (error === null) {
        resolvePromise({ exitCode: 0, stdout, stderr })
        return
      }
      const failed = error as NodeJS.ErrnoException & { code?: number | string; killed?: boolean }
      resolvePromise({
        exitCode: typeof failed.code === 'number' ? failed.code : -1,
        stdout,
        stderr: stderr !== '' ? stderr : String(error),
        timedOut: failed.killed === true,
      })
    })
  })
}

/** List a container by exact name; empty = absent. */
export function containerExists(name: string): boolean {
  try {
    return dockerOut(['ps', '-a', '--filter', `name=^/${name}$`, '--format', '{{.Names}}']) === name
  } catch {
    return false
  }
}

/** Fixture git helper (setup-only; synchronous is fine here). */
function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function writeFiles(dir: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    const target = join(dir, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content, 'utf8')
  }
}

/** Walk a tree relative paths, sorted (visibility evidence). */
function listTree(root: string, prefix = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) out.push(...listTree(root, rel))
    else out.push(rel)
  }
  return out.sort()
}

/** Capture a rejection's message (gate-refusal evidence). */
async function captureError(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('expected the call to be refused, but it succeeded')
}

/**
 * Run the whole datasets → lab → mission chain and collect the evidence.
 * @param image - container image settled by {@link probeDocker}.
 * @returns evidence plus a cleanup handle.
 */
export async function runTriad(image: string): Promise<TriadResult> {
  const tempRoot = mkdtempSync(join(tmpdir(), 'dsh-triad-'))
  const log = (step: string): void => console.log(`[triad] ${step}`)
  let containerName = ''

  const cleanup = async (): Promise<void> => {
    if (containerName !== '') {
      try {
        execFileSync('docker', ['rm', '-f', containerName], { stdio: ['ignore', 'pipe', 'pipe'] })
      } catch { /* already gone */ }
    }
    rmSync(tempRoot, { recursive: true, force: true })
  }

  try {
    // ── Step 1: datasets ────────────────────────────────────────────────
    log('step 1: datasets fixture → snapshot → worktree_path(visible)')
    const repoDir = join(tempRoot, 'repo')
    mkdirSync(repoDir, { recursive: true })
    git(repoDir, ['init', '-q'])
    git(repoDir, ['config', 'user.email', 'triad@example.com'])
    git(repoDir, ['config', 'user.name', 'triad'])
    writeFiles(repoDir, {
      'datasets/qa/dataset.json': `${JSON.stringify({
        id: 'qa',
        name: 'Triad QA dataset',
        layers: [
          { name: 'visible' },
          { name: 'verify' },
          { name: 'grading', modelFacing: false },
        ],
      }, null, 2)}\n`,
      'datasets/qa/items/t1/item.json': '{"difficulty":"easy"}\n',
      'datasets/qa/items/t1/visible/task.md': 'Produce output.txt.\n',
      'datasets/qa/items/t1/verify/check.sh': '#!/bin/sh\ntest -f out/output.txt\n',
      'datasets/qa/items/t1/grading/answer.txt': 'the answer\n',
    })
    git(repoDir, ['add', '-A'])
    git(repoDir, ['commit', '-qm', 'fixture'])
    const repoCommit = git(repoDir, ['rev-parse', 'HEAD'])

    const datasets = createDatasetsService({
      worktreeRoot: join(tempRoot, 'worktrees'),
      bindingsRoot: join(tempRoot, 'bindings'),
    })
    const scope: DatasetScope = { repo: repoDir }
    const snapshot = await datasets.snapshot(scope, 'qa')
    const worktree = await datasets.worktreePath(scope, 'qa', { commit: snapshot.commit, layers: ['visible'] })
    const worktreeTree = listTree(worktree.path).filter(path => path !== '.git')
    log(`worktree at ${worktree.path} (reused=${worktree.reused}), tree: ${worktreeTree.join(', ')}`)

    // ── Step 2: mission ─────────────────────────────────────────────────
    log('step 2: mission runCreate with the gated bench template')
    const mission = new MissionService(join(tempRoot, 'mission'))
    const { lint } = await mission.runCreate({
      template: TRIAD_TEMPLATE,
      runId: TRIAD_RUN_ID,
      meta: { scene: 'integration-triad', expectedNs: ['lab'], dataset: { commit: snapshot.commit } },
      by: 'driver',
    })

    // ── Step 3: lab ─────────────────────────────────────────────────────
    log('step 3: lab acquire → populate → in-container visibility probe → collect')
    const warnings: string[] = []
    const lab = new LabService({
      providers: { docker: new DockerProvider(nodeExec()) },
      maxConcurrentUnits: 2,
      getMission: () => mission,
      warn: message => warnings.push(message),
    })
    const unit = await lab.acquire({ image, missionId: TRIAD_MISSION_ID, runId: TRIAD_RUN_ID })
    containerName = unit.resource
    const refsAfterAcquire = mission.get(TRIAD_MISSION_ID, TRIAD_RUN_ID).mission.attempts[0]?.refs ?? {}
    log(`acquired ${unit.resource} (fingerprint ${unit.fingerprint}); mission refs: ${JSON.stringify(refsAfterAcquire)}`)

    await mission.transition(TRIAD_MISSION_ID, 'ws-ready', { runId: TRIAD_RUN_ID, by: 'driver' })
    const manifestPath = join(tempRoot, 'mission', 'runs', TRIAD_RUN_ID, 'data', TRIAD_MISSION_ID, 'attempt-1', 'materialization.json')
    mkdirSync(dirname(manifestPath), { recursive: true })
    const materialization = await lab.populate(unit.id, { source: worktree.path, manifestPath })
    log(`populated ${materialization.count} file(s), manifest sha ${materialization.sha.slice(0, 12)}…`)
    await mission.transition(TRIAD_MISSION_ID, 'working', { runId: TRIAD_RUN_ID, by: 'driver' })

    const visibilityProbe = await lab.verify(unit.id, {
      command: ['sh', '-c',
        'ls -R /workspace; '
        + 'test -f /workspace/datasets/qa/items/t1/visible/task.md '
        + '&& ! test -e /workspace/datasets/qa/items/t1/grading '
        + '&& ! test -e /workspace/datasets/qa/items/t1/verify'],
    })
    const workspaceListing = visibilityProbe.stdout
    log(`visibility probe exit=${visibilityProbe.exitCode}; container sees:\n${workspaceListing}`)

    const outputProduction = await lab.verify(unit.id, {
      command: ['sh', '-c', 'mkdir -p /workspace/out && printf "triad output\\n" > /workspace/out/output.txt && cat /workspace/out/output.txt'],
    })

    const collectTarget = join(tempRoot, 'collected', TRIAD_MISSION_ID)
    await lab.collect(unit.id, { source: '/workspace/out', target: collectTarget })
    const collectedContent = readFileSync(join(collectTarget, 'output.txt'), 'utf8')
    const artifactsAfterCollect = mission.get(TRIAD_MISSION_ID, TRIAD_RUN_ID).mission.attempts[0]?.artifacts ?? []
    await mission.transition(TRIAD_MISSION_ID, 'collected', { runId: TRIAD_RUN_ID, by: 'driver' })

    // ── Step 4: the gate ────────────────────────────────────────────────
    log('step 4: archive gate — premature transition and release must be refused')
    await mission.transition(TRIAD_MISSION_ID, 'archived', { runId: TRIAD_RUN_ID, by: 'driver' })
    const releasableBeforeArchive = mission.isReleasable(TRIAD_MISSION_ID, TRIAD_RUN_ID)
    const prematureTransitionError = await captureError(() => mission.transition(TRIAD_MISSION_ID, 'releasable', { runId: TRIAD_RUN_ID, by: 'driver' }))
    log(`premature archived→releasable refused: ${prematureTransitionError}`)
    const prematureReleaseError = await captureError(() => lab.release(unit.id))
    log(`premature lab release refused: ${prematureReleaseError}`)
    const containerPresentAfterFailedRelease = containerExists(containerName)

    // Orchestrator export (lab M2 archive is not on this path): the collected
    // output lands in the attempt's run-data archive/ directory by direct write.
    const archiveDir = join(tempRoot, 'mission', 'runs', TRIAD_RUN_ID, 'data', TRIAD_MISSION_ID, 'attempt-1', 'archive')
    mkdirSync(archiveDir, { recursive: true })
    copyFileSync(join(collectTarget, 'output.txt'), join(archiveDir, 'output.txt'))

    await mission.transition(TRIAD_MISSION_ID, 'releasable', { runId: TRIAD_RUN_ID, by: 'driver' })
    const releasableAfterGate = mission.isReleasable(TRIAD_MISSION_ID, TRIAD_RUN_ID)
    log('file-check passed → releasable; releasing the unit')
    await lab.release(unit.id)
    const containerGoneAfterRelease = !containerExists(containerName)
    await mission.transition(TRIAD_MISSION_ID, 'released', { runId: TRIAD_RUN_ID, by: 'driver' })

    // ── Step 5: audit trail ─────────────────────────────────────────────
    log('step 5: audit trail (history + lab annotations)')
    const record = mission.get(TRIAD_MISSION_ID, TRIAD_RUN_ID).mission
    const attempt = record.attempts[0] as AttemptRecord
    containerName = '' // released; cleanup must not fight a second removal

    return {
      evidence: {
        image,
        repoCommit,
        snapshot,
        worktree,
        worktreeTree,
        materialization: { sha: materialization.sha, count: materialization.count },
        lint,
        unit,
        refsAfterAcquire,
        workspaceListing,
        visibilityProbe,
        outputProduction,
        collectedContent,
        artifactsAfterCollect,
        prematureTransitionError,
        prematureReleaseError,
        containerPresentAfterFailedRelease,
        releasableBeforeArchive,
        releasableAfterGate,
        containerGoneAfterRelease,
        finalState: attempt.state,
        history: attempt.history,
        annotations: record.annotations,
        warnings,
      },
      cleanup,
    }
  } catch (error) {
    await cleanup()
    throw error
  }
}

/* ------------------------------------------------------------------------ */
/* Failure paths (second contact round): what only failures reveal.          */
/* ------------------------------------------------------------------------ */

/**
 * Failure-path template: a failed cell tears down through an ARCHIVE gate,
 * not around it — `working → archived-failed` is attested (teardown is a
 * human decision), `archived-failed → failed` carries the same file-check
 * the success path uses (the crash-scene dump must exist first; partial
 * dumps are the norm and the template names what the orchestrator must
 * produce), and `failed` is the releasable state.
 */
export const TRIAD_FAILURE_TEMPLATE = {
  name: 'triad-failure',
  states: ['pending', 'ws-ready', 'working', 'archived-failed', 'failed'],
  transitions: [
    { from: 'pending', to: 'ws-ready' },
    { from: 'ws-ready', to: 'working' },
    { from: 'working', to: 'archived-failed', guard: { type: 'attested', key: 'teardown-approved' } },
    { from: 'archived-failed', to: 'failed', guard: { type: 'file-check', dir: 'archive', expectedFiles: ['crash-dump.txt'] } },
  ],
  releasableStates: ['failed'],
  missions: [{ id: 'cell-f1', title: 'failure cell', labels: { task: 't1', player: 'driver', rep: '1' } }],
} as const

export const TRIAD_FAILURE_RUN_ID = 'triad-failure'
export const TRIAD_FAILURE_MISSION_ID = 'cell-f1'

/** What the failure chains produced — the spec's assertion surface. */
export interface TriadFailureEvidence {
  /** populate against a nonexistent source fails loud. */
  populateError: string
  /** …but the unit stays TRACKED (visible in status), never silently leaked. */
  unitStillListed: boolean
  containerPresentAfterPopulateFailure: boolean
  /** lab never moves mission state: still `working`, no phantom history. */
  missionStateAfterPopulateFailure: string
  historyLengthAfterFailure: number
  /** The gate refuses release while `working` (not in releasableStates). */
  prematureReleaseError: string
  /** A unit bound to an UNKNOWN mission: acquire warns, release fails closed. */
  ghostAcquireWarned: boolean
  ghostReleaseError: string
  /** …and force does NOT bypass a gate whose query errors. */
  ghostReleaseForceError: string
  /** Attested teardown: premature failed-transition refused (no crash dump),
   *  then dump written → gate passes → release destroys. */
  teardown: { prematureFailedError: string; stateAfter: string; releasable: boolean; containerGone: boolean }
  warnings: string[]
}

export interface TriadFailureResult {
  evidence: TriadFailureEvidence
  cleanup: () => Promise<void>
}

/**
 * Run the failure chains (lab ↔ mission; no datasets leg): acquire succeeds,
 * populate fails; an unknown-mission binding probes the fail-closed gate;
 * the attested-teardown path shows how a failed cell is legitimately
 * released.
 * @param image - container image settled by {@link probeDocker}.
 * @returns evidence plus a cleanup handle.
 */
export async function runTriadFailures(image: string): Promise<TriadFailureResult> {
  const tempRoot = mkdtempSync(join(tmpdir(), 'dsh-triad-fail-'))
  const log = (step: string): void => console.log(`[triad-fail] ${step}`)
  const containers: string[] = []

  const cleanup = async (): Promise<void> => {
    for (const name of containers) {
      try {
        execFileSync('docker', ['rm', '-f', name], { stdio: ['ignore', 'pipe', 'pipe'] })
      } catch { /* already gone */ }
    }
    rmSync(tempRoot, { recursive: true, force: true })
  }

  try {
    const mission = new MissionService(join(tempRoot, 'mission'))
    await mission.runCreate({
      template: TRIAD_FAILURE_TEMPLATE,
      runId: TRIAD_FAILURE_RUN_ID,
      meta: { scene: 'integration-triad-failures' },
      by: 'driver',
    })
    const warnings: string[] = []
    const lab = new LabService({
      providers: { docker: new DockerProvider(nodeExec()) },
      maxConcurrentUnits: 4,
      getMission: () => mission,
      warn: message => warnings.push(message),
    })

    // ── Chain 1: acquire OK, populate FAILS ─────────────────────────────
    log('chain 1: acquire succeeds, populate fails against a bogus source')
    const unit = await lab.acquire({ image, missionId: TRIAD_FAILURE_MISSION_ID, runId: TRIAD_FAILURE_RUN_ID })
    containers.push(unit.resource)
    await mission.transition(TRIAD_FAILURE_MISSION_ID, 'ws-ready', { runId: TRIAD_FAILURE_RUN_ID, by: 'driver' })
    await mission.transition(TRIAD_FAILURE_MISSION_ID, 'working', { runId: TRIAD_FAILURE_RUN_ID, by: 'driver' })
    const populateError = await captureError(() => lab.populate(unit.id, { source: join(tempRoot, 'no-such-dir') }))
    log(`populate refused: ${populateError}`)
    const unitStillListed = (await lab.status(unit.id)).length === 1
    const containerPresentAfterPopulateFailure = containerExists(unit.resource)
    const after = mission.get(TRIAD_FAILURE_MISSION_ID, TRIAD_FAILURE_RUN_ID).mission.attempts[0] as AttemptRecord
    const prematureReleaseError = await captureError(() => lab.release(unit.id))
    log(`release while working refused: ${prematureReleaseError}`)

    // ── Chain 2: a unit bound to an UNKNOWN mission — the gate query fails ──
    log('chain 2: acquire with an unknown missionId; release must fail closed')
    const ghost = await lab.acquire({ image, missionId: 'ghost', runId: TRIAD_FAILURE_RUN_ID })
    containers.push(ghost.resource)
    const ghostAcquireWarned = warnings.some(w => w.includes('ghost'))
    const ghostReleaseError = await captureError(() => lab.release(ghost.id))
    const ghostReleaseForceError = await captureError(() => lab.release(ghost.id, { force: true }))
    log(`ghost release refused (fail closed): ${ghostReleaseError}; force also refused: ${ghostReleaseForceError}`)

    // ── Chain 3: the failure recovery loop — archive the scene BEFORE release ──
    log('chain 3: collect → archive the crash scene → attest → archive gate → release')
    await mission.attest(TRIAD_FAILURE_MISSION_ID, 'teardown-approved', { runId: TRIAD_FAILURE_RUN_ID, by: 'driver' })
    await mission.transition(TRIAD_FAILURE_MISSION_ID, 'archived-failed', { runId: TRIAD_FAILURE_RUN_ID, by: 'driver' })
    // The failure path gets NO gate exception: without the crash dump the
    // file-check refuses exactly like the success path's missing archive.
    const prematureFailedError = await captureError(() => mission.transition(TRIAD_FAILURE_MISSION_ID, 'failed', { runId: TRIAD_FAILURE_RUN_ID, by: 'driver' }))
    log(`archived-failed→failed refused before the dump exists: ${prematureFailedError}`)
    // Orchestrator export of the crash scene (partial is the norm; the
    // template declares what must exist).
    const failArchiveDir = join(tempRoot, 'mission', 'runs', TRIAD_FAILURE_RUN_ID, 'data', TRIAD_FAILURE_MISSION_ID, 'attempt-1', 'archive')
    mkdirSync(failArchiveDir, { recursive: true })
    writeFileSync(join(failArchiveDir, 'crash-dump.txt'), `populate failed: ${populateError}\n`, 'utf8')
    await mission.transition(TRIAD_FAILURE_MISSION_ID, 'failed', { runId: TRIAD_FAILURE_RUN_ID, by: 'driver' })
    const stateAfter = (mission.get(TRIAD_FAILURE_MISSION_ID, TRIAD_FAILURE_RUN_ID).mission.attempts[0] as AttemptRecord).state
    const releasable = mission.isReleasable(TRIAD_FAILURE_MISSION_ID, TRIAD_FAILURE_RUN_ID)
    await lab.release(unit.id)
    const containerGone = !containerExists(unit.resource)
    containers.splice(containers.indexOf(unit.resource), 1)

    return {
      evidence: {
        populateError,
        unitStillListed,
        containerPresentAfterPopulateFailure,
        missionStateAfterPopulateFailure: after.state,
        historyLengthAfterFailure: after.history.length,
        prematureReleaseError,
        ghostAcquireWarned,
        ghostReleaseError,
        ghostReleaseForceError,
        teardown: { prematureFailedError, stateAfter, releasable, containerGone },
        warnings,
      },
      cleanup,
    }
  } catch (error) {
    await cleanup()
    throw error
  }
}
