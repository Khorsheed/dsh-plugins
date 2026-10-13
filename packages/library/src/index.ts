/**
 * Library plugin, host half: provides the service core and mounts its Remote
 * face. Composing this plugin out of a profile removes every surface it adds.
 *
 * The host half owns the two things the browser cannot do: persisting state
 * next to the deployment (`$DSH_HOME/state/dsh-library`, plain `node:fs` — the
 * reader precedent; `ctx.fs` is the session-fenced sandbox and refuses it) and
 * the attachment store (saving sidebar photos, reading page photos back). The
 * browser half renders.
 *
 * The model face (library_read / library_write / library_assess, the coach
 * prompt section, the per-turn bound context) is deliberately NOT here: it is the
 * `./tool` composition entry (`src/tool.ts`), which an agent preset names —
 * the evaluation-family fold pattern.
 *
 * @module @khorsheed/dsh-library
 */
import type { Context } from '@deepseek-ai/cordis'
import { LibraryService } from './service.ts'
import { LibraryRemoteService } from './remote.ts'

export { LibraryService, LibraryDisposedError, leitnerDueAt, unlockReady, validateRoadmapShape } from './service.ts'
export { cardKey, cardKeys, cardMatchesQuery, exactMatch, keySimilarity, nearMatches, NEAR_DUPLICATE } from './cards.ts'
export { LibraryRemoteService } from './remote.ts'
export type { LibraryRemoteConfig } from './remote.ts'
export {
  acquireLibraryLock,
  assertLibraryId,
  emptyLibraryIndex,
  LibraryStore,
  LibraryStoreError,
  mintLibraryId,
  normalizeAttachmentRef,
  normalizeAttempt,
  normalizeBindings,
  normalizeBook,
  normalizeCard,
  normalizeEvent,
  normalizePage,
  normalizeLibraryIndex,
  normalizeProject,
  normalizeQuiz,
  normalizeResource,
  normalizeRoadmap,
  resolveLibraryStateRoot,
} from './store.ts'
export * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The library plugin's service core. */
    library: LibraryService
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'library'

/** Optional state-root override, for deployments that keep state elsewhere. */
export interface LibraryConfig {
  /** Directory holding `state.json`; defaults to `$DSH_HOME/state/dsh-library`. */
  readonly stateRoot?: string
}

/**
 * Plugin body: provide the service core, then mount the Remote data face.
 *
 * No `static inject`: every optional capability (`attachments`) is probed at
 * the point of use, so the row boots in any composition and degrades —
 * `unavailable`/`storage-unavailable` refusals instead of a boot failure.
 *
 * @param ctx - owning Cordis context.
 * @param config - optional plugin config.
 */
export function apply(ctx: Context, config: LibraryConfig = {}): void {
  const service = new LibraryService(ctx, config)
  ctx.provide('library', service)
  ctx.plugin(LibraryRemoteService, {})
}
