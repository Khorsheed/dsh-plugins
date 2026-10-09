/**
 * Request-inspector, browser half (M0 stub): mounts this package's generated
 * Remote contribution so `remote.requestInspector` exists. The panel surfaces
 * (right-sidebar tab, turn action-row icon, session-header utility) land with
 * the client milestone; the mount comes first so the wire is testable on its
 * own.
 *
 * @module @khorsheed/dsh-request-inspector/client
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the generated Remote API and the ctx.remote merge.
import type {} from '@khorsheed/dsh-request-inspector/remote'
import requestInspectorRemote from '@khorsheed/dsh-request-inspector/remote'
import type { TypertDisposer, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'

/** The structural slice of the client's remote service this mount needs. */
interface RequestInspectorRemoteMounter {
  $mount(contribution: TypertRemoteContribution): Promise<TypertDisposer>
}

/** No hard requirements: a host without the remote channel simply never mounts. */
export const inject: readonly string[] = []

/**
 * Mount the `requestInspector` Remote namespace and return the disposer.
 *
 * @param ctx - client root context.
 * @returns the teardown for the mounted namespace.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const remote = ctx.get('remote') as RequestInspectorRemoteMounter | undefined
  if (remote === undefined || typeof remote.$mount !== 'function') {
    // A composition with no API remotes (headless, tests) gets no namespace;
    // the panel surfaces degrade to empty states by design.
    return async () => undefined
  }
  try {
    return await remote.$mount(requestInspectorRemote)
  } catch (error) {
    // A duplicate mount (two compositions) fails loud here but breaks nothing
    // else: the namespace exists once, which is all callers probe.
    ctx.logger.error(error)
    return async () => undefined
  }
}
