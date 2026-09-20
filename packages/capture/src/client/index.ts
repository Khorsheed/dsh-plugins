/**
 * Capture, browser half: mount-only. There is deliberately NO UI (a settings
 * page was considered and deferred — v1's only caller gesture is the reader's
 * 「渲染抓取」 click, which is itself the approval).
 *
 * The one job: mount this package's generated Remote contribution so the
 * `remote.capture` namespace service exists and callers (the reader pane)
 * can probe and invoke `render`. Without this mount the generated host face
 * is unreachable from the browser: the namespace service is installed by
 * `ctx.remote.$mount`, and no other package may import this one's `/remote`
 * artifact (the client-bundle purity gate forbids cross-plugin value
 * imports).
 *
 * @module @khorsheed/dsh-capture/client
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the generated Remote API and the ctx.remote merge.
import type {} from '@khorsheed/dsh-capture/remote'
import captureRemote from '@khorsheed/dsh-capture/remote'
import type { TypertDisposer, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'

/** The structural slice of the client's remote service this mount needs. */
interface CaptureRemoteMounter {
  $mount(contribution: TypertRemoteContribution): Promise<TypertDisposer>
}

/** No hard requirements: a host without the remote channel simply never mounts. */
export const inject: readonly string[] = []

/**
 * Mount the `capture` Remote namespace and return the disposer.
 *
 * @param ctx - client root context.
 * @returns the teardown for the mounted namespace.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const remote = ctx.get('remote') as CaptureRemoteMounter | undefined
  if (remote === undefined || typeof remote.$mount !== 'function') {
    // A composition with no API remotes (headless, tests) gets no namespace;
    // callers' probes answer undefined, which is the designed degradation.
    return async () => undefined
  }
  try {
    return await remote.$mount(captureRemote)
  } catch (error) {
    // A duplicate mount (two compositions) fails loud here but breaks nothing
    // else: the namespace exists once, which is all callers probe.
    ctx.logger.error(error)
    return async () => undefined
  }
}
