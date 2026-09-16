/**
 * Per-session dataset binding, stored as a plugin-owned durable state file:
 * one JSON file per session under the plugin state root
 * (`<stateRoot>/bindings/<encoded-session-id>.json`). Binding WRITES are
 * human operations (slash `/datasets bind`, the web tab, the CLI); agent
 * tools only resolve the binding — which datasets an agent may use is decided
 * by the human, not the agent.
 *
 * WHY NOT a log-only session event (the M1 design): the persistence read
 * path refuses to rebuild a session whose log holds an event type outside
 * the harness's generated KNOWN_SESSION_EVENT_TYPES unless the envelope
 * carries `ignorable: true` — and a downstream (out-of-repo) plugin's event
 * types are outside that set BY CONSTRUCTION (the registration surface is
 * deferred upstream), while `Session.append()` builds the envelope with no
 * way to set the marker. A custom-typed event a community plugin appends is
 * therefore guaranteed to make the session unresumable. The `goal/change`
 * precedent M1 followed is an in-harness plugin whose type sits in the known
 * set; the precedent never transferred downstream. A binding needs
 * per-session durability, not a seat in the model-facing log, so it lives in
 * the plugin's own state. The store is read per call, so a CLI write to a
 * LIVE session's binding is race-free (the M1 offline-append race is gone).
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatasetsError } from './dataset.ts'

/** A session's dataset binding. Absent fields mean "everything in the repo". */
export interface DatasetBinding {
  /**
   * Absolute, `~`-free, symlink-resolved path of the git repository holding
   * the datasets — see {@link normalizeRepoPath}. Every write goes through
   * {@link validateBinding}, so a binding that reached the store is already
   * in this form.
   */
  repoPath: string
  /** Dataset-id whitelist; absent = every dataset in the repository. */
  datasets?: string[]
  /** Layer whitelist; absent = every layer. Enforced on ALL read paths. */
  layers?: string[]
}

/** The durable store record (versioned for future migrations). */
interface BindingRecord {
  readonly version: 1
  readonly binding: DatasetBinding
}

/**
 * The narrow slice of `Session` the binding store needs. Structural, so tests
 * and the CLI path can supply minimal fakes — just the identity the binding
 * is filed under.
 */
export interface BindingSession {
  readonly id: string
}

/**
 * The canonical form of a bound repository path: a leading `~` expanded
 * against this user's home, the result made absolute, and — when the
 * directory is actually there — resolved through its symlinks.
 *
 * WHY the store holds this rather than what the human typed: a bound path is
 * consumed by `git -C`, by `readdir(<repo>/datasets)`, and by containment
 * checks comparing it against a session's realpath cwd. None of those expand
 * `~` (the shell does, and no shell is in the loop when the web tab writes a
 * binding), so a stored `~/x` reaches git as a literal directory named `~`
 * and the tab reports "not a git repository" about a repository that exists.
 * Resolving symlinks at the same time keeps `/tmp` vs `/private/tmp` from
 * making two names for one repository compare unequal.
 *
 * A path that does not exist yet keeps its absolute form rather than failing:
 * normalizing is not the existence check (`assertRepository` is), and a
 * binding to an unmounted volume must still round-trip.
 * @param raw - the path as typed, passed, or read back from an old record.
 * @returns the canonical path; '' stays '' for the caller's shape check.
 */
export function normalizeRepoPath(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === '') return trimmed
  const expanded = trimmed === '~' || trimmed.startsWith('~/')
    ? join(homedir(), trimmed.slice(1))
    : trimmed
  const absolute = resolve(expanded)
  try {
    return realpathSync(absolute)
  } catch {
    return absolute
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string' && entry !== '')
}

/**
 * Validate a binding object (from a store record, CLI flags, or a tool
 * caller) and put its `repoPath` in canonical form.
 *
 * Normalizing HERE rather than at each call site is what makes the guarantee
 * hold: every write goes through this function, and so does every read (see
 * {@link readBinding}), so no consumer has to remember to expand `~` and none
 * of them can disagree about what the bound path means.
 * @param value - the candidate binding.
 * @returns the validated binding, `repoPath` normalized.
 */
