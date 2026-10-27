/**
 * Reader plugin, host half: provides the service core and mounts its Remote
 * face. Composing this plugin out of a profile removes every surface it adds.
 *
 * The host half owns the two things the browser cannot do: reaching the
 * network through the sanctioned `ctx.web` seam, and persisting state next to
 * the deployment. The browser half owns parsing. See `service.ts` for the
 * fetch policy and `store.ts` for the persistence shape; both are deliberately
 * mirrored on the side-chat precedent so this package reads like its
 * neighbours.
 *
 * @module @khorsheed/dsh-reader
 */
import type { Context } from '@deepseek-ai/cordis'
import type { DocumentFetchLimits } from './document-fetch.ts'
import { ReaderService } from './service.ts'
import { ReaderNotesStore } from './notes.ts'
import { ReaderRemoteService } from './remote.ts'

export { ReaderService, classifyPayload, normalizeUrl } from './service.ts'
export { ReaderRemoteService } from './remote.ts'
export type { ReaderRemoteConfig } from './remote.ts'
export {
  MAX_CACHED_BODIES,
  MAX_TAGS,
  ReaderStore,
  ReaderStoreError,
  boundAnnotations,
  boundPayloads,
  emptyStateDoc,
  normalizeStateDoc,
  pruneOrphanTags,
  resolveReaderStateRoot,
  serializeStateDoc,
} from './store.ts'
export type { ReaderStoreRead } from './store.ts'
export * from './notes.ts'
export * from './schedule.ts'
export * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The reader plugin's service core. */
    reader: ReaderService
    /** The reader's notes, discussions and article snapshots. */
    readerNotes: ReaderNotesStore
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'reader'

/** Optional state-root override, for deployments that keep state elsewhere. */
export interface ReaderConfig {
  /** Directory holding `state.json`; defaults to `$DSH_HOME/state/dsh-reader`. */
  readonly stateRoot?: string
  /** A yt-dlp binary to use instead of the reader's managed copy (video metadata and captions). */
  readonly ytdlpPath?: string
  /**
   * Fetch limits for feeds and pages: `maxResponseBytes` (default 5 000 000),
   * `maxBodyChars` (2 000 000 — whole pages, not the row's model-sized 100 000),
   * `timeoutMs` (30 000), `maxRedirects` (5). The reader fetches through its own
   * instance of the official `http` provider, so limits raised on that row do
   * not reach it; set them here.
   */
  readonly fetchLimits?: DocumentFetchLimits
}

/**
 * Plugin body: provide the service core, then mount the Remote data face.
 *
 * No `static inject`: every optional capability (`fs`, `web`, `sideChat`) is
 * probed at the point of use, so the row boots in any composition and degrades
 * — memory-only state without `fs`, `unsupported-content` without `web`, a
 * hidden side-chat gesture without `sideChat`.
 *
 * @param ctx - owning Cordis context.
 * @param config - optional plugin config.
 */
export function apply(ctx: Context, config: ReaderConfig = {}): void {
  const service = new ReaderService(ctx, config)
  ctx.provide('reader', service)
  ctx.provide('readerNotes', new ReaderNotesStore(config))
  ctx.plugin(ReaderRemoteService, {})
}
