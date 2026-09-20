/**
 * Capture plugin, host half: provides the service core and mounts its Remote
 * face. Composing this plugin out of a profile removes every surface it adds
 * (callers probe `remote.capture` and degrade — the reader hides its
 * 「渲染抓取」 gesture entirely).
 *
 * The host half owns the two things a caller's process cannot do: driving a
 * managed headless Chrome, and persisting the per-site allow record next to
 * the deployment. See `service.ts` for the render pipeline, `browser.ts` for
 * the process model, and `url-policy.ts` for the SSRF gate.
 *
 * @module @khorsheed/dsh-capture
 */
import type { Context } from '@deepseek-ai/cordis'
import { CaptureService, type CaptureConfig } from './service.ts'
import { CaptureRemoteService } from './remote.ts'

export { CaptureBrowserManager } from './browser.ts'
export type { CaptureBrowserConfig, CaptureBrowserDeps, CaptureManagedBrowser } from './browser.ts'
export { QueueBusyError, SerialRenderQueue } from './queue.ts'
export { CaptureRemoteService } from './remote.ts'
export type { CaptureRemoteConfig } from './remote.ts'
export { CaptureService, clampTimeout, waitForQuiescence } from './service.ts'
export type { CaptureConfig, CaptureDeps } from './service.ts'
export {
  CaptureStore,
  emptyCaptureStateDoc,
  isRecordableHost,
  parseCaptureStateDoc,
  resolveCaptureStateRoot,
  serializeCaptureStateDoc,
} from './store.ts'
export * from './types.ts'
export {
  checkNavigationTarget,
  checkResolvedTarget,
  checkUrlSyntax,
  classifyAddress,
  classifyIpv4,
  isIpLiteral,
  parseIpv4,
  parseIpv6Groups,
} from './url-policy.ts'
export type { CaptureAddressClass, CaptureHostLookup, CaptureUrlVerdict } from './url-policy.ts'
export { inlineStylesAndSerialize, scrollSweepPage } from './page-tasks.ts'
export type {
  CaptureSerializeArgs,
  CaptureSerializeResult,
  CaptureSweepArgs,
  CaptureSweepResult,
} from './page-tasks.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The capture plugin's service core. */
    capture: CaptureService
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'capture'

/**
 * Plugin body: provide the service core, then mount the Remote data face.
 *
 * No `static inject`: the package needs no host capability to boot (the
 * browser binary installs lazily on the first render; state degrades to
 * memory-only on an unwritable disk), so the row boots in any composition.
 *
 * @param ctx - owning Cordis context.
 * @param config - optional plugin config.
 */
export function apply(ctx: Context, config: CaptureConfig = {}): void {
  const service = new CaptureService(ctx, config)
  ctx.provide('capture', service)
  ctx.plugin(CaptureRemoteService, {})
  ctx.effect(() => () => {
    void service.dispose()
  }, 'capture: browser shutdown')
}
