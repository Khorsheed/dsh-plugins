/**
 * The session-granted `worktrees` model tool — the companion row of
 * `@khorsheed/dsh-worktrees` for agent-preset compositions. The row provides
 * NO service (the preset-mount isolate-realm rule forbids service rows), it
 * only registers the model-facing `worktrees` tool into the host tools
 * registry, delegating to the global `ctx.worktrees` service core the main
 * plugin provides at the profile root — the official tool-row shape (the
 * shipped `tool-bash` rows work the same way). Granting is therefore
 * per-session: a preset names the row, its sessions get the tool; every
 * other preset's sessions do not.
 *
 * The package deliberately declares NO `dsh.bundle` patch: installing it as
 * a dependency only makes the module resolvable (a plain dependency, like
 * `@khorsheed/dsh-local-agent-dsh-headless`); an agent preset's
 * `agent.cordis.yml` references the row by name.
 *
 * @module @khorsheed/dsh-worktrees-tool
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the core's `Context.worktrees` service augmentation.
import type {} from '@khorsheed/dsh-worktrees'
import { defineWorktreesTool } from '@khorsheed/dsh-worktrees/tool'

const PACKAGE_NAME = '@khorsheed/dsh-worktrees-tool'

/**
 * Tag the model-visible tool with its origin (AGENTS.md § Tool origin
 * tagging; seam S12): the capability catalog reads this `Symbol.for`-keyed
 * tag back through `ctx.tools.get()`, so the `worktrees` tool attributes to
 * THIS package (the row the preset mounts), not to the service core. The tag
 * is host-side only and never travels on the model wire.
 */
const definePluginTool = <T extends object>(def: T): T =>
  Object.assign(def, {
    [Symbol.for('dsh.tool.origin')]: { channel: 'plugin', owner: PACKAGE_NAME },
  })

/** Cordis plugin name used by loader diagnostics. */
export const name = 'worktrees-tool'

/**
 * No hard injects: the `worktrees` service belongs to another package and is
 * PROBED at apply time (community-service inject discipline — inject only
 * inside the owning family), and the tools registry joins through deferred
 * injection so mount order can never strand the row. A preset naming this
 * row therefore mounts cleanly in every composition.
 */
export const inject = []

/**
 * Plugin body: register the tool when the service core is present, degrade
 * to a no-op when it is not.
 * @param ctx - Cordis context (the preset's agent-plane mount).
 */
export function apply(ctx: Context): void {
  const service = ctx.get('worktrees')
  if (service === undefined) {
    // Degrade, don't explode: the core plugin is not mounted in this
    // profile, so there is nothing to delegate to. The badge/tab UI is the
    // core's own concern and unaffected; only the model tool stays absent.
    ctx.logger.info(`${PACKAGE_NAME}: the global worktrees service is absent — the worktrees tool is not registered`)
    return
  }
  // Deferred injection, NOT an apply-time probe: `ctx.get('tools')` races the
  // tools registry's own mount order on the real composition tree and loses,
  // silently never registering the tool. `ctx.inject` fires when the
  // registry appears and never fires in a composition without one.
  ctx.inject(['tools'], (toolsCtx) => {
    toolsCtx.effect(
      () => toolsCtx.tools.register(definePluginTool(defineWorktreesTool(service))),
      'worktrees-tool: worktrees tool',
    )
  })
}
