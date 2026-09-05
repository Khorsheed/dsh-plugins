/**
 * Run-bundle export (proposal §6) and the ns completeness report.
 *
 * A bundle is SELF-CONTAINED: `<runId>-bundle/` carries the frozen state
 * machine, the run record, every mission attempt (history/refs/checkpoints/
 * plan data), all annotations of every namespace, the artifact bytes from the
 * run-data tree, and the included dataset-snapshot layers — a reader needs
 * nothing from the source repositories.
 *
 * Two honesty rules live here:
 *
 * - The **leak gate** is computed, not enforced, by this module: `planExport`
 *   reports which included layers are guarded (`modelFacing: false`); the
 *   calling face (CLI TTY prompt, slash refusal, web confirm dialog) owns the
 *   interaction. No flag anywhere bypasses the gate.
 * - The **ns completeness report** never substitutes: a cell missing an
 *   `expectedNs` namespace is reported missing, and a cell whose annotations
 *   are all OUTSIDE `expectedNs` (only unlisted ns present — e.g. a draft)
 *   is flagged `onlyUnlisted`, never silently counted as covered.
 */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { MissionStore } from './store.ts'
import type { AnnotationRecord, RunRecord, StateMachineDecl } from './types.ts'

/** One dataset-snapshot layer to include in the bundle. */
export interface ExportLayer {
  /** Layer id; content is copied from `<snapshotDir>/<name>/`. */
  name: string
  /** `modelFacing: false` — including this layer requires the human confirmation gate. */
  guarded: boolean
}

/** The dataset snapshot reference recorded into the manifest. */
export interface SnapshotRef {
  repo: string
  commit: string
  dataset?: string
}

/** What to export. */
export interface ExportRequest {
  runId: string
  outDir: string
  /** Layers to include (each pre-resolved as guarded or not by the calling face). */
  layers?: ExportLayer[]
  /** Directory the layer content is copied from (`<snapshotDir>/<layer>/`). */
  snapshotDir?: string
  /** Snapshot reference recorded into the manifest. */
  snapshot?: SnapshotRef
  /** Epoch ms stamp (injected for deterministic tests). */
  now?: number
}

/** Per-cell ns completeness against the run meta's `expectedNs`. */
export interface NsCellReport {
  missionId: string
  attempt: number
  /** Every namespace present in the cell's annotations (sorted). */
  present: string[]
  /** expectedNs namespaces present. */
  expectedPresent: string[]
  /** expectedNs namespaces absent — reported as missing, never substituted. */
  missing: string[]
  /** Annotations exist but NONE from expectedNs — "only a draft" style cells. */
  onlyUnlisted: boolean
  /** Namespace -> sorted set of writer origins (`tool:`, `cli`, `service`, `slash:`, ...). */
  writtenBy: Record<string, string[]>
}

/** The export plan: what a bundle would contain, before anything is written. */
export interface ExportPlan {
  runId: string
  /** Absolute bundle directory (`<outDir>/<runId>-bundle`). */
  bundleDir: string
  layers: ExportLayer[]
  /** Included layers flagged guarded — the leak gate's trigger list. */
  guardedLayers: string[]
  /** Per-cell ns completeness, or null when the run declares no expectedNs. */
  nsReport: NsCellReport[] | null
  /** The declared expected namespaces (null when undeclared). */
  expectedNs: string[] | null
  /** Mission/attempt counts for the caller's summary line. */
  missions: number
  attempts: number
}

/** The finished export. */
export interface ExportResult {
  bundleDir: string
  files: number
  nsReport: NsCellReport[] | null
}

/** The declared expected namespaces of a run meta object (scene data; absent → no report). */
export function expectedNsOfMeta(meta: Record<string, unknown>): string[] | null {
  const raw = meta['expectedNs']
  if (!Array.isArray(raw) || raw.length === 0 || raw.some(ns => typeof ns !== 'string' || ns === '')) return null
  return raw as string[]
}

/** The run meta's declared expected namespaces. */
export function expectedNsOf(run: RunRecord): string[] | null {
  return expectedNsOfMeta(run.meta)
}

