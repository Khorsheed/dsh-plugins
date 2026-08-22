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

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { open, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { LocalAgentSessionRecord } from '@khorsheed/dsh-local-agent'

/** Session files live under this directory inside the scoped home. */
const PROJECTS_ROOT = 'projects'

/** Bound on the head prefix read from one session file. */
const HEAD_BYTES = 64 * 1024

const security = promisify(execFile)

/**
 * The scoped `.claude.json`'s modification stamp (epoch ms), undefined when
 * absent. A completed login rewrites this file, so the stamp distinguishes a
 * fresh login from a leftover marker (a revoked token's record lingers).
 * @param homeDir - the `claude-code` harness's scoped home.
 * @returns the marker's mtime, or undefined when no scoped config exists.
 */
export async function claudeCredentialStamp(homeDir: string): Promise<number | undefined> {
  try {
    return (await stat(join(homeDir, '.claude.json'))).mtimeMs
  } catch {
    return undefined
  }
}

/**
 * The keychain entry name current claude uses for a non-default config dir:
 * the bare name belongs to `~/.claude`, other dirs get a path-hash suffix.
 * @param homeDir - the `claude-code` harness's scoped home.
 * @returns the macOS keychain service name holding the OAuth credential.
 */
function keychainService(homeDir: string): string {
  const hash = createHash('sha256').update(homeDir).digest('hex').slice(0, 8)
  return `Claude Code-credentials-${hash}`
}

/**
 * The stored credential's expiry (epoch ms), read from the macOS keychain
 * entry for this scoped home; undefined when the entry is missing, unreadable,
 * or carries no expiry (presence alone then decides, as before). The blob
 * nests the token record under `claudeAiOauth`.
 * @param homeDir - the `claude-code` harness's scoped home.
 * @returns the expiry, or undefined when unknown.
 */
async function readCredentialExpiry(homeDir: string): Promise<number | undefined> {
  try {
    const { stdout } = await security('find-generic-password', ['-s', keychainService(homeDir), '-w'])
    const parsed = JSON.parse(stdout.trim()) as { claudeAiOauth?: { expiresAt?: unknown } }
    const expiry = parsed.claudeAiOauth?.expiresAt
    return typeof expiry === 'number' ? expiry : undefined
  } catch {
    // Not on macOS, no such entry, or an unreadable payload: no expiry info.
    return undefined
  }
}

/**
 * Mirror the keychain credential into `<homeDir>/.credentials.json`. Claude
 * 2.1.236 on macOS WRITES the scoped login to the hashed keychain entry but
 * READS the credentials file at runtime (the same write/read split as the
 * Linux #47661 bug) — a login that lands only in the keychain still answers
 * "Not logged in". Called from the login watch so a completed login becomes
 * readable; idempotent and content-compare before write.
 * @param homeDir - the `claude-code` harness's scoped home.
 * @returns true when the file holds the current keychain credential after the call.
 */
export async function syncClaudeCredentialFile(homeDir: string): Promise<boolean> {
  let blob: string
  try {
    const { stdout } = await security('find-generic-password', ['-s', keychainService(homeDir), '-w'])
    blob = stdout.trim()
    JSON.parse(blob)
  } catch {
    return false
  }
  const file = join(homeDir, '.credentials.json')
  try {
    if ((await readFile(file, 'utf8')).trim() === blob) return true
  } catch {
    // Absent or unreadable: fall through to the write.
  }
  await writeFile(file, blob, { mode: 0o600 })
  return true
}

/**
 * The expiry (epoch ms) from a `.credentials.json` payload; the token record
 * nests under `claudeAiOauth`. Undefined when absent/unparseable.
 * @param text - the file contents.
 * @returns the expiry, or undefined.
 */
function credentialFileExpiry(text: string): number | undefined {
  try {
    const parsed = JSON.parse(text) as { claudeAiOauth?: { expiresAt?: unknown } }
    const expiry = parsed.claudeAiOauth?.expiresAt
    return typeof expiry === 'number' ? expiry : undefined
  } catch {
    return undefined
  }
}

/**
 * Whether the scoped home holds usable Claude Code credentials: the scoped
 * `.claude.json` carries an `oauthAccount` record once a device-code login
 * has completed, AND the keychain credential is not past its stored expiry
 * (when the expiry is readable — a server-side REVOCATION is not visible
 * locally; providers report those through `localAgent.reportAuthFailure`).
 * The real credential lives in the macOS keychain under a hashed entry
 * (`Claude Code-credentials-<sha256(path)[:8]>`, hashed from the config-dir
 * path) or in the default `~/.claude/.credentials.json` on Linux (upstream
 * bug #47661: `CLAUDE_CONFIG_DIR` does not isolate the credentials file
 * there — it writes the scoped dir but READS the default home, so Linux
 * credentials may exist even when the scoped home has none). Spawning the
 * CLI to probe auth is avoided; the platform differences are documented in
 * the README.
 * @param homeDir - the `claude-code` harness's scoped home.
 * @returns true when a completed login is recorded and not locally expired.
 */
export async function claudeAuthenticated(homeDir: string): Promise<boolean> {
  // The runtime reads `.credentials.json` first (claude 2.1.236 writes the
  // keychain but reads the file — see syncClaudeCredentialFile).
  let fileExpiry: number | undefined
  let filePresent = false
  try {
    const text = await readFile(join(homeDir, '.credentials.json'), 'utf8')
    fileExpiry = credentialFileExpiry(text)
    filePresent = true
  } catch {
    // No credentials file: fall through to the keychain-backed check.
  }
  if (filePresent) return fileExpiry === undefined || fileExpiry > Date.now()
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
  if (config.oauthAccount === undefined || config.oauthAccount === null) return false
  // Presence established; refuse a credential past its stored expiry. A
  // server-side revocation is not locally visible — that path reports through
  // the delegation's 401/403, not this probe.
  const expiry = await readCredentialExpiry(homeDir)
  return expiry === undefined || expiry > Date.now()
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
