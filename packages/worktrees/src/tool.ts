/**
 * The session-granted `worktrees` model tool — this package's `./tool`
 * composition entry (the canvas `./agent` pattern) for agent-preset
 * compositions. The row provides NO service (the preset-mount isolate-realm
 * rule forbids service rows), it only registers the model-facing `worktrees`
 * tool into the host tools registry, delegating to the global `ctx.worktrees`
 * service core the main row provides at the profile root — the official
 * tool-row shape (the shipped `tool-bash` rows work the same way). Granting
 * is therefore per-session: a preset names the row, its sessions get the
 * tool; every other preset's sessions do not.
 *
 * This entry used to ship as the standalone companion package
 * `@khorsheed/dsh-worktrees-tool` (0.1.x); 0.3.0 folded it back into the core
 * package as this subpath row (the loader mounts a package's non-default
 * export fine — the canvas `./agent` precedent), and the old package name is
 * deprecated on npm. An agent preset's `agent.cordis.yml` references the row
 * by name: `- id: worktrees-tool / name: '@khorsheed/dsh-worktrees/tool'`.
 * The package's own bundle patch mounts ONLY the core row — a profile-root
 * tool row would grant every session, exactly what the split removed.
 *
 * @module @khorsheed/dsh-worktrees/tool
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls this package's `Context.worktrees` service augmentation.
import type {} from './index.ts'
import { defineWorktreesTool } from './tool-definition.ts'

const PACKAGE_NAME = '@khorsheed/dsh-worktrees'

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
 * The `worktrees` core is a declared inject (the owning-family companion
 * exception to the community-service probe rule): a preset's standing scope
 * mounts at registry-activation time, BEFORE the profile's later bundle rows
 * provide the core, so a one-shot ctx.get probe at apply saw ABSENT there and
 * nothing re-ran the row (rc.1 boot order; 3080 production 2026-09-27). The
 * declared inject pends the row until the core provides, then the body
 * applies. The tools registry still joins through deferred injection so its
 * mount order cannot strand the registration.
 */
export const inject = ['worktrees']

/**
 * Plugin body: register the tool. The declared `worktrees` inject pends the
 * row until the core provides, so mount order can no longer strand it; the
 * in-body guard stays as the defensive direct-call path.
 * @param ctx - Cordis context (the preset's agent-plane mount).
 */
export function apply(ctx: Context): void {
  const service = ctx.get('worktrees')
  if (service === undefined) {
    // Degrade, don't explode: the core plugin is not mounted in this
    // profile, so there is nothing to delegate to. The badge/tab UI is the
    // core's own concern and unaffected; only the model tool stays absent.
    ctx.logger.info(`${name}: the global worktrees service is absent — the worktrees tool is not registered`)
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
