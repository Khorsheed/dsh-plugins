/**
 * The worktree-binding vocabulary and its persistence store. A binding is the
 * per-session active-worktree override the service core already keeps in
 * memory; this module gives it a wire-friendly shape (the controlled switch's
 * receipt taxonomy), a resolved state root (the sidechat/canvas
 * `resolveXStateRoot` precedent), and a small write-through JSON store.
 *
 * The store is deliberately a plain `node:fs/promises` write-through against
 * the plugin's OWN state directory — the same bare-fs reach canvas already
 * uses for state-dir operations `ctx.fs` cannot express. It does not go
 * through the session-stamped sandbox fence: bindings key plain session ids,
 * and in the seam's consuming topology those ids are not host `Session`
 * objects a `sandboxPolicy.resolve({ session })` chain could read, so no
 * session-stamped policy can be resolved for them. CAS semantics are
 * SINGLE-PROCESS: the in-process map is the compare-and-swap state and the
 * file is its write-through image — there is no cross-process locking, and
 * two hosts sharing one state root can clobber each other's file (documented,
 * never hidden).
 *
 * @module @khorsheed/dsh-worktrees
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** The state dir's own name under `$DSH_HOME/state/` (the datasets precedent). */
export const WORKTREES_STATE_DIR_NAME = 'worktrees'

/** The bindings file's own name under the state root. */
export const WORKTREES_BINDINGS_FILE_NAME = 'bindings.json'

/**
 * Resolve the worktrees state root (the sidechat/canvas precedent): an
 * explicit value wins, then `$DSH_HOME/state/worktrees`, then
 * `<cwd>/.dsh-worktrees`.
 * @param configured - plugin-provided override, or ''/undefined.
 * @returns the state root directory.
 */
export function resolveWorktreesStateRoot(configured: string | undefined): string {
  if (configured !== undefined && configured !== '') return configured
  const home = process.env.DSH_HOME
  if (home !== undefined && home !== '') return join(home, 'state', WORKTREES_STATE_DIR_NAME)
  return join(process.cwd(), '.dsh-worktrees')
}

/**
 * A session's worktree binding as the agent-free surface sees it. The surface
 * never reads the session's static `header.cwd` (that would take the very
 * agent lookup the seam exists to avoid), so "no override" is reported as
 * `none` — the session falls back to its own static cwd, which is usually the
 * repository's main checkout but is not the surface's fact to assert.
 */
export type WorktreeBinding =
  /** An override is recorded: the session's data face points at this worktree path. */
  | { kind: 'override', path: string }
  /** No override is recorded: the session follows its own static cwd. */
  | { kind: 'none' }

/** The controlled switch's request: the target worktree plus the caller's believed current binding. */
export interface ControlledSwitchRequest {
  /**
   * Absolute path of the worktree to bind the session to. The repository is
   * resolved from THIS path (a path anywhere inside the target worktree), so
   * the caller needs no separate repo anchor.
   */
  path: string
  /**
   * The caller's believed current binding — the compare half of the
   * compare-and-swap. `undefined` (key absent) means NO check: the switch is
   * last-write-wins within the single process, exactly like the legacy verb.
   * A present value — `{ kind: 'override', path }` or `{ kind: 'none' }` for
   * "no override recorded" — must match the actual current binding or the
   * switch refuses with a `conflict` receipt that carries the actual binding.
   */
  expected?: WorktreeBinding
}

/** The controlled switch succeeded; the receipt is returned only after persistence (when on) succeeded. */
export interface ControlledSwitchSwitched {
  kind: 'switched'
  sessionId: string
  /** The switched-to worktree (the same shape `listWorktrees` rows carry). */
  worktree: import('./service.ts').WorktreeInfo
  /** The effective binding after the switch (always the override just set). */
  binding: WorktreeBinding
  /**
   * Whether the binding was written through to the state file BEFORE this
   * receipt was returned. `false` means the deployment runs memory-only (no
   * state root configured, or the state file failed to load and is left
   * untouched): the switch holds for this process but does not survive a
   * restart — an honest signal, never a silent downgrade.
   */
  persisted: boolean
}

