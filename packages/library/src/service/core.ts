/**
 * The library service core layer: the store, change listeners, disposal,
 * the write boundary (`mutate`), the event ledger and the shared refusals.
 *
 * The service is ONE class split by domain into a chain of layers, each in
 * its own file and each extending the one before:
 *
 *   core → shelf (projects, resources) → cards → roadmap (paths, notes,
 *   读完) → pages → assess (quizzes, attempts) → bindings (bindings, events,
 *   stats) = LibraryService
 *
 * A layer may call anything below it. The layering is organization only —
 * `LibraryService` (service.ts re-exports it) is the one public class.
 * Pure rules (shape validation, unlock, the evidence gate) live in
 * `service/rules.ts`.
 *
 * @module @khorsheed/dsh-library/service/core
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  LEITNER_INTERVAL_DAYS,
  libraryErrorMessage,
  MAX_WEAKNESS,
  type LibraryAttachmentRef,
  type LibraryCapabilities,
  type LibraryCard,
  type LibraryErrorCode,
  type LibraryEvent,
  type LibraryEventType,
  type LibraryOutcome,
  type LibraryProject,
  type LibraryRefusal,
} from '../types.ts'
import { LibraryStore, LibraryStoreError } from '../store.ts'


export const PACKAGE_NAME = '@khorsheed/dsh-library'

/** The attachment store's faces, mirrored structurally (probed, never injected). */
export interface AttachmentsSlice {
  readImage(ref: LibraryAttachmentRef): Promise<{ data: Uint8Array; ref: { mediaType: string } }>
  saveImage?(input: { data: Uint8Array; mediaType: string }): Promise<LibraryAttachmentRef>
}

/**
 * Thrown by every public verb after {@link LibraryService.dispose} ran (an
 * explicit teardown, or the borrowed Context's own disposal): a coded,
 * package-named refusal, never a silent operation on a dead Context. The
 * disposed instance stays dead — a rebuild over the same state root is a NEW
 * service instance's business (the canvas-novel/sidechat precedent).
 */
export class LibraryDisposedError extends Error {
  constructor(message: string, readonly code: 'disposed') {
    super(message)
    this.name = 'LibraryDisposedError'
  }
}

/** A refusal in one line. */
export function refuse(error: LibraryErrorCode, message: string): LibraryRefusal {
  return { ok: false, error, message }
}

/** Wrap a store failure as a refusal (the service's error channel is values). */
export function storeRefusal(error: unknown): LibraryRefusal {
  if (error instanceof LibraryStoreError) {
    const code: LibraryErrorCode = error.kind === 'corrupt' ? 'corrupt' : error.kind === 'unavailable' ? 'storage-unavailable' : 'io'
    return refuse(code, error.message)
  }
  return refuse('io', `library: ${libraryErrorMessage(error)}`)
}

const DAY_MS = 24 * 60 * 60 * 1000

/** The Leitner due date for a box: box b waits INTERVALS[min(b, 4)] days. */
export function leitnerDueAt(box: number, from: Date = new Date()): string {
  const days = LEITNER_INTERVAL_DAYS[Math.min(Math.max(box, 0), LEITNER_INTERVAL_DAYS.length - 1)]!
  return new Date(from.getTime() + days * DAY_MS).toISOString()
}