/**
 * Per-cell namespace completeness. `present` lists every ns the cell carries;
 * `missing` is expectedNs minus present — a missing ns is reported as missing
 * and NEVER substituted by another namespace. `onlyUnlisted` flags cells
 * whose annotations are all outside expectedNs (the "looks reviewed, actually
 * only a draft" case).
 */
export function nsCompleteness(run: RunRecord): NsCellReport[] | null {
  const expected = expectedNsOfMeta(run.meta)
  if (expected === null) return null
  return run.missions.map((mission) => {
    const present = [...new Set(
      mission.annotations
        .filter(a => a.attempt === mission.currentAttempt)
        .map(a => a.ns),
    )].sort()
    const expectedPresent = expected.filter(ns => present.includes(ns))
    const writtenBy = Object.fromEntries(
      [...new Set([...expected, ...present])].map(ns => [
        ns,
        [...new Set(
          mission.annotations
            .filter(a => a.attempt === mission.currentAttempt && a.ns === ns)
            .map(a => {
              const colon = a.by.indexOf(':')
              return colon < 0 ? a.by : a.by.slice(0, colon + 1)
            }),
        )].sort(),
      ]),
    )
    return {
      missionId: mission.id,
      attempt: mission.currentAttempt,
      present,
      expectedPresent,
      missing: expected.filter(ns => !present.includes(ns)),
      onlyUnlisted: present.length > 0 && expectedPresent.length === 0,
      writtenBy,
    }
  })
}

/** Render the ns completeness report as human lines (run status / CLI export summary). */
export function renderNsReport(expected: string[], report: NsCellReport[]): string[] {
  const lines = [`ns completeness (expectedNs: ${expected.join(', ')}):`]
  for (const cell of report) {
    const head = `  ${cell.missionId} attempt ${cell.attempt}:`
    const writers = Object.entries(cell.writtenBy)
      .map(([ns, origins]) => `${ns}=[${origins.join(', ')}]`)
      .join(' ')
    if (cell.missing.length === 0) {
      lines.push(`${head} complete [${cell.present.join(', ')}]${writers === '' ? '' : ` — writtenBy: ${writers}`}`)
    } else if (cell.onlyUnlisted) {
      lines.push(`${head} only unlisted ns present [${cell.present.join(', ')}] — missing: ${cell.missing.join(', ')}${writers === '' ? '' : ` — writtenBy: ${writers}`}`)
    } else {
      lines.push(`${head} present [${cell.expectedPresent.join(', ') || '—'}] — missing: ${cell.missing.join(', ')}${writers === '' ? '' : ` — writtenBy: ${writers}`}`)
    }
  }
  return lines
}

/**
 * Plan an export: resolve the bundle directory, the included layers (with
 * their guarded flags), and the ns completeness report. Nothing is written.
 * The caller runs the leak gate on `guardedLayers` before calling
 * {@link exportRun}.
 */
export function planExport(store: MissionStore, request: ExportRequest): ExportPlan {
  const run = store.readRun(request.runId)
  if (run === null) throw new Error(`mission: run ${request.runId} does not exist`)
  const layers = request.layers ?? []
  const names = new Set<string>()
  for (const layer of layers) {
    if (names.has(layer.name)) throw new Error(`mission: export layer ${JSON.stringify(layer.name)} declared twice`)
    names.add(layer.name)
  }
  if (layers.length > 0 && request.snapshotDir === undefined) {
    throw new Error('mission: including layers requires --snapshot-dir to copy their content from (a bundle is self-contained)')
  }
  const attempts = run.missions.reduce((n, m) => n + m.attempts.length, 0)
  return {
    runId: run.id,
    bundleDir: join(request.outDir, `${run.id}-bundle`),
    layers,
    guardedLayers: layers.filter(l => l.guarded).map(l => l.name),
    nsReport: nsCompleteness(run),
    expectedNs: expectedNsOf(run),
    missions: run.missions.length,
    attempts,
  }
}

