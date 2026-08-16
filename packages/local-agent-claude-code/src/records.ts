/**
 * Claude Code session records adapter: scans the scoped home's `projects/`
 * session files (one JSONL per session under `projects/<cwd-slug>/`, the
 * slug being the workspace path with separators replaced by dashes). The
 * slug is a LOSSY encoding of the cwd — different paths can collide on the
 * same slug — so the listed cwd always comes from the file CONTENT (the
 * first `user` event's `cwd` field), never from the directory name. Only the
 * head of each file is read — the first user event carries the id, cwd, and
 * timestamp the listing needs; the rest of the file (conversation) is not
 * parsed. Files are append-only with torn-tail tolerance, and contents are
 * always untrusted input.
 * @module @khorsheed/dsh-local-agent-claude-code/records
 */

import { open, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { LocalAgentSessionRecord } from '@khorsheed/dsh-local-agent'

/** Session files live under this directory inside the scoped home. */
const PROJECTS_ROOT = 'projects'

/** Bound on the head prefix read from one session file. */
const HEAD_BYTES = 64 * 1024

/**
 * Whether the scoped home holds usable Claude Code credentials: the scoped
 * `.claude.json` carries an `oauthAccount` record once a device-code login
 * has completed. This is a deliberate light FILE check — the real credential
 * lives in the macOS keychain under a hashed entry (`Claude Code-credentials-<sha256(path)[:8]>`,
 * hashed from the config-dir path) or in the default `~/.claude/.credentials.json`
 * on Linux (upstream bug #47661: `CLAUDE_CONFIG_DIR` does not isolate the
 * credentials file there — it writes the scoped dir but READS the default
 * home, so Linux credentials may exist even when the scoped home has none).
 * Spawning the CLI to probe auth is avoided; the platform differences are
 * documented in the README.
 * @param homeDir - the `claude-code` harness's scoped home.
 * @returns true when a completed login is recorded in the scoped config.
 */
export async function claudeAuthenticated(homeDir: string): Promise<boolean> {
  let text: string
  try {
    text = await readFile(join(homeDir, '.claude.json'), 'utf8')
  } catch (error) {
    // No scoped config yet: not authenticated.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  let config: { oauthAccount?: unknown }
  try {
    config = JSON.parse(text) as { oauthAccount?: unknown }
  } catch {
    // A torn or malformed config reads as not authenticated.
    return false
  }
  return config.oauthAccount !== undefined && config.oauthAccount !== null
}

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
