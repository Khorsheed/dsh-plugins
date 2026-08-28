/**
 * Kimi Code session records adapter: reads the scoped home's
 * `session_index.jsonl`, kimi's own append-only index.
 * @module @khorsheed/dsh-local-agent-kimi/records
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { LocalAgentSessionRecord } from '@khorsheed/dsh-local-agent'
import { guardKimiCredential } from './credential-guard.ts'

/** Credentials live under this directory inside the scoped home. */
const CREDENTIALS_DIR = 'credentials'

/**
 * Whether the scoped home holds usable login credentials, guarded by the
 * credential sentinel: a VALID credential file (both tokens non-empty) reads
 * true and refreshes the backup; an empty shell (the kimi CLI's failure-path
 * wipe) restores the backup when one exists and reads false otherwise. The
 * pre-sentinel "directory non-empty" check could not tell the empty shell
 * from a real credential at all.
 * @param homeDir - the `kimi` harness's scoped home.
 * @returns true when usable credentials are present (after any restore).
 */
export async function kimiAuthenticated(homeDir: string): Promise<boolean> {
  return guardKimiCredential(homeDir)
}

/**
 * The newest credential file's modification stamp (epoch ms), undefined when
 * no credential exists. A completed device-code login rewrites the
 * credentials directory, so the stamp distinguishes a fresh login from a
 * leftover (possibly expired) credential.
 * @param homeDir - the `kimi` harness's scoped home.
 * @returns the newest credential mtime, or undefined when none exists.
 */
export async function kimiCredentialStamp(homeDir: string): Promise<number | undefined> {
  try {
    const entries = await readdir(join(homeDir, CREDENTIALS_DIR))
    let newest: number | undefined
    for (const entry of entries) {
      const { mtimeMs } = await stat(join(homeDir, CREDENTIALS_DIR, entry))
      if (newest === undefined || mtimeMs > newest) newest = mtimeMs
    }
    return newest
  } catch {
    return undefined
  }
}

/** One raw index line, keeping unknown fields for forward compatibility. */
interface KimiIndexLine extends LocalAgentSessionRecord {
  sessionId: string
  sessionDir: string
  workDir: string
  [key: string]: unknown
}

/**
 * Read the scoped home's session index. The index is kimi's own
 * newline-delimited JSONL; a torn tail line (the file is append-only) is
 * skipped rather than failing the whole list.
 * @param homeDir - the `kimi` harness's scoped home.
 * @returns the parsed records in file order, empty when no index exists yet.
 */
export async function listKimiSessions(homeDir: string): Promise<readonly LocalAgentSessionRecord[]> {
  const indexPath = join(homeDir, 'session_index.jsonl')
  let text: string
  try {
    text = await readFile(indexPath, 'utf8')
  } catch (error) {
    // No index yet: the scoped home has never run a session. Nothing to list.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const records: LocalAgentSessionRecord[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      const parsed = JSON.parse(trimmed) as KimiIndexLine
      records.push({
        id: parsed.sessionId,
        workDir: parsed.workDir,
        ...parsed.title !== undefined && typeof parsed.title === 'string' && { title: parsed.title },
        ...parsed.createdAt !== undefined && typeof parsed.createdAt === 'string' && { startedAt: Date.parse(parsed.createdAt) },
      })
    } catch {
      // A torn tail line from an in-flight append; skip it and keep the rest.
    }
  }
  return records
}
