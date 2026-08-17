/**
 * Session records adapter for the `dsh` harness: list the sub-dsh's own
 * sessions from its scoped-home store. The sub-dsh persists JSONL logs under
 * `<scoped home>/sessions/<project>/<session-id>/session.jsonl.zstd` (the
 * same physical layout the official JSONL persistence backend writes), so the
 * adapter reads headers directly instead of asking the parent's persistence
 * service, which is bound to the parent's own store root.
 * @module @khorsheed/dsh-local-agent-dsh/records
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import type { LocalAgentSessionRecord } from '@khorsheed/dsh-local-agent'

/** A stored session's header line, the subset this adapter reads. */
interface DshSessionHeader {
  id: string
  cwd?: string
  createdAt?: number
}

/** Parse the header line of a session log; undefined when it is not one. */
export function parseDshSessionHeader(firstLine: string): DshSessionHeader | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(firstLine)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const header = parsed as Record<string, unknown>
  if (header.type !== 'session' || typeof header.id !== 'string') return undefined
  return {
    id: header.id,
    ...(typeof header.cwd === 'string' ? { cwd: header.cwd } : {}),
    ...(typeof header.createdAt === 'number' ? { createdAt: header.createdAt } : {}),
  }
}

/** Whether an fs error is a missing entry. */
function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

/**
 * Read a session log's first line (its header). The JSONL backend stores one
 * zstd frame per append batch; node's zstdDecompress decodes the first frame,
 * which holds the header line written at session creation.
 * @param logPath - the `session.jsonl.zstd` file to read.
 * @returns the first line, or undefined when the file is empty/half-written.
 */
export async function readDshSessionHeaderLine(logPath: string): Promise<string | undefined> {
  let buffer: Buffer
  try {
    buffer = await readFile(logPath)
  } catch (error) {
    if (isENOENT(error)) return undefined
    throw error
  }
  if (buffer.length === 0) return undefined
  let text: string
  try {
    text = zstdDecompressSync(buffer).toString('utf8')
  } catch {
    // A torn or non-zstd file is not a readable session; treat as absent.
    return undefined
  }
  const firstLine = text.split('\n', 1)[0]
  return firstLine === undefined ? undefined : firstLine
}

/**
 * List the sessions recorded in the harness scoped home, in the store's own
 * order (project directories first, then session directories).
 * @param homeDir - the `dsh` harness's scoped home (its `$DSH_HOME` root).
 * @returns the session records; an absent store yields an empty list.
 */
export async function listDshSessions(homeDir: string): Promise<readonly LocalAgentSessionRecord[]> {
  const root = join(homeDir, 'sessions')
  let projects: string[]
  try {
    projects = await readdir(root)
  } catch (error) {
    if (isENOENT(error)) return []
    throw error
  }
  const records: LocalAgentSessionRecord[] = []
  for (const project of projects) {
    // Project directories are the `--<slug>--` grouping the backend writes.
    if (!project.startsWith('--')) continue
    let sessionIds: string[]
    try {
      sessionIds = await readdir(join(root, project))
    } catch (error) {
      if (isENOENT(error)) continue
      throw error
    }
    for (const sessionId of sessionIds) {
      const headerLine = await readDshSessionHeaderLine(join(root, project, sessionId, 'session.jsonl.zstd'))
      if (headerLine === undefined) continue
      const header = parseDshSessionHeader(headerLine)
      if (header === undefined) continue
      records.push({
        id: header.id,
        ...(header.cwd !== undefined ? { workDir: header.cwd } : { workDir: project }),
        ...(header.createdAt !== undefined ? { startedAt: header.createdAt } : {}),
      })
    }
  }
  return records
}