export function validateBinding(value: unknown): DatasetBinding {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DatasetsError('binding must be an object {repoPath, datasets?, layers?}', 'SHAPE_INVALID')
  }
  const record = value as Record<string, unknown>
  const repoPath = record['repoPath']
  if (typeof repoPath !== 'string' || repoPath.trim() === '') {
    throw new DatasetsError('binding requires a non-empty "repoPath"', 'SHAPE_INVALID')
  }
  const datasets = record['datasets']
  if (datasets !== undefined && !isStringArray(datasets)) {
    throw new DatasetsError('binding "datasets" must be an array of dataset ids', 'SHAPE_INVALID')
  }
  const layers = record['layers']
  if (layers !== undefined && !isStringArray(layers)) {
    throw new DatasetsError('binding "layers" must be an array of layer names', 'SHAPE_INVALID')
  }
  return {
    repoPath: normalizeRepoPath(repoPath),
    ...(datasets !== undefined ? { datasets: [...datasets] } : {}),
    ...(layers !== undefined ? { layers: [...layers] } : {}),
  }
}

/** Path-safe encoding of one directory segment (mirrors the persistence backend's). */
export function encodeSegment(raw: string): string {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      out += ch
    } else {
      out += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
    }
  }
  return out
}

/** The store file of one session's binding. */
function bindingPath(root: string, sessionId: string): string {
  return join(root, `${encodeSegment(sessionId)}.json`)
}

/**
 * Read a session's current binding from the store. A missing file means
 * unbound; a corrupt or shape-invalid file fails loud (a hand-edited store
 * must not silently drop the session's access governance).
 *
 * A record written before `repoPath` was normalized (a literal `~`, a
 * trailing slash, a relative path) is migrated IN PLACE on this read: the
 * caller gets the canonical path and the file stops being a trap for the next
 * reader. The write-back is best effort — a store we may not write to still
 * answers the read correctly.
 * @param root - the bindings root (`<stateRoot>/bindings`).
 * @param sessionId - the session.
 * @returns the binding, or undefined when none is in effect.
 */
export function readBinding(root: string, sessionId: string): DatasetBinding | undefined {
  const path = bindingPath(root, sessionId)
  if (!existsSync(path)) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new DatasetsError(`${path}: invalid JSON — ${String(error)}`, 'SHAPE_INVALID')
  }
  const record = parsed as Partial<BindingRecord> | null
  if (typeof record !== 'object' || record === null || record.version !== 1) {
    throw new DatasetsError(`${path}: unknown binding record shape`, 'SHAPE_INVALID')
  }
  const stored = (record.binding as { repoPath?: unknown } | undefined)?.repoPath
  const binding = validateBinding(record.binding)
  if (stored !== binding.repoPath) {
    try {
      writeBinding(root, sessionId, binding)
    } catch {
      // Migration is a courtesy to the next reader, never this read's problem.
    }
  }
  return binding
}

/**
 * Write a session's binding (null unbinds by removing the record). The write
 * is atomic (tmp file + rename) and validated, so a crashed write never
 * leaves a torn record and an invalid binding never enters the store.
 * @param root - the bindings root (`<stateRoot>/bindings`).
 * @param sessionId - the session to bind.
 * @param binding - the new binding, or null to unbind.
 * @returns the validated binding that was recorded, or null on unbind.
 */
export function writeBinding(root: string, sessionId: string, binding: DatasetBinding | null): DatasetBinding | null {
  const path = bindingPath(root, sessionId)
  if (binding === null) {
    rmSync(path, { force: true })
    return null
  }
  const validated = validateBinding(binding)
  const record: BindingRecord = { version: 1, binding: validated }
  mkdirSync(root, { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  renameSync(tmp, path)
  return validated
}
