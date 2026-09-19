/**
 * The session-granted room model tools — the companion row of
 * `@khorsheed/dsh-room` for agent-preset compositions. The row provides NO
 * service (the preset-mount isolate-realm rule forbids service rows), it
 * only registers the model-facing `room_invite` / `room_task` /
 * `room_message` tools into the host tools registry, delegating to the
 * global `ctx.room` service the main plugin provides at the profile root —
 * the official tool-row shape (the shipped `tool-bash` rows consume host
 * services the same way). Granting is therefore per-session: a preset names
 * the row, its sessions get the tools; every other preset's sessions do not.
 *
 * The package deliberately declares NO `dsh.bundle` patch: installing it as
 * a dependency only makes the module resolvable (a plain dependency, like
 * `@khorsheed/dsh-local-agent-dsh-headless`); an agent preset's
 * `agent.cordis.yml` references the row by name.
 *
 * @module @khorsheed/dsh-room-tool
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the core's `Context.room` service augmentation.
import type {} from '@khorsheed/dsh-room'
import { roomInviteTool, roomMessageTool, roomTaskTool, roomReadTool } from '@khorsheed/dsh-room/tool'

const PACKAGE_NAME = '@khorsheed/dsh-room-tool'

/**
 * Tag the model-visible tools with their origin (AGENTS.md § Tool origin
 * tagging; seam S12): the capability catalog reads this `Symbol.for`-keyed
 * tag back through `ctx.tools.get()`, so the room tools attribute to THIS
 * package (the row the preset mounts), not to the service core. The tag is
 * host-side only and never travels on the model wire. Generic form (not
 * `typeof defineTool`, which trips typert TS2321).
 */
const definePluginTool = <T extends object>(def: T): T =>
  Object.assign(def, {
    [Symbol.for('dsh.tool.origin')]: { channel: 'plugin', owner: PACKAGE_NAME },
  })

/** Cordis plugin name used by loader diagnostics. */
export const name = 'room-tool'

/**
 * No hard injects: the `room` service belongs to another package and is
 * PROBED at apply time (community-service inject discipline — inject only
 * inside the owning family), and the tools registry joins through deferred
 * injection so mount order can never strand the row. A preset naming this
 * row therefore mounts cleanly in every composition.
 */
export const inject = []

/**
 * Plugin body: register the room tools when the service core is present,
 * degrade to a no-op when it is not.
 * @param ctx - Cordis context (the preset's agent-plane mount).
 */
export function apply(ctx: Context): void {
  const service = ctx.get('room')
  if (service === undefined) {
    // Degrade, don't explode: the core plugin is not mounted in this
    // profile, so there is nothing to delegate to. The room UI is the
    // core's own concern and unaffected; only the model tools stay absent.
    ctx.logger.info(`${PACKAGE_NAME}: the global room service is absent — the room tools are not registered`)
    return
  }
  // Deferred injection, NOT an apply-time probe: `ctx.get('tools')` races the
  // tools registry's own mount order on the real composition tree and loses,
  // silently never registering the tools. `ctx.inject` fires when the
  // registry appears and never fires in a composition without one.
  ctx.inject(['tools'], (toolsCtx) => {
    if (typeof service.readRoomContext === 'function') toolsCtx.effect(() => toolsCtx.tools.register(definePluginTool(roomReadTool(service))), 'room-tool: room_read tool')
    toolsCtx.effect(() => toolsCtx.tools.register(definePluginTool(roomInviteTool(service))), 'room-tool: room_invite tool')
    toolsCtx.effect(() => toolsCtx.tools.register(definePluginTool(roomTaskTool(service))), 'room-tool: room_task tool')
    toolsCtx.effect(() => toolsCtx.tools.register(definePluginTool(roomMessageTool(service))), 'room-tool: room_message tool')
  })
}
