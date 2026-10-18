/**
 * Claude Code session records adapter: scans the scoped home's `projects/`
 * session files (one JSONL per session under `projects/<cwd-slug>/`, the
 * slug being the workspace path with separators replaced by dashes), plus
 * the transcript model read-back ({@link readClaudeTranscriptModel}) the
 * model broker's `lastObserved` backstop runs on. The
 * slug is a LOSSY encoding of the cwd — different paths can collide on the
 * same slug — so the listed cwd always comes from the file CONTENT (the
 * first `user` event's `cwd` field), never from the directory name. Only the
 * head of each file is read — the first user event carries the id, cwd, and
 * timestamp the listing needs; the rest of the file (conversation) is not
 * parsed. Files are append-only with torn-tail tolerance, and contents are
 * always untrusted input.
 *
 * Credentials are NOT this module's business: the harness authenticates by
 * endpoint key only (see endpoint-auth.ts), which needs no keychain read,
 * no `.credentials.json` reconcile, and no OAuth marker probe.
 * @module @khorsheed/dsh-local-agent-claude-code/records
 */

import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { LocalAgentSessionRecord } from '@khorsheed/dsh-local-agent'

/** Session files live under this directory inside the scoped home. */
const PROJECTS_ROOT = 'projects'

/** Bound on the head prefix read from one session file. */
const HEAD_BYTES = 64 * 1024

/**
 * Bound on the tail read when extracting a transcript's model. Assistant
 * lines are frequent, so the last window almost always names one; a bigger
 * conversation is never read whole.
 */
const TRANSCRIPT_TAIL_BYTES = 256 * 1024

/** Cap on project directories the transcript reads scan. */
const TRANSCRIPT_SCAN_DIRS = 200

/** Cap on transcript files the harness-level newest-scan stats. */
const TRANSCRIPT_SCAN_FILES = 500

/** Cap on sidechain (`agent-*.jsonl`) candidates inspected for one session id. */
const TRANSCRIPT_SIDECHAIN_FILES = 100

/** How many newest transcripts the harness-level read tries before giving up. */
const TRANSCRIPT_NEWEST_TRIES = 3

/**
 * Parse the head of a session file for the listing fields. The first `user`
 * event carries `sessionId`, `cwd`, and `timestamp`; its `cwd` is the only
 * trustworthy workspace source (the directory slug is lossy). Unknown or
 * malformed values yield an undefined record rather than failing the list.
 * @param text - the raw session file head (only the head is read).
 * @returns the record, or undefined when no user event is found.
 */
export function projectRecord(text: string): LocalAgentSessionRecord | undefined {
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    let event: { type?: unknown; sessionId?: unknown; cwd?: unknown; timestamp?: unknown }
    try {
      event = JSON.parse(line) as { type?: unknown; sessionId?: unknown; cwd?: unknown; timestamp?: unknown }
    } catch {
      continue
    }
    if (event.type !== 'user') continue
    if (typeof event.sessionId !== 'string' || event.sessionId === '') return undefined
    if (typeof event.cwd !== 'string') return undefined
    const record: LocalAgentSessionRecord = { id: event.sessionId, workDir: event.cwd }
    const startedAt = typeof event.timestamp === 'string' ? Date.parse(event.timestamp) : undefined
    if (startedAt !== undefined && Number.isFinite(startedAt)) record.startedAt = startedAt
    return record
  }
  return undefined
}

/**
 * Read the scoped home's session files. The listing walks the projects
 * directory and reads each jsonl head; a torn or malformed file is skipped
 * rather than failing the whole list.
 * @param homeDir - the `claude-code` harness's scoped home.
 * @returns the parsed records, empty when no sessions exist yet.
 */
export async function listClaudeSessions(homeDir: string): Promise<readonly LocalAgentSessionRecord[]> {
  const records: LocalAgentSessionRecord[] = []
  let projectDirs: string[]
  try {
    projectDirs = await readdir(join(homeDir, PROJECTS_ROOT))
  } catch (error) {
    // No projects root yet: nothing to list.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  for (const projectDir of projectDirs) {
    let files: string[]
    try {
      files = await readdir(join(homeDir, PROJECTS_ROOT, projectDir))
    } catch {
      continue
    }
    for (const name of files) {
      if (!name.endsWith('.jsonl')) continue
      try {
        // Only the head matters; read a bounded prefix rather than the whole
        // (potentially long) conversation log.
        const handle = await open(join(homeDir, PROJECTS_ROOT, projectDir, name), 'r')
        let text: string
        try {
          const buffer = Buffer.alloc(HEAD_BYTES)
          const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0)
          text = buffer.subarray(0, bytesRead).toString('utf8')
        } finally {
          await handle.close()
        }
        const record = projectRecord(text)
        if (record !== undefined) records.push(record)
      } catch {
        continue
      }
    }
  }
  return records
}

/**
 * Extract the model one transcript names, reading its TAIL (bounded, never
 * the whole conversation) from the newest line backward: the first line
 * carrying a model wins — the top-level `model` of the stream-json init
 * event's shape, or the nested `message.model` of an assistant line. Newest
 * first because a session's later rounds may run a different model than its
 * first, and "what ran last" is the question the caller asks. A torn final
 * line is skipped, never failed on.
 * @param path - the transcript file.
 * @returns the model identifier, or undefined when the window names none.
 */
