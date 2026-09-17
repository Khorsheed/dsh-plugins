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
import { ReaderService } from './service.ts'
import { ReaderRemoteService } from './remote.ts'

export { ReaderService, classifyPayload, normalizeUrl } from './service.ts'
export { ReaderRemoteService } from './remote.ts'
export type { ReaderRemoteConfig } from './remote.ts'
export {
  ReaderStore,
  ReaderStoreError,
  emptyStateDoc,
  normalizeStateDoc,
  resolveReaderStateRoot,
  serializeStateDoc,
} from './store.ts'
export type { ReaderStoreRead } from './store.ts'
export * from './schedule.ts'
export * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The reader plugin's service core. */
    reader: ReaderService
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'reader'

/** Optional state-root override, for deployments that keep state elsewhere. */
export interface ReaderConfig {
  /** Directory holding `state.json`; defaults to `$DSH_HOME/state/dsh-reader`. */
  readonly stateRoot?: string
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
  ctx.plugin(ReaderRemoteService, {})
}
