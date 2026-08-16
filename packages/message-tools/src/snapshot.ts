/**
 * Withdrawal file snapshot: captures the files a withdrawn turn created or
 * modified, so a "withdraw undo" can restore them. Pure logic + fs read/write;
 * the snapshot is a durable JSON manifest in the session state dir.
 * @module @khorsheed/dsh-client-message-tools/snapshot
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

/** One snapshot entry: the file's display path and its content at withdrawal. */
export interface SnapshotEntry {
  /** Display path recorded by the write/edit tool call. */
  path: string
  /** The file's content at withdrawal time (pre-undo restore target). */
  content: string
  /** What the tool did: write (new) or edit (modified). */
  op: 'write' | 'edit'
}

/** A withdrawal snapshot: the entries plus when it was taken. */
export interface Snapshot {
  /** Withdrawal action id (the withdrawn event's seq). */
  withdrawalSeq: number
  /** Files captured at withdrawal. */
  entries: SnapshotEntry[]
  /** When the snapshot was taken. */
  takenAt: number
}

/** Snapshot file name for one state dir. */
export function snapshotFile(stateDir: string): string {
  return join(stateDir, 'message-tools-snapshots.json')
}

/**
 * Load all snapshots from the state dir.
 * @param stateDir - session state directory.
 * @returns snapshots keyed by withdrawal seq.
 */
export function loadSnapshots(stateDir: string): Map<number, Snapshot> {
  const file = snapshotFile(stateDir)
  if (!existsSync(file)) return new Map()
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Snapshot[]
    return new Map((raw ?? []).map((s) => [s.withdrawalSeq, s]))
  } catch {
    return new Map() // corrupt snapshot file: treat as empty, never crash
  }
}

/**
 * Persist a snapshot (append by withdrawal seq).
 * @param stateDir - session state directory.
 * @param snapshot - the snapshot to record.
 */
export function saveSnapshot(stateDir: string, snapshot: Snapshot): void {
  const file = snapshotFile(stateDir)
  mkdirSync(dirname(file), { recursive: true })
  const all = loadSnapshots(stateDir)
  all.set(snapshot.withdrawalSeq, snapshot)
  writeFileSync(file, JSON.stringify([...all.values()]))
}

/**
 * Read a file's current content (for snapshot capture). Resolves relative to
 * the workspace root.
 * @param filePath - absolute file path.
 * @returns content, or undefined when unreadable.
 */
export function readFileContent(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * Restore a snapshot: write each entry's content back to its path. Used by
 * "withdraw undo" — brings files back to their pre-withdrawal state.
 * @param snapshot - the snapshot to restore.
 * @param resolve - maps a display path to an absolute path.
 */
export function restoreSnapshot(snapshot: Snapshot, resolve: (path: string) => string): void {
  for (const entry of snapshot.entries) {
    const abs = resolve(entry.path)
    try {
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, entry.content)
    } catch {
      // best-effort restore; a locked file stays as-is
    }
  }
}

/**
 * Remove a snapshot (after undo completes).
 * @param stateDir - session state directory.
 * @param withdrawalSeq - the snapshot to drop.
 */
export function dropSnapshot(stateDir: string, withdrawalSeq: number): void {
  const all = loadSnapshots(stateDir)
  all.delete(withdrawalSeq)
  writeFileSync(snapshotFile(stateDir), JSON.stringify([...all.values()]))
}