async function transcriptFileModel(path: string): Promise<string | undefined> {
  let text: string
  try {
    const handle = await open(path, 'r')
    try {
      const { size } = await handle.stat()
      const length = Math.min(size, TRANSCRIPT_TAIL_BYTES)
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, Math.max(0, size - length))
      text = buffer.subarray(0, bytesRead).toString('utf8')
    } finally {
      await handle.close()
    }
  } catch {
    return undefined
  }
  const lines = text.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!.trim()
    if (line === '') continue
    let event: { model?: unknown; message?: { model?: unknown } }
    try {
      event = JSON.parse(line) as typeof event
    } catch {
      continue
    }
    if (typeof event.model === 'string' && event.model !== '') return event.model
    if (typeof event.message?.model === 'string' && event.message.model !== '') return event.message.model
  }
  return undefined
}

/** The project directories under one scoped home, capped; empty on any failure. */
async function projectDirs(homeDir: string): Promise<string[]> {
  try {
    return (await readdir(join(homeDir, PROJECTS_ROOT))).slice(0, TRANSCRIPT_SCAN_DIRS)
  } catch {
    return []
  }
}

/** The jsonl file names inside one project directory; empty on any failure. */
async function projectFiles(homeDir: string, projectDir: string): Promise<string[]> {
  try {
    return (await readdir(join(homeDir, PROJECTS_ROOT, projectDir))).filter(name => name.endsWith('.jsonl'))
  } catch {
    return []
  }
}

/**
 * Whether a sidechain (`agent-*.jsonl`) transcript belongs to one session:
 * its head lines carry the PARENT session's id (`isSidechain: true`). Only
 * the bounded head is read.
 */
async function sidechainSessionMatches(path: string, cliSessionId: string): Promise<boolean> {
  let text: string
  try {
    const handle = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(HEAD_BYTES)
      const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0)
      text = buffer.subarray(0, bytesRead).toString('utf8')
    } finally {
      await handle.close()
    }
  } catch {
    return false
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    try {
      if ((JSON.parse(line) as { sessionId?: unknown }).sessionId === cliSessionId) return true
    } catch {
      continue
    }
  }
  return false
}

/**
 * The model a member's OWN CLI transcript names — the history backstop for
 * the broker's `lastObserved` when no delegation record observed one (every
 * member whose rounds predate the live-settle report). The live-settle
 * channel remains primary (the record's `observedModel` wins when present);
 * this reader only answers "what did this session last run" from the CLI's
 * own files, read-only — nothing is backfilled into `delegations.jsonl`.
 *
 * Location rule: with `cliSessionId`, the main transcript
 * `projects/<cwd-slug>/<cliSessionId>.jsonl` (found by NAME across the
 * project dirs — the slug is lossy, so it is never computed); when it is
 * absent, a sidechain `agent-*.jsonl` whose head names the session id
 * (bounded candidate count) answers instead. Without `cliSessionId` (the
 * settings card's memberless read), the NEWEST transcript across the
 * projects tree (mtime, bounded dir/file scan) answers; a newest file that
 * names no model yields to the next, up to a few tries. Every failure —
 * missing tree, unreadable file, no model in the read window — is
 * `undefined`, never a throw.
 * @param homeDir - the `claude-code` harness's scoped home.
 * @param cliSessionId - the delegation record's CLI session id, when the
 *   member's own transcript is wanted.
 * @returns the model identifier, or undefined.
 */
export async function readClaudeTranscriptModel(homeDir: string, cliSessionId?: string): Promise<string | undefined> {
  if (cliSessionId !== undefined) {
    let main: string | undefined
    const sidechains: string[] = []
    for (const projectDir of await projectDirs(homeDir)) {
      for (const name of await projectFiles(homeDir, projectDir)) {
        if (name === `${cliSessionId}.jsonl` && main === undefined) {
          main = join(homeDir, PROJECTS_ROOT, projectDir, name)
          continue
        }
        if (name.startsWith('agent-') && sidechains.length < TRANSCRIPT_SIDECHAIN_FILES) {
          sidechains.push(join(homeDir, PROJECTS_ROOT, projectDir, name))
        }
      }
    }
    // The main transcript answers first; a main file that names no model in
    // its tail window yields to the sidechains.
    if (main !== undefined) {
      const model = await transcriptFileModel(main)
      if (model !== undefined) return model
    }
    // A sidechain sharing the session id is the only other place the
    // session's model is written (e.g. the round ran as a Task subagent, or
    // the main file is too sparse to name one).
    for (const path of sidechains) {
      if (await sidechainSessionMatches(path, cliSessionId)) {
        const model = await transcriptFileModel(path)
        if (model !== undefined) return model
      }
    }
    return undefined
  }
  // Harness level: the newest transcript in the tree speaks for the harness.
  const candidates: { path: string; mtimeMs: number }[] = []
  let scanned = 0
  for (const projectDir of await projectDirs(homeDir)) {
    for (const name of await projectFiles(homeDir, projectDir)) {
      if (scanned >= TRANSCRIPT_SCAN_FILES) break
      scanned += 1
      const path = join(homeDir, PROJECTS_ROOT, projectDir, name)
      try {
        candidates.push({ path, mtimeMs: (await stat(path)).mtimeMs })
      } catch {
        continue
      }
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)
  for (const candidate of candidates.slice(0, TRANSCRIPT_NEWEST_TRIES)) {
    const model = await transcriptFileModel(candidate.path)
    if (model !== undefined) return model
  }
  return undefined
}
