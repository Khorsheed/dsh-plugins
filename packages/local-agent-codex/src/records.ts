/**
 * Codex session records adapter: scans the scoped home's `sessions/`
 * rollout files (one JSONL per session under `sessions/YYYY/MM/DD/`).
 * Only the head of each file is read — the first `session_meta` line carries
 * the id, cwd, and started-at timestamp the listing needs; the rest of the
 * file (event messages) is not parsed. Files are treated as append-only with
 * torn-tail tolerance, and contents are always untrusted input.
 * @module @khorsheed/dsh-local-agent-codex/records
 */

import { open, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { LocalAgentSessionRecord } from '@khorsheed/dsh-local-agent'

/** Rollout files live under this directory inside the scoped home. */
const SESSIONS_ROOT = 'sessions'

/** Bound on the head prefix read from one rollout file. */
const HEAD_BYTES = 64 * 1024

/**
 * Whether the scoped home holds usable Codex credentials: the `auth.json`
 * file exists. Absent means the device-code flow has not completed.
 * @param homeDir - the `codex` harness's scoped home.
 * @returns true when credentials are present.
 */
export async function codexAuthenticated(homeDir: string): Promise<boolean> {
  try {
    await readFile(join(homeDir, 'auth.json'))
    return true
  } catch (error) {
    // No auth file yet: not authenticated.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** The head of one rollout file: the `session_meta` payload's fields we list. */
interface SessionMeta {
  session_id?: unknown
  cwd?: unknown
  timestamp?: unknown
}

/**
 * Parse the first line of a rollout file for the listing fields. Unknown or
 * malformed values yield an undefined record rather than failing the list.
 * @param text - the raw rollout file content (only the head is read).
 * @returns the record, or undefined when the head is not a session_meta line.
 */
export function rolloutRecord(text: string): LocalAgentSessionRecord | undefined {
  const line = text.split('\n')[0]
  if (line === undefined) return undefined
  let event: { type?: unknown; payload?: unknown }
  try {
    event = JSON.parse(line) as { type?: unknown; payload?: unknown }
  } catch {
    return undefined
  }
  if (event.type !== 'session_meta' || typeof event.payload !== 'object' || event.payload === null) {
    return undefined
  }
  const meta = event.payload as SessionMeta
  if (typeof meta.session_id !== 'string' || meta.session_id === '') return undefined
  if (typeof meta.cwd !== 'string') return undefined
  const record: LocalAgentSessionRecord = { id: meta.session_id, workDir: meta.cwd }
  const startedAt = typeof meta.timestamp === 'string' ? Date.parse(meta.timestamp) : undefined
  if (startedAt !== undefined && Number.isFinite(startedAt)) record.startedAt = startedAt
  return record
}

/**
 * Read the scoped home's rollout files. The listing walks
 * `sessions/YYYY/MM/DD/` and reads each `rollout-*.jsonl` head; a torn or
 * malformed file is skipped rather than failing the whole list.
 * @param homeDir - the `codex` harness's scoped home.
 * @returns the parsed records, empty when no sessions exist yet.
 */
export async function listCodexSessions(homeDir: string): Promise<readonly LocalAgentSessionRecord[]> {
  const records: LocalAgentSessionRecord[] = []
  let years: string[]
  try {
    years = await readdir(join(homeDir, SESSIONS_ROOT))
  } catch (error) {
    // No sessions root yet: nothing to list.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  for (const year of years) {
    if (!/^\d{4}$/.test(year)) continue
    let months: string[]
    try {
      months = await readdir(join(homeDir, SESSIONS_ROOT, year))
    } catch {
      continue
    }
    for (const month of months) {
      if (!/^\d{2}$/.test(month)) continue
      let days: string[]
      try {
        days = await readdir(join(homeDir, SESSIONS_ROOT, year, month))
      } catch {
        continue
      }
      for (const day of days) {
        if (!/^\d{2}$/.test(day)) continue
        let files: string[]
        try {
          files = await readdir(join(homeDir, SESSIONS_ROOT, year, month, day))
        } catch {
          continue
        }
        for (const name of files) {
          if (!name.startsWith('rollout-') || !name.endsWith('.jsonl')) continue
          try {
            // Only the head matters; read a bounded prefix rather than the
            // whole (potentially long) event log.
            const handle = await open(join(homeDir, SESSIONS_ROOT, year, month, day, name), 'r')
            let text: string
            try {
              const buffer = Buffer.alloc(HEAD_BYTES)
              const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0)
              text = buffer.subarray(0, bytesRead).toString('utf8')
            } finally {
              await handle.close()
            }
            const record = rolloutRecord(text)
            if (record !== undefined) records.push(record)
          } catch {
            continue
          }
        }
      }
    }
  }
  return records
}
