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
 * @module @khorsheed/dsh-local-agent-claude-code/records
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
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

/** Test-swappable process exec (the keychain read goes through `security`). */
export const internals = {
  exec: promisify(execFile),
}

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
 * Whether a credential blob is USABLE: the token record nests under
 * `claudeAiOauth`, and a blob whose access AND refresh tokens are both empty
 * is a shell. macOS keeps historical items under the same service (an early
 * claude wrote an `acct=unknown` placeholder with blank tokens and
 * `expiresAt: 0`), and mirroring one into the credentials file makes every
 * delegation report "OAuth session expired and could not be refreshed" —
 * indistinguishable from a real expiry while login looks successful. A
 * non-empty token is the bar for mirroring a blob or keeping a file.
 * @param text - the raw credential JSON.
 * @returns true when the blob carries a non-empty token.
 */
function credentialUsable(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as { claudeAiOauth?: { accessToken?: unknown; refreshToken?: unknown } }
    const oauth = parsed.claudeAiOauth
    return (typeof oauth?.accessToken === 'string' && oauth.accessToken !== '')
      || (typeof oauth?.refreshToken === 'string' && oauth.refreshToken !== '')
  } catch {
    return false
  }
}

/** One keychain item under the credential service: its account and write stamp. */
interface KeychainItem {
  acct: string
  mdat: number
}

/**
 * A `security dump-keychain` timedate (`2026-09-01 02:03:04 +0000`) as epoch
 * ms; undefined when the shape is not recognized (the item then sorts as
 * oldest).
 * @param text - the quoted timedate string from the dump.
 * @returns the epoch milliseconds, or undefined.
 */
function keychainTimestamp(text: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/.exec(text.trim())
  if (match === null) return undefined
  const part = (index: number): number => Number(match[index])
  const offsetMinutes = (part(8) * 60 + part(9)) * (match[7] === '+' ? 1 : -1)
  const ms = Date.UTC(part(1), part(2) - 1, part(3), part(4), part(5), part(6)) - offsetMinutes * 60_000
  return Number.isFinite(ms) ? ms : undefined
}

/**
 * Every account holding an item under the service, newest write first. macOS
 * allows SEVERAL items per service, and an unscoped `find-generic-password
 * -w` returns the FIRST match — which can be a historical empty shell (see
 * `credentialUsable`) — so the sync enumerates instead of trusting the first
 * hit. The dump prints metadata only (no secrets); a failing dump or a parse
 * miss yields an empty list, and the caller then falls back to the unscoped
 * read.
 * @param service - the keychain service name.
 * @returns the accounts, newest modification first.
 */
async function keychainItems(service: string): Promise<KeychainItem[]> {
  let stdout: string
  try {
    ({ stdout } = await internals.exec('security', ['dump-keychain']))
  } catch {
    return []
  }
  const items: KeychainItem[] = []
  let svce: string | undefined
  let acct: string | undefined
  let mdat = 0
  const flush = (): void => {
    if (svce === service && acct !== undefined) items.push({ acct, mdat })
    svce = undefined
    acct = undefined
    mdat = 0
  }
  for (const line of stdout.split('\n')) {
    // Each item block opens with its `keychain:` header line.
    if (line.startsWith('keychain:')) {
      flush()
      continue
    }
    const trimmed = line.trim()
    const svceMatch = /^"svce"<blob>="(.*)"$/.exec(trimmed)
    if (svceMatch !== null) {
      svce = svceMatch[1]
      continue
    }
    const acctMatch = /^"acct"<blob>="(.*)"$/.exec(trimmed)
    if (acctMatch !== null) {
      acct = acctMatch[1]
      continue
    }
    const mdatMatch = /^"mdat"<timedate>=0x[0-9a-fA-F]+\s+"(.*)"$/.exec(trimmed)
    if (mdatMatch !== null) mdat = keychainTimestamp(mdatMatch[1] ?? '') ?? 0
  }
  flush()
  return items.sort((a, b) => b.mdat - a.mdat)
}

/**
 * One keychain read: the item for `acct` when given, else the first match.
 * Returns the raw blob only when it is USABLE (non-empty token); anything
 * else — missing item, unreadable payload, an empty shell — is undefined.
 * @param service - the keychain service name.
 * @param acct - the account to read, or undefined for the unscoped first match.
 * @returns the credential blob, or undefined.
 */
