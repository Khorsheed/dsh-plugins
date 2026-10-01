/**
 * Deterministic hashing for the eval contract: the condition hash and the
 * scoped-home hash. Both are pure functions of their input — the same input
 * twice must produce the same digest, or "these two cells differ in exactly
 * one factor" is unprovable.
 *
 * File contents feed the home hash but never leave it: nothing here logs,
 * prints, or returns content — only digests and counts.
 */
import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

type Json = Record<string, unknown>

function isPlainObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Canonical JSON: object keys sorted (code-unit order), no whitespace, arrays
 * in order. Two documents that differ only in key order canonicalize alike.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
}

/**
 * Condition fields excluded from the condition hash. `notes` is review
 * commentary carried inside the document: editing it must not mint a new
 * condition. Everything else — every contract field — is hash input.
 */
const CONDITION_HASH_EXCLUDED_KEYS: readonly string[] = ['notes']

/**
 * The condition hash: sha256 hex of the condition document's canonical JSON,
 * minus {@link CONDITION_HASH_EXCLUDED_KEYS}.
 */
export function hashConditionDocument(condition: unknown): string {
  if (!isPlainObject(condition)) throw new TypeError('condition must be a JSON object')
  const body: Json = { ...condition }
  for (const key of CONDITION_HASH_EXCLUDED_KEYS) delete body[key]
  return createHash('sha256').update(canonicalJson(body)).digest('hex')
}

// --- scoped-home hashing ----------------------------------------------------

/** Only config-shaped files are hashed; everything else in a scoped home is cache, binary, or transcript noise. */
const CONFIG_EXTENSIONS: ReadonlySet<string> = new Set([
  '.json', '.jsonc', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf', '.xml', '.properties',
])

/**
 * Files whose NAME matches are never hashed. Beyond the protocol's
 * token/key rule this defensively covers credential-shaped names: hashing a
 * credential file is reading it, which the contract forbids outright.
 */
const DENIED_NAME_RE = /token|key|credential|secret|password|auth|\.env/i

/** Directories skipped whole, together with everything under them. */
const DENIED_DIR_NAMES: ReadonlySet<string> = new Set(['credentials', 'oauth', 'sessions', 'keys', 'secrets'])

/** Config files larger than this are skipped rather than hashed. */
const MAX_FILE_BYTES = 1_000_000

export interface HomeHash {
  /** sha256 hex over the included files' `<relPath>\0<content>\0` stream, sorted by relPath. */
  sha: string
  /** How many config files were hashed. */
  files: number
  /** How many entries were skipped (denied names/dirs, non-config, oversize, symlinks). */
  denied: number
}

/**
 * Hash a scoped home's config content for `home.sha`. Deterministic and
 * credential-safe: the deny list keeps secret-shaped files out of the digest,
 * and no content ever leaves this function.
 */
export async function hashHome(homeDir: string): Promise<HomeHash> {
  const root = await stat(homeDir).then((s) => {
    if (!s.isDirectory()) throw new Error(`not a directory: ${homeDir}`)
    return homeDir
  }, () => {
    throw new Error(`home directory does not exist: ${homeDir}`)
  })

  const included: string[] = [] // relative posix paths, collected then sorted
  let denied = 0
  const walk = async (absDir: string, rel: string): Promise<void> => {
    for (const entry of await readdir(absDir, { withFileTypes: true })) {
      const relChild = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isSymbolicLink()) {
        denied += 1
        continue
      }
      if (entry.isDirectory()) {
        if (DENIED_DIR_NAMES.has(entry.name.toLowerCase())) {
          denied += 1
          continue
        }
        await walk(join(absDir, entry.name), relChild)
        continue
      }
      if (!entry.isFile()) {
        denied += 1
        continue
      }
      const dot = entry.name.lastIndexOf('.')
      const ext = dot === -1 ? '' : entry.name.slice(dot).toLowerCase()
      if (!CONFIG_EXTENSIONS.has(ext) || DENIED_NAME_RE.test(entry.name)) {
        denied += 1
        continue
      }
      const absChild = join(absDir, entry.name)
      const size = (await stat(absChild)).size
      if (size > MAX_FILE_BYTES) {
        denied += 1
        continue
      }
      included.push(relChild)
    }
  }
  await walk(root, '')

  const hash = createHash('sha256')
  for (const rel of [...included].sort()) {
    hash.update(`${rel}\0`)
    hash.update(await readFile(join(root, rel)))
    hash.update('\0')
  }
  return { sha: hash.digest('hex'), files: included.length, denied }
}