/** sha256 over a directory tree: sorted (path, content) pairs — deterministic. */
function hashTree(dir: string): string {
  const hash = createHash('sha256')
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full, rel)
      } else if (entry.isFile()) {
        hash.update(rel)
        hash.update('\0')
        hash.update(readFileSync(full))
        hash.update('\0')
      }
    }
  }
  walk(dir, '')
  return hash.digest('hex')
}

/** Count files under a directory (recursive). */
function countFiles(dir: string): number {
  let count = 0
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) count++
    }
  }
  if (existsSync(dir)) walk(dir)
  return count
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

/**
 * Write the bundle. Refuses to overwrite an existing bundle directory
 * (append-only philosophy: an export is a fact, not a mutable draft). The
 * leak gate is the CALLER's job — this function trusts `request.layers` as
 * confirmed.
 * @returns the bundle location and file count.
 */
export function exportRun(store: MissionStore, request: ExportRequest): ExportResult {
  const run = store.readRun(request.runId)
  if (run === null) throw new Error(`mission: run ${request.runId} does not exist`)
  const plan = planExport(store, request)
  const bundle = plan.bundleDir
  if (existsSync(bundle)) {
    throw new Error(`mission: bundle ${bundle} already exists — exports are not overwritten; pick another --out or remove it by hand`)
  }
  mkdirSync(bundle, { recursive: true })

  // Dataset snapshot layers (content first, so a copy failure leaves no manifest).
  const layerEntries: Array<{ name: string; guarded: boolean; files: number; contentHash: string }> = []
  for (const layer of plan.layers) {
    const source = join(request.snapshotDir as string, layer.name)
    if (!existsSync(source) || !statSync(source).isDirectory()) {
      throw new Error(`mission: layer ${JSON.stringify(layer.name)} not found under snapshot dir ${request.snapshotDir as string}`)
    }
    const target = join(bundle, 'dataset', layer.name)
    cpSync(source, target, { recursive: true })
    layerEntries.push({ name: layer.name, guarded: layer.guarded, files: countFiles(target), contentHash: hashTree(target) })
  }

  // Missions: one directory per attempt — meta, annotations, artifact bytes.
  const attemptHashes: Record<string, string> = {}
  for (const mission of run.missions) {
    for (const attempt of mission.attempts) {
      const cell = join(bundle, 'missions', mission.id, `attempt-${attempt.attempt}`)
      writeJson(join(cell, 'meta.json'), attempt)
      const annotations: AnnotationRecord[] = mission.annotations.filter(a => a.attempt === attempt.attempt)
      writeJson(join(cell, 'annotations.json'), annotations)
      const dataDir = store.attemptDataDir(run.id, mission.id, attempt.attempt)
      if (existsSync(dataDir)) {
        const target = join(cell, 'artifacts')
        cpSync(dataDir, target, { recursive: true })
        attemptHashes[`missions/${mission.id}/attempt-${attempt.attempt}`] = hashTree(target)
      }
    }
  }

  writeJson(join(bundle, 'run.json'), {
    id: run.id,
    createdAt: run.createdAt,
    state: run.state,
    meta: run.meta,
    ...(run.originSession !== undefined ? { originSession: run.originSession } : {}),
    ...(run.templateName !== undefined ? { templateName: run.templateName } : {}),
    stateMachine: run.stateMachine,
  })

  const manifest = {
    runId: run.id,
    exportedAt: request.now ?? Date.now(),
    templateName: run.templateName ?? null,
    stateMachine: run.stateMachine as StateMachineDecl,
    snapshot: request.snapshot ?? null,
    layers: layerEntries,
    /** Included guarded layers, restated plainly — the gate's confirmation list. */
    guardedLayers: plan.guardedLayers,
    nsReport: plan.nsReport,
    contentHashes: {
      ...Object.fromEntries(layerEntries.map(l => [`dataset/${l.name}`, l.contentHash])),
      ...attemptHashes,
    },
  }
  writeJson(join(bundle, 'manifest.json'), manifest)
  writeFileSync(join(bundle, 'methodology.md'), `# ${run.id} methodology\n\n(人工撰写 / written by hand)\n`)

  return { bundleDir: bundle, files: countFiles(bundle), nsReport: plan.nsReport }
}
