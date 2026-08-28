/**
 * Package-owned invariant companion for `@khorsheed/dsh-local-agent-dsh-headless`.
 * @module @khorsheed/dsh-local-agent-dsh-headless/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@khorsheed/dsh-local-agent-dsh-headless'

/** Cordis companion plugin name. */
export const name = 'local-agent-dsh-headless-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * Composition guard: this bundle is sub-profile-only. Its patch rows
 * (persona override, `hmr` off, `tools` mode, the `code-runtime` insert, the
 * member-bridge MCP row) collide with or leak into any Host/web composition —
 * 2026-08-23 P0: reconciled into the prod web profile as a direct dependency
 * (reconcilePlugins auto-mounts every `dsh.bundle`-declaring direct dep), the
 * `code-runtime` insert hit the web-app row's duplicate entry id and the
 * whole instance failed to boot. The loader's duplicate-id failure is loud
 * but cryptic, and only fires when the ids collide; this invariant is the
 * CLEAR failure for the non-colliding case (e.g. an upstream row rename would
 * otherwise leak the persona override into real user sessions). The web
 * layer's `webStartup` service is the marker: in-box bundles mount before
 * dependency-managed ones, so it is already provided when this companion
 * applies.
 */
const install: InvariantInstaller = (ctx, fail) => {
  // Duck-typed global-store read: the web marker is not a dependency of this
  // package, so no typed Context merge exists for it.
  const probe = ctx as unknown as { get(name: string): unknown }
  if (probe.get('webStartup') !== undefined) {
    fail(
      'mounted into a web composition — this bundle is sub-profile-only. '
      + 'Remove it from the profile’s direct dependencies: the parent '
      + 'local-agent-dsh bundle installs it transitively, and the '
      + 'sub-profile symlink resolves from that closure',
    )
  }
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
