/**
 * The fingerprint mirror: lab's one host-side directory.
 *
 * It holds no authority. The docker daemon's labels remain the registry of
 * record — unit id, fingerprint, components and mission binding all ride the
 * resource, and {@link import('./service.ts').LabService} rebuilds everything
 * from them after a host restart. This directory is a derived, human- and
 * script-readable copy of one thing: what each held unit's environment
 * fingerprint was computed from. Delete it and nothing is lost; reconcile
 * re-materializes a missing file from the labels, and `release` removes the
 * file with the unit, so the mirror never outlives the resource it describes.
 *
 * It exists because reading a fingerprint's components should not require
 * shelling out to docker and parsing `inspect` output — a teardown script, a
 * report generator, or a person asking "why did these two cells not compare?"
 * gets a plain file per unit instead.
 */
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FingerprintComponents } from './types.ts'

/** Directory name under the state root holding one JSON per held unit. */
const UNITS_DIR = 'units'

/** One unit's mirrored environment record. */
export interface UnitStateRecord {
  /** Unit id (the file's basename). */
  unit: string
  /** Provider kind that holds the resource. */
  provider: string
  /** Provider-side resource handle. */
  resource: string
  /** The recorded fingerprint string — the same value mission's refs carry. */
  fingerprint: string
  /** What the fingerprint was computed from; null for a legacy bare-digest unit. */
  components: FingerprintComponents | null
  /** Epoch ms this record was written. */
  recordedAt: number
}

/**
 * Resolve the state directory: an explicit value wins, then `$DSH_HOME/lab`,
 * then `<cwd>/.dsh-lab-state` — the same precedence the other dsh plugins use,
 * so one evaluation instance's `$DSH_HOME` collects everything.
 * @param configured - plugin/CLI-provided override, or ''/undefined.
 * @returns the state directory.
 */
export function resolveStateDir(configured: string | undefined): string {
  if (configured !== undefined && configured !== '') return configured
  const home = process.env.DSH_HOME
  if (home !== undefined && home !== '') return join(home, 'lab')
  return join(process.cwd(), '.dsh-lab-state')
}

/**
 * Path of one unit's mirror file.
 * @param stateDir - the state directory.
 * @param unitId - unit id.
 * @returns the absolute file path.
 */
export function unitStateFile(stateDir: string, unitId: string): string {
  return join(stateDir, UNITS_DIR, `${unitId}.json`)
}

/**
 * Write one unit's mirror file (create-or-replace, via rename so a reader
 * never sees a half-written record).
 * @param stateDir - the state directory.
 * @param record - the record to mirror.
 */
export function writeUnitState(stateDir: string, record: UnitStateRecord): void {
  const file = unitStateFile(stateDir, record.unit)
  mkdirSync(join(stateDir, UNITS_DIR), { recursive: true })
  const temporary = `${file}.tmp`
  writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`)
  renameSync(temporary, file)
}

/**
 * Remove one unit's mirror file; a missing file is the expected case for a
 * unit acquired before this line, not an error.
 * @param stateDir - the state directory.
 * @param unitId - unit id.
 */
export function removeUnitState(stateDir: string, unitId: string): void {
  rmSync(unitStateFile(stateDir, unitId), { force: true })
}
