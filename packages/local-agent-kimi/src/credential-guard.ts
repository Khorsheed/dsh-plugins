/**
 * Kimi credential sentinel. The kimi CLI occasionally wipes
 * `credentials/kimi-code.json` into an empty shell (both tokens zero-length)
 * on its own failure paths — observed twice in production, each time killing
 * every later delegation with "Authentication required" until someone
 * restored the file by hand. The sentinel:
 *
 * - backs the file up whenever a VALID credential is observed (the backup
 *   lives inside `credentials/` so the family's logout — a directory delete —
 *   clears it too);
 * - restores the backup when the file is an exact empty shell (both tokens
 *   empty strings) — the only corruption signature we trust;
 * - logs every state transition with a process snapshot, so the next wipe
 *   can be attributed (which process, at which moment).
 *
 * Restore is deliberately narrow: a revoked-elsewhere credential never takes
 * the empty-shell shape, and a stale backup at worst produces one more loud
 * 401, never silent misbehavior.
 * @module @khorsheed/dsh-local-agent-kimi/credential-guard
 */

import { copyFile, readFile, stat, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { join } from 'node:path'

/** The credential file inside the scoped home, and its sentinel backup. */
const CREDENTIAL_REL = join('credentials', 'kimi-code.json')
const BACKUP_REL = `${CREDENTIAL_REL}.bak`

/** Last observed state signature per home (`${mtimeMs}:${kind}`) — transition logging. */
const lastSeen = new Map<string, string>()

/** One observation of the credential file. */
type CredentialState = 'valid' | 'empty-shell' | 'absent'

/** A one-line process snapshot for wipe attribution (kimi/dsh processes only). */
function processSnapshot(): Promise<string> {
  return new Promise((resolve) => {
    execFile('ps', ['-eo', 'pid,ppid,etime,command'], { timeout: 5_000 }, (error, stdout) => {
      if (error !== null) {
        resolve(`(ps failed: ${error.message})`)
        return
      }
      const lines = stdout.split('\n').filter((line) => /\bkimi\b|dsh/.test(line) && !line.includes('grep')).slice(0, 12)
      resolve(lines.join(' ; '))
    })
  })
}

/** Classify the credential file's current content. */
async function observe(file: string): Promise<{ state: CredentialState; mtimeMs: number }> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return { state: 'absent', mtimeMs: 0 }
  }
  let mtimeMs = 0
  try {
    mtimeMs = (await stat(file)).mtimeMs
  } catch { /* keep 0 */ }
  try {
    const parsed = JSON.parse(raw) as { access_token?: unknown; refresh_token?: unknown }
    const empty = (v: unknown): boolean => typeof v === 'string' && v.length === 0
    if (empty(parsed.access_token) && empty(parsed.refresh_token)) return { state: 'empty-shell', mtimeMs }
    return { state: 'valid', mtimeMs }
  } catch {
    // Unparseable is neither valid nor the known shell: treat as absent and
    // never restore over it (unknown corruption shape — leave it for a human).
    return { state: 'absent', mtimeMs }
  }
}

/**
 * Guard the scoped home's kimi credential: back up a valid file, restore the
 * backup over an empty shell, log transitions.
 * @param homeDir - the `kimi` harness's scoped home.
 * @param log - warn channel (plugin logger when available).
 * @returns true when a usable credential exists after the guard ran.
 */
export async function guardKimiCredential(homeDir: string, log?: (message: string) => void): Promise<boolean> {
  const file = join(homeDir, CREDENTIAL_REL)
  const backup = join(homeDir, BACKUP_REL)
  const { state, mtimeMs } = await observe(file)
  const signature = `${mtimeMs}:${state}`
  const previous = lastSeen.get(homeDir)
  lastSeen.set(homeDir, signature)

  if (state === 'valid') {
    if (previous !== undefined && previous !== signature) {
      log?.(`local-agent-kimi: credential refreshed (mtime ${new Date(mtimeMs).toISOString()}), snapshotting the backup`)
    }
    await writeFile(backup, await readFile(file), { mode: 0o600 })
    return true
  }
  if (state === 'empty-shell') {
    const snapshot = await processSnapshot()
    log?.(`local-agent-kimi: CREDENTIAL EMPTY SHELL detected (mtime ${new Date(mtimeMs).toISOString()}); previous state ${previous ?? 'unknown'}; processes: ${snapshot}`)
    let backupState: CredentialState = 'absent'
    try {
      backupState = (await observe(backup)).state
    } catch { /* absent */ }
    if (backupState === 'valid') {
      await copyFile(backup, file)
      log?.('local-agent-kimi: credential restored from the sentinel backup — the next delegation should succeed')
      return true
    }
    log?.('local-agent-kimi: no usable backup to restore; the harness needs a fresh login')
    return false
  }
  return false
}