async function readKeychainEntry(service: string, acct: string | undefined): Promise<string | undefined> {
  try {
    const args = ['find-generic-password', '-s', service]
    if (acct !== undefined) args.push('-a', acct)
    args.push('-w')
    const { stdout } = await internals.exec('security', args)
    const blob = stdout.trim()
    return credentialUsable(blob) ? blob : undefined
  } catch {
    return undefined
  }
}

/**
 * The usable credential blob for this scoped home, or undefined. Every
 * account under the service is tried newest-write-first and the first
 * non-empty token wins; when enumeration itself is unavailable (not macOS, a
 * failing dump) the legacy unscoped read still runs, held to the same
 * non-empty-token bar.
 * @param homeDir - the `claude-code` harness's scoped home.
 * @returns the credential blob, or undefined when nothing usable is stored.
 */
async function readKeychainCredential(homeDir: string): Promise<string | undefined> {
  const service = keychainService(homeDir)
  const items = await keychainItems(service)
  for (const item of items) {
    const blob = await readKeychainEntry(service, item.acct)
    if (blob !== undefined) return blob
  }
  // An enumerated-but-all-empty service has no fallback worth trying.
  return items.length > 0 ? undefined : readKeychainEntry(service, undefined)
}

/**
 * The stored credential's expiry (epoch ms), read from the USABLE macOS
 * keychain item for this scoped home (see `readKeychainCredential`);
 * undefined when no usable item exists or it carries no expiry (presence
 * alone then decides, as before). The READ side takes the LATER of the
 * access-token and refresh-token expiries: the CLI refreshes on use, so a
 * live refresh token means the credential still works.
 * @param homeDir - the `claude-code` harness's scoped home.
 * @returns the expiry, or undefined when unknown.
 */
async function readCredentialExpiry(homeDir: string): Promise<number | undefined> {
  const blob = await readKeychainCredential(homeDir)
  return blob === undefined ? undefined : credentialFileExpiry(blob)
}

/**
 * Mirror the keychain credential into `<homeDir>/.credentials.json`. Claude
 * 2.1.236 on macOS WRITES the scoped login to the hashed keychain entry but
 * READS the credentials file at runtime (the same write/read split as the
 * Linux #47661 bug) — a login that lands only in the keychain still answers
 * "Not logged in". Called from the login watch so a completed login becomes
 * readable; idempotent and content-compare before write. Only a USABLE blob
 * (non-empty token, see `readKeychainCredential`) is mirrored; with none in
 * the keychain, a file holding an empty-token shell — debris from an earlier
 * first-match read — is REMOVED, so the runtime says "Not logged in" instead
 * of the misleading "OAuth session expired".
 * @param homeDir - the `claude-code` harness's scoped home.
 * @returns true when the file holds the current keychain credential after the call.
 */
export async function syncClaudeCredentialFile(homeDir: string): Promise<boolean> {
  const file = join(homeDir, '.credentials.json')
  const blob = await readKeychainCredential(homeDir)
  if (blob === undefined) {
    try {
      const existing = await readFile(file, 'utf8')
      if (!credentialUsable(existing)) await rm(file, { force: true })
    } catch {
      // Absent or unreadable: nothing to heal.
    }
    return false
  }
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
 * nests under `claudeAiOauth`. Returns the LATER of the access-token and
 * refresh-token expiries — the CLI refreshes on use, so a live refresh token
 * keeps the credential usable past the access expiry. Undefined when
 * absent/unparseable.
 * @param text - the file contents.
 * @returns the expiry, or undefined.
 */
function credentialFileExpiry(text: string): number | undefined {
  try {
    const parsed = JSON.parse(text) as { claudeAiOauth?: { expiresAt?: unknown; refreshTokenExpiresAt?: unknown } }
    const access = parsed.claudeAiOauth?.expiresAt
    const refresh = parsed.claudeAiOauth?.refreshTokenExpiresAt
    const accessMs = typeof access === 'number' ? access : undefined
    const refreshMs = typeof refresh === 'number' ? refresh : undefined
    if (accessMs === undefined && refreshMs === undefined) return undefined
    return Math.max(accessMs ?? 0, refreshMs ?? 0)
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
  // keychain but reads the file) — and a CLI run refreshes the KEYCHAIN copy
  // without touching the file, so mirror keychain→file before judging, or a
  // refreshed credential still reads expired.
  await syncClaudeCredentialFile(homeDir)
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