/** Whitespace-normalize a quote before comparing it with a page's text. */
export function normalizeFragment(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** Clamp a weakness score into 0..MAX. */
export function clampWeakness(value: number): number {
  return Math.min(Math.max(value, 0), MAX_WEAKNESS)
}

/** Live = not deleted. */
export function live(card: LibraryCard): boolean {
  return card.status !== 'deleted'
}


/**
 * The library's service core. Constructing it never throws and never touches
 * the disk: the store probes writability lazily, so a read-only deployment
 * boots and answers `storage-unavailable` on writes. Disposal follows the
 * borrowed Context: an instance mounted dynamically (per state root, say)
 * dies with its mounting Context, and a dead instance refuses every verb
 * coded, reads included.
 */
export class LibraryServiceCore {
  /** The store; public for the package's own tests and diagnostics. */
  readonly store: LibraryStore
  /** Listeners told after every project mutation (the tab's live refresh, the context cache). */
  protected readonly listeners = new Set<(projectId: string) => void>()
  /** Set by {@link dispose} (explicit, or the borrowed Context's teardown); every public verb refuses afterwards. */
  protected disposed = false

  constructor(
    protected readonly ctx: Context,
    config: { stateRoot?: string } = {},
  ) {
    this.store = new LibraryStore(config)
    // The borrowed Context's disposal IS this instance's disposal: an
    // instance mounted per state root dies with its mounting Context instead
    // of answering verbs off a dead scope.
    ctx.effect(() => () => { this.dispose() }, 'library: dispose on context teardown')
  }

  /**
   * Refuse one public verb after disposal: the instance is dead and nothing
   * it could still answer is meant to be consumed — reads included, so a
   * mounting side never keeps consuming a stale instance indefinitely.
   */
  protected assertAlive(verb: string): void {
    if (this.disposed) throw new LibraryDisposedError(`${PACKAGE_NAME}: ${verb} after dispose`, 'disposed')
  }

  /**
   * Tear the instance down (also wired to the borrowed Context's disposal at
   * construction). Idempotent and TERMINAL: the listener set is dropped and
   * afterwards every public verb refuses with {@link LibraryDisposedError};
   * a write that already passed the write boundary may complete (the store's
   * lock/temp-write/atomic-rename keeps the disk side safe), one reaching it
   * after disposal refuses before lock acquisition. A rebuild over the same
   * state root is a NEW instance's business.
   */
  dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }

  /**
   * What a client may rely on in this composition: storage availability with
   * its reason, and the attachment probe's verdict at call time. A read-only
   * display contract — enforcement stays at the write gates, unchanged.
   */
  async capabilities(): Promise<LibraryCapabilities> {
    this.assertAlive('capabilities')
    return {
      protocolVersion: 1,
      hasStorage: this.store.available,
      ...(this.store.unavailableReason === undefined ? {} : { storageUnavailableReason: this.store.unavailableReason }),
      hasAttachments: (this.ctx.get('attachments') as AttachmentsSlice | undefined) !== undefined,
    }
  }

  /** Subscribe to project mutations; returns the unsubscribe. */
  onChange(listener: (projectId: string) => void): () => void {
    this.assertAlive('onChange')
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  protected changed(projectId: string): void {
    for (const listener of this.listeners) {
      try {
        listener(projectId)
      } catch {
        // A listener's failure is its own.
      }
    }
  }

  /** Run a project mutation under its lock, then notify. */
  protected async mutate<T>(projectId: string, fn: () => Promise<LibraryOutcome<T>> | LibraryOutcome<T>): Promise<LibraryOutcome<T>> {
    // The write boundary: a disposal that landed since the entry guard dies
    // here, BEFORE the lock is taken — never queuing onto a lock a rebuilt
    // instance on the same root now owns (kept outside the try, so the coded
    // refusal propagates as itself rather than folding into a store refusal).
    this.assertAlive('mutate')
    try {
      const outcome = await this.store.withProjectLock(projectId, fn)
      if (outcome.ok) this.changed(projectId)
      return outcome
    } catch (error) {
      return storeRefusal(error)
    }
  }

  protected event(projectId: string, type: LibraryEventType, fields: Omit<LibraryEvent, 'type' | 'at'> & { at?: string } = {}): void {
    this.store.appendEvents(projectId, [{ at: fields.at ?? new Date().toISOString(), type, ...fields }])
  }

  /* -------------------------------------------------------------- helpers */

  /** The project, or a not-found refusal that teaches where the list lives. */
  protected readProjectOrRefusal(projectId: string): { value: LibraryProject } | (LibraryRefusal & { error: LibraryErrorCode }) {
    let project: LibraryProject | undefined
    try {
      project = this.store.readProject(projectId)
    } catch (error) {
      return storeRefusal(error)
    }
    if (project === undefined) {
      return refuse('not-found', `no project ${JSON.stringify(projectId)} — library_read · projects lists every project; create one with library_project`)
    }
    return { value: project }
  }
}
