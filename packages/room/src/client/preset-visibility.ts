/**
 * The preset-composition visibility of room's SESSION chrome (M3' self-hide,
 * the mode-switcher proposal's "组合里有我的行"): the invite chip and the
 * members tab show exactly when the CURRENT session's preset composition
 * names the `@khorsheed/dsh-room-tool` row — the preset composition file is
 * the single source of truth, read from the official `pluginInventory`
 * Remote (the same criterion the worktrees badge implements; inlined here
 * rather than extracted into a helper package, per the proposal's M3'
 * deferral). Every unreadable path fails OPEN (visible): a host without the
 * pluginInventory namespace, a pending/failed RPC, a missing or `broken`
 * preset group, and sessions with no preset at all. An ACTUAL room session
 * always shows its chrome regardless of preset — the gate hides the dev
 * affordance in sessions that never granted it, never breaks an existing
 * room (the E1 regression rule).
 * @module @khorsheed/dsh-room/client/preset-visibility
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the ctx.sessions service merge (ISessions).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'

/** The composition criterion's row: room's companion tool package. */
export const ROOM_TOOL_ROW_MODULE = '@khorsheed/dsh-room-tool'

/**
 * Minimal structural mirror of the official pluginInventory snapshot — only
 * the agentPresets slice the criterion reads (duck-typed, host-version
 * tolerant: an extra field never breaks a structural read).
 */
export interface RoomPluginInventorySnapshot {
  readonly agentPresets?: readonly {
    readonly id: string
    readonly broken?: string
    readonly rows: readonly { readonly moduleName: string }[]
  }[]
}

/** The visibility face the gated surfaces consume. */
export interface RoomChromeVisibility {
  /**
   * Whether room's session chrome shows for one session.
   * @param sessionId - the session being rendered (undefined = no session
   *   context — fail-open, so registration-shape probes keep their entries).
   */
  show: (sessionId: SessionId | undefined) => boolean
  /** Subscribe to criterion-input changes (session switches, the inventory answer). */
  subscribe: (listener: () => void) => () => void
}

/** The current session's agent preset, the badge's dual read per host line. */
function presetOf(row: unknown): string | undefined {
  const value = (row as { projectionValues?: { agentPreset?: unknown }; agentPreset?: unknown } | undefined)
    ?.projectionValues?.agentPreset
    ?? (row as { agentPreset?: unknown } | undefined)?.agentPreset
  return typeof value === 'string' ? value : undefined
}

/**
 * The session-chrome visibility controller: one inventory fetch per page
 * (composition data changes only with preset files, which a reload re-reads
 * anyway), re-evaluated by its consumers on every session switch.
 */
export class RoomPresetVisibility implements RoomChromeVisibility {
  /** The inventory answer; null while pending/failed and on namespace-less hosts. */
  private composition: RoomPluginInventorySnapshot | null = null
  private readonly listeners = new Set<() => void>()

  /**
   * @param ctx - client root context.
   * @param isRoom - the RoomStore's cached room verdict (the E1 escape).
   */
  constructor(
    private readonly ctx: Context,
    private readonly isRoom: (sessionId: SessionId) => boolean,
  ) {
    // The OFFICIAL pluginInventory namespace, probed through ctx.get (never
    // injected — declaring 'remote.pluginInventory' would pend the whole
    // client on a host without it, and the criterion must fail open there).
    const pluginInventory = ctx.get('remote.pluginInventory') as {
      list: () => Promise<{ ok: true; value: RoomPluginInventorySnapshot } | { ok: false }>
    } | undefined
    if (pluginInventory !== undefined) {
      void pluginInventory.list().then(result => {
        if (!result.ok) return
        this.composition = result.value
        this.notify()
      }).catch(() => { /* an unreachable inventory reads as no data (fail-open) */ })
    }
    // Session switches re-decide the members tab's registration (the tab
    // strip's buttons come from the registration, not the component).
    ctx.effect(
      () => ctx.sessions.list.subscribe(() => { this.notify() }),
      'room: preset-visibility session follower',
    )
  }

  show(sessionId: SessionId | undefined): boolean {
    if (sessionId === undefined) return true
    // An actual room keeps its chrome whatever its preset granted (E1).
    if (this.isRoom(sessionId)) return true
    const preset = presetOf(this.ctx.sessions.list.getSnapshot().byId[sessionId])
    if (preset === undefined) return true
    if (this.composition === null) return true
    const group = this.composition.agentPresets?.find(candidate => candidate.id === preset)
    if (group === undefined || group.broken !== undefined) return true
    return group.rows.some(row => row.moduleName === ROOM_TOOL_ROW_MODULE)
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

/**
 * The members tab's registration toggle: the `conversation.view` tab strip's
 * BUTTONS enumerate the slot's registrations (ui-conversation's `viewTabs()`
 * has no per-session predicate), so a hidden tab means NO registration — a
 * component returning null would leave the button with an empty body. The
 * toggle registers exactly while the criterion passes for the current
 * session and disposes otherwise; the slot's own subscription re-renders the
 * strip (the same re-registration mechanism the composer takeover's
 * promotion bump uses).
 */
export class RegistrationToggle {
  private dispose: (() => void) | undefined
  private ready = false

  /**
   * @param register - mounts the entry and returns its disposer.
   * @param show - the current decision (re-read on every sync).
   */
  constructor(
    private readonly register: () => () => void,
    private readonly show: () => boolean,
  ) {}

  /** The slot declaration appeared (slots.inject's arm) — decisions may register now. */
  setReady(ready: boolean): void {
    this.ready = ready
    if (!ready && this.dispose !== undefined) {
      this.dispose()
      this.dispose = undefined
    }
    this.sync()
  }

  /** Re-evaluate: register while shown and ready, dispose otherwise. */
  sync(): void {
    if (!this.ready) return
    if (this.show()) {
      this.dispose ??= this.register()
    } else if (this.dispose !== undefined) {
      this.dispose()
      this.dispose = undefined
    }
  }
}
