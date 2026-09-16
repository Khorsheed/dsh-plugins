/**
 * The canvas space's preset-composition self-hide (M2, the room
 * preset-visibility precedent): the rail icon, the main panel, and the
 * detail tab show exactly when the CURRENT session's preset composition
 * names the `@khorsheed/dsh-canvas` row — the preset composition file is
 * the single source of truth, read from the official `pluginInventory`
 * Remote (the same probe worktrees and room make). Every unreadable path
 * fails OPEN (visible): a host without the pluginInventory namespace, a
 * pending/failed RPC, a missing or `broken` preset group, and sessions with
 * no preset at all — a preset-less profile (3080's web included) never
 * loses the space. Unlike room there is no "actual room" escape: the canvas
 * space is not a session type, so the criterion is the composition alone.
 * @module @khorsheed/dsh-canvas/client/preset-visibility
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the ctx.sessions service merge (ISessions).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'

/** The composition criterion's row: this package itself (canvas has no companion). */
export const CANVAS_ROW_MODULE = '@khorsheed/dsh-canvas'

/**
 * Minimal structural mirror of the official pluginInventory snapshot — only
 * the agentPresets slice the criterion reads (duck-typed, host-version
 * tolerant: an extra field never breaks a structural read).
 */
export interface CanvasPluginInventorySnapshot {
  readonly agentPresets?: readonly {
    readonly id: string
    readonly broken?: string
    readonly rows: readonly { readonly moduleName: string }[]
  }[]
}

/** The visibility face the registration toggles consume. */
export interface CanvasSpaceVisibility {
  /**
   * Whether the canvas space shows for one session.
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
 * The space visibility controller: one inventory fetch per page (composition
 * data changes only with preset files, which a reload re-reads anyway),
 * re-evaluated by its consumers on every session switch.
 */
export class CanvasPresetVisibility implements CanvasSpaceVisibility {
  /** The inventory answer; null while pending/failed and on namespace-less hosts. */
  private composition: CanvasPluginInventorySnapshot | null = null
  private readonly listeners = new Set<() => void>()

  /** @param ctx - client root context. */
  constructor(private readonly ctx: Context) {
    // The OFFICIAL pluginInventory namespace, probed through ctx.get (never
    // injected — declaring 'remote.pluginInventory' would pend the whole
    // client on a host without it, and the criterion must fail open there).
    const pluginInventory = ctx.get('remote.pluginInventory') as {
      list: () => Promise<{ ok: true; value: CanvasPluginInventorySnapshot } | { ok: false }>
    } | undefined
    if (pluginInventory !== undefined) {
      void pluginInventory.list().then(result => {
        if (!result.ok) return
        this.composition = result.value
        this.notify()
      }).catch(() => { /* an unreachable inventory reads as no data (fail-open) */ })
    }
    // Session switches re-decide the space's registrations.
    ctx.effect(
      () => ctx.sessions.list.subscribe(() => { this.notify() }),
      'canvas: preset-visibility session follower',
    )
  }

  show(sessionId: SessionId | undefined): boolean {
    if (sessionId === undefined) return true
    const preset = presetOf(this.ctx.sessions.list.getSnapshot().byId[sessionId])
    if (preset === undefined) return true
    if (this.composition === null) return true
    const group = this.composition.agentPresets?.find(candidate => candidate.id === preset)
    if (group === undefined || group.broken !== undefined) return true
    return group.rows.some(row => row.moduleName === CANVAS_ROW_MODULE)
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
 * One registration's visibility toggle (the room RegistrationToggle shape):
 * registers exactly while the criterion passes and the slot's inject arm is
 * ready, and disposes otherwise — the slot's own subscription re-renders the
 * host chrome (a rail row, a main panel, a tab), so a hidden entry means NO
 * registration, never a component returning null.
 */
export class RegistrationToggle {
  private dispose: (() => void) | undefined
  private ready = false

  /**
   * @param register - mounts the entry and returns its disposer.
   * @param show - the current decision (re-read on every sync).
   * @param onHide - runs once per hide transition (e.g. leave the hidden panel).
   */
  constructor(
    private readonly register: () => () => void,
    private readonly show: () => boolean,
    private readonly onHide?: () => void,
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
      this.onHide?.()
      this.dispose()
      this.dispose = undefined
    }
  }
}