/** The caller's `expected` did not match the actual binding; nothing was switched. */
export interface ControlledSwitchConflict {
  kind: 'conflict'
  sessionId: string
  /** The believed binding the caller presented. */
  expected: WorktreeBinding
  /** The ACTUAL current binding — the conflict receipt's whole point. */
  actual: WorktreeBinding
}

/** The target path is not inside a git repository at all. */
export interface ControlledSwitchNotARepo {
  kind: 'not-a-repo'
  path: string
}

/** The target path is inside a repository but is not one of its registered worktree roots. */
export interface ControlledSwitchNoWorktree {
  kind: 'no-worktree'
  path: string
  /** The repository the path resolved to (the worktree registry that was consulted). */
  repo: string
}

/** The request itself is malformed (empty session id, non-absolute path, bad `expected`); nothing was consulted. */
export interface ControlledSwitchInvalidRequest {
  kind: 'invalid-request'
  /** Human-readable reason (which rule the request broke). */
  reason: string
}

/**
 * Persistence was ON but the write-through failed; the in-memory map was left
 * untouched, so memory and the state file still agree on the PREVIOUS binding
 * — the failure is typed and loud, never a fake success.
 */
export interface ControlledSwitchPersistenceFailed {
  kind: 'persistence-failed'
  sessionId: string
  /** The worktree path the switch would have bound to. */
  path: string
  /** The underlying IO error's message. */
  message: string
}

/**
 * The controlled switch's typed receipt union. Every outcome is data — the
 * verb never throws for an expected failure — so a trusted caller can branch
 * on `kind` without a try/catch taxonomy of its own.
 */
export type ControlledSwitchReceipt =
  | ControlledSwitchSwitched
  | ControlledSwitchConflict
  | ControlledSwitchNotARepo
  | ControlledSwitchNoWorktree
  | ControlledSwitchInvalidRequest
  | ControlledSwitchPersistenceFailed

/** The payload of the `worktrees/switched` cordis event: a session's binding was SET to a worktree override. */
export interface WorktreeSwitchedEvent {
  sessionId: string
  /** The worktree path the session is now bound to (the canonical path from `git worktree list`). */
  path: string
}

/** The cordis event name emitted on every successful binding set (in-process event, NOT a browser push). */
export const WORKTREES_SWITCHED_EVENT = 'worktrees/switched'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A session's worktree binding was SET to a worktree override (the legacy
     * switch/create and the controlled switch alike). In-process only — NOT a
     * browser push; bridging or re-reading on it is the consumer's job.
     * @param event - the session and the worktree path it is now bound to.
     * @mode emit
     */
    'worktrees/switched': (event: WorktreeSwitchedEvent) => void
  }
}

/**
 * Structural check for a wire-arriving `expected` value (the Remote boundary
 * trusts nothing: a malformed value is an `invalid-request`, not a crash).
 * @param value - the candidate binding.
 * @returns true when the value is a well-formed {@link WorktreeBinding}.
 */
export function isWorktreeBinding(value: unknown): value is WorktreeBinding {
  if (typeof value !== 'object' || value === null) return false
  const record = value as { kind?: unknown, path?: unknown }
  if (record.kind === 'none') return true
  return record.kind === 'override' && typeof record.path === 'string' && record.path !== ''
}

/** The on-disk document: one version-guarded JSON object, read and written as a whole. */
interface WorktreeBindingsDoc {
  version: 1
  /** session id → worktree path. */
  bindings: Record<string, string>
}

/** The document as one JSON text (the canvas board's trailing-newline shape). */
function serializeDoc(bindings: ReadonlyMap<string, string>): string {
  const doc: WorktreeBindingsDoc = { version: 1, bindings: Object.fromEntries(bindings) }
  return `${JSON.stringify(doc, null, 2)}\n`
}

