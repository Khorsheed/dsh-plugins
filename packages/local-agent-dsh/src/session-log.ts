/**
 * Locating one sub-dsh session's log file inside its session directory.
 *
 * The host's JSONL persistence backend addresses its logs by SESSION FORMAT
 * GENERATION: version zero keeps the original `session.jsonl`, and every later
 * generation carries a lowercase `vN` component — `session.v3.jsonl` on host
 * 0.1.5. Either basename may additionally carry `.zstd` for the compressed
 * default. The backend itself "selects the numerically highest canonical
 * generation", and so does this module: a reader that hardcodes one filename
 * reads nothing the moment the host advances a generation, which is exactly
 * how a 0.1.5 sub-dsh round lost its observed model, its usage and its tool
 * calls at once while still settling `completed`.
 *
 * Both readers in this package — the session mirror's read-back and the
 * `/dsh sessions` records adapter — resolve through here, so the two can never
 * disagree about which file a session's history lives in.
 * @module @khorsheed/dsh-local-agent-dsh/session-log
 */

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * The canonical raw-log basename, matched AFTER any compression suffix is
 * removed. Deliberately the host's own rule, character for character
 * (`@deepseek-ai/dsh-session-format`): `.v0`, leading zeros, uppercase and
 * temporary names are NOT canonical generations, and a reader that accepted
 * them would read a file the writer never published.
 */
const CANONICAL_LOG_FILENAME = /^session(?:\.v([1-9][0-9]*))?\.jsonl$/u

/** One session directory's chosen log file. */
export interface DshSessionLog {
  /** Absolute path to the file. */
  readonly path: string
  /**
   * Its basename — carried into the read-back result so a record says which
   * generation it was read from, rather than leaving a future filename change
   * to look like an empty session.
   */
  readonly filename: string
  /** The generation the name encodes; 0 is the original unversioned log. */
  readonly version: number
  /** Whether the bytes are zstd-compressed (the backend's default). */
  readonly compressed: boolean
}

/**
 * Read the generation one session-directory entry names.
 * @param filename - one basename from a session directory.
 * @returns its generation and encoding, or undefined when the name is not a
 *   canonical log (`session.lock`, a temporary file, `session.v0.jsonl`, …).
 */
export function parseDshSessionLogFilename(
  filename: string,
): { readonly version: number; readonly compressed: boolean } | undefined {
  const compressed = filename.endsWith('.zstd')
  const raw = compressed ? filename.slice(0, -'.zstd'.length) : filename
  const match = CANONICAL_LOG_FILENAME.exec(raw)
  if (match === null) return undefined
  if (match[1] === undefined) return { version: 0, compressed }
  const version = Number(match[1])
  return Number.isSafeInteger(version) ? { version, compressed } : undefined
}

/**
 * Choose the log file of one session directory: the numerically HIGHEST
 * canonical generation present, preferring the compressed artifact when a
 * generation somehow has both (the backend writes one per its configured
 * encoding, so the pair only appears when a store changed settings).
 *
 * A directory with no canonical log — including one that holds only a
 * `session.lock` — yields undefined. Absence is reported, never guessed: a
 * caller that cannot find a log records nothing rather than inventing an empty
 * history.
 * @param dir - the session-owned directory.
 * @returns the chosen log, or undefined when the directory holds none.
 */
export async function resolveDshSessionLog(dir: string): Promise<DshSessionLog | undefined> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return undefined
  }
  let best: DshSessionLog | undefined
  for (const filename of entries) {
    const parsed = parseDshSessionLogFilename(filename)
    if (parsed === undefined) continue
    // Higher generation wins; within one generation the compressed artifact
    // is the backend's default, so it wins a tie.
    if (best !== undefined) {
      if (parsed.version < best.version) continue
      if (parsed.version === best.version && !(parsed.compressed && !best.compressed)) continue
    }
    best = { path: join(dir, filename), filename, ...parsed }
  }
  return best
}
