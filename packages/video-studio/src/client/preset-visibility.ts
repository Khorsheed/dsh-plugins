/**
 * The preset-composition visibility of the 剪辑 right-sidebar tab type. The
 * panel is the entry to the video-studio tools, so the criterion answers "can
 * THIS session reach the video_* tools". The `./tool` row is preset-mounted
 * only (the dsh-video 剪辑模式 recipe names it; the package's own patch never
 * root-mounts it — the typesafe-tool shape), so the grant path is the current
 * session's preset composition. The root-entries check stays as a future-proof
 * second path (the canvas double-check): if a deployment ever root-mounts the
 * tool row, the tab simply shows for every session.
 *
 * Every unreadable path fails OPEN (visible): no pluginInventory namespace, a
 * pending/failed RPC, a missing or `broken` preset group, a session with no
 * preset, and the no-session home state (a frame-level surface has no preset
 * input until a session exists — showing there is the neutral state, not a
 * leak). 标准模式 is the harness's built-in `standard` preset, whose
 * composition never names the tool row — so the tab hides there as intended.
 *
 * Hidden means NOT registered: the guide enumerates the tab-type registry,
 * opened tabs are stored per session (an ungranted session's layout never held
 * one), and a kind with no registrant renders the host's designed
 * `tab.unavailable` fallback ("a real state, not a defect").
 *
 * Inline copy of packages/canvas/src/client/preset-visibility.ts (the docs
 * rule: keep per-package copies, no shared helper).
 * @module @khorsheed/dsh-video-studio/client/preset-visibility
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the ctx.sessions service merge (ISessions).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** The criterion's row: the video_* tools + skill composition entry. */
export const VIDEO_TOOL_ROW_MODULE = '@khorsheed/dsh-video-studio/tool'

/**
 * Minimal structural mirror of the official pluginInventory snapshot — the
 * entries slice (root grants) plus the agentPresets slice (preset grants),
 * duck-typed and host-version tolerant.
 */
export interface VideoPluginInventorySnapshot {
  readonly entries?: readonly {
    readonly moduleName: string
    readonly enabled?: boolean
  }[]
  readonly agentPresets?: readonly {
    readonly id: string
    readonly broken?: string
    readonly rows: readonly {
      readonly moduleName: string
      readonly enabled?: boolean
    }[]
  }[]
}

/** The current session's agent preset, the dual read per host line. */
function presetOf(row: unknown): string | undefined {
  const value = (row as { projectionValues?: { agentPreset?: unknown }; agentPreset?: unknown } | undefined)
    ?.projectionValues?.agentPreset
    ?? (row as { agentPreset?: unknown } | undefined)?.agentPreset
  return typeof value === 'string' ? value : undefined
}

/**
 * The tab's visibility controller: one inventory fetch per page (composition
 * data changes only with preset files, which a reload re-reads anyway),
 * re-evaluated by the toggle on every session switch.
 */
export class VideoTabVisibility {
  /** The inventory answer; null while pending/failed and on namespace-less hosts. */
  private composition: VideoPluginInventorySnapshot | null = null
  private readonly listeners = new Set<() => void>()

  /**
   * @param ctx - client root context.
   * @param pluginInventory - the OFFICIAL namespace, probed through ctx.get
   *   (never injected — declaring it would pend the whole client on a host
   *   without it, and the criterion must fail open there).
   */
  constructor(
    private readonly ctx: Context,
    pluginInventory: { list: () => Promise<RemoteResult<VideoPluginInventorySnapshot>> } | undefined,
  ) {
    if (pluginInventory !== undefined) {
      void pluginInventory.list().then(result => {
        if (!result.ok) return
        this.composition = result.value ?? null
        this.notify()
      }).catch(() => { /* an unreachable inventory reads as no data (fail-open) */ })
    }
    // Session switches re-decide the tab type's registration (the guide
    // enumerates registrations, not components).
    ctx.effect(
      () => ctx.sessions.list.subscribe(() => { this.notify() }),
      'video-studio: tab visibility session follower',
    )
  }

  show(sessionId: SessionId | undefined): boolean {
    if (this.composition === null) return true
    // Path 1: a root-mounted tool row grants the tools to every session — a
    // deployment-level constant, checked before any per-session question.
    if (this.composition.entries?.some(row => row.moduleName === VIDEO_TOOL_ROW_MODULE && row.enabled === true) === true) return true
    if (sessionId === undefined) return true
    const preset = presetOf(this.ctx.sessions.list.getSnapshot().byId[sessionId])
    if (preset === undefined) return true
    const group = this.composition.agentPresets?.find(candidate => candidate.id === preset)
    if (group === undefined || group.broken !== undefined) return true
    // Path 2: the preset-mounted row grants this session.
    return group.rows.some(row => row.moduleName === VIDEO_TOOL_ROW_MODULE && row.enabled !== false)
  }

  /** Subscribe to criterion-input changes (session switches, the inventory answer). */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

/**
 * The tab type's registration toggle (the room template): registers exactly
 * while the criterion passes for the current session and disposes otherwise.
 * Unlike the keyed-slot consumers, the sidebarRightTabs registry is a direct
 * inject — no slot-declaration wait, so the toggle is ready immediately.
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

  /** The registry is reachable — decisions may register now. */
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

/** The session the main view shows (the canvas precedent). */
interface SessionListCurrent {
  current?: SessionId
  byId: Record<SessionId, { id: SessionId; retainedBy?: Readonly<Record<string, number>> }>
}
export function mainSessionId(list: { current?: SessionId; byId: Record<string, unknown> }): SessionId | undefined {
  const view = list as SessionListCurrent
  return Object.values(view.byId).find(s => ((s as { retainedBy?: Record<string, number> }).retainedBy?.mainView ?? 0) > 0)?.id ?? view.current
}