/**
 * Parse the document STRICTLY: the envelope must be a version-1 object and
 * every entry a string → string pair. Anything else reads as corrupt — the
 * store then refuses persistence entirely rather than rewriting a file it
 * could not fully read (never clobber, the sidechat/canvas rule).
 */
function parseDoc(raw: string): WorktreeBindingsDoc {
  const value: unknown = JSON.parse(raw)
  if (typeof value !== 'object' || value === null) throw new Error('not an object')
  const doc = value as { version?: unknown, bindings?: unknown }
  if (doc.version !== 1) throw new Error('unknown version')
  if (typeof doc.bindings !== 'object' || doc.bindings === null || Array.isArray(doc.bindings)) {
    throw new Error('bindings is not a record')
  }
  for (const [key, entry] of Object.entries(doc.bindings)) {
    if (typeof entry !== 'string' || key === '') throw new Error('bindings entries must be string → string')
  }
  return doc as WorktreeBindingsDoc
}

/** Thrown when a write is attempted while persistence is unavailable. */
export class WorktreeBindingStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorktreeBindingStoreError'
  }
}

/**
 * The bindings file's IO core: a small write-through JSON store under the
 * resolved state root. Stateless apart from the state root and the
 * availability verdict of its one {@link load}; the in-process map it mirrors
 * lives in the service core.
 */
export class WorktreeBindingStore {
  /** The resolved state root this store fences at. */
  readonly stateRoot: string

  /**
   * Whether persistence is usable. Set by {@link load}: a missing or cleanly
   * parsed file is available; a corrupt one or an IO failure is NOT — the
   * store stays read-never-write so a corrupt file is never clobbered (an
   * operator's hand-edit or a foreign format stays visible until fixed).
   */
  private persistenceAvailable = false

  /** @param stateRoot - the already-resolved state root (see {@link resolveWorktreesStateRoot}). */
  constructor(stateRoot: string) {
    this.stateRoot = stateRoot
  }

  /** The bindings file's absolute path. */
  get file(): string {
    return join(this.stateRoot, WORKTREES_BINDINGS_FILE_NAME)
  }

  /** Whether persistence is usable (see the field's note; valid after {@link load}). */
  get available(): boolean {
    return this.persistenceAvailable
  }

  /**
   * Read the bindings file once. A missing file loads as empty with
   * persistence available (the first write creates it); a corrupt or
   * unreadable file loads as empty with persistence UNAVAILABLE — the service
   * then runs memory-only and says so on every receipt, and the file is left
   * exactly as found.
   * @returns the availability verdict and the loaded bindings.
   */
  async load(): Promise<{ available: boolean, bindings: Map<string, string> }> {
    let raw: string
    try {
      raw = await readFile(this.file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.persistenceAvailable = true
      }
      return { available: this.persistenceAvailable, bindings: new Map() }
    }
    try {
      const doc = parseDoc(raw)
      this.persistenceAvailable = true
      return { available: true, bindings: new Map(Object.entries(doc.bindings)) }
    } catch {
      return { available: false, bindings: new Map() }
    }
  }

  /**
   * Write the whole bindings map through to the state file (tmp-file +
   * rename, so a crash mid-write never leaves a torn file). A write failure
   * throws — the caller decides the honest receipt/error, and the in-memory
   * map is only ever mutated AFTER this call succeeds, so memory and the file
   * never diverge silently.
   * @param bindings - the full session id → worktree path map to publish.
   * @throws {WorktreeBindingStoreError} when persistence is unavailable, or the underlying IO error.
   */
  async persist(bindings: ReadonlyMap<string, string>): Promise<void> {
    if (!this.persistenceAvailable) {
      throw new WorktreeBindingStoreError(
        `worktrees: persistence is unavailable — the state file ${this.file} failed to load; fix or remove it by hand`,
      )
    }
    await mkdir(this.stateRoot, { recursive: true })
    const tmp = join(this.stateRoot, `.${WORKTREES_BINDINGS_FILE_NAME}.${process.pid}.tmp`)
    await writeFile(tmp, serializeDoc(bindings), 'utf8')
    await rename(tmp, this.file)
  }
}
