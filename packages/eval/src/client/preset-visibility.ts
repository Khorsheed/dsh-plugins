/**
 * The preset-composition visibility of eval's SESSION chrome (the 实验室 tab;
 * the room self-hide pattern, M3'②, as mission and datasets implement it):
 * the tab shows exactly when the CURRENT session's preset composition names
 * the `@khorsheed/dsh-eval-tool` row — the preset composition file is the
 * single source of truth, read from the official `pluginInventory` Remote.
 * Inlined here rather than extracted into a helper package, per the proposal's
 * M3' deferral. Every unreadable path fails OPEN (visible): a host without the
 * pluginInventory namespace, a pending/failed RPC, a missing or `broken`
 * preset group, and sessions with no preset at all.
 *
 * "The CURRENT session's preset" means the nearest one in its PARENT
 * chain since I5·T60: a member sub-session declares no preset of its own,
 * so read alone it took the fail-open arm and showed every gated tab inside
 * a player's transcript (I5·T39 · G13). See {@link effectivePresetOf}.
 *
 * The criterion is PRESENCE of the companion row — the honest reading of "the
 * composition grants the agent the eval read tools". A session that merely has
 * eval runs in its ledger is not an escape: nothing about an existing run is
 * broken by hiding a read-only viewer, so no second escape is invented (the
 * same reasoning mission's copy of this states).
 * @module @khorsheed/dsh-eval/client/preset-visibility
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the ctx.sessions service merge (ISessions).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'

/** The composition criterion's row: eval's companion tool package. */
export const EVAL_TOOL_ROW_MODULE = '@khorsheed/dsh-eval-tool'

/**
 * Minimal structural mirror of the official pluginInventory snapshot — only
 * the agentPresets slice the criterion reads (duck-typed, host-version
 * tolerant: an extra field never breaks a structural read).
 */
export interface EvalPluginInventorySnapshot {
  readonly agentPresets?: readonly {
    readonly id: string
    readonly broken?: string
    readonly rows: readonly { readonly moduleName: string }[]
  }[]
}

/** The visibility face the gated surfaces consume. */
export interface EvalChromeVisibility {
  /**
   * Whether eval's session chrome shows for one session.
   * @param sessionId - the session being rendered (undefined = no session
   *   context — fail-open, so registration-shape probes keep their entries).
   */
  show: (sessionId: SessionId | undefined) => boolean
  /** Subscribe to criterion-input changes (session switches, the inventory answer). */
  subscribe: (listener: () => void) => () => void
}

/** The current session's agent preset, the dual read per host line. */
function presetOf(row: unknown): string | undefined {
  const value = (row as { projectionValues?: { agentPreset?: unknown }; agentPreset?: unknown } | undefined)
    ?.projectionValues?.agentPreset
    ?? (row as { agentPreset?: unknown } | undefined)?.agentPreset
  return typeof value === 'string' ? value : undefined
}

/** One session row's PARENT, when the host records one (member sub-sessions). */
function parentOf(row: unknown): string | undefined {
  const value = (row as { parentSessionId?: unknown } | undefined)?.parentSessionId
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * The preset whose composition decides this session's chrome — the session's
 * own, or the nearest ANCESTOR's when it declares none.
 *
 * A member sub-session is the case this exists for. The cells of an evaluation
 * delegate into child sessions, and a condition that names no agent preset
 * (`"preset": null`, which is most of them) produces a child with no
 * `agentPreset` at all. Read alone, that session matched the fail-open arm and
 * every gated tab appeared in it — including the ones its parent had
 * correctly hidden, which is how a walkthrough of an evaluation found a
 * Missions tab inside a player's own transcript while the main session had
 * none (I5·T39 · G13).
 *
 * Walking to the parent is the honest reading of the criterion, not a special
 * case for evaluations: the chrome asks "does this conversation's composition
 * grant the tools", and a sub-session that inherited its parent's composition
 * inherits the answer. A session with no parent and no preset still fails
 * open, exactly as before. The walk is bounded and cycle-guarded — a ledger
 * that somehow points a session at itself must not hang a tab strip.
 * @param byId - the session-list snapshot's rows.
 * @param sessionId - the session being rendered.
 * @returns the deciding preset id, or undefined when nothing in the chain declares one.
 */
function effectivePresetOf(byId: Record<string, unknown>, sessionId: string): string | undefined {
  const seen = new Set<string>()
  let current: string | undefined = sessionId
  while (current !== undefined && !seen.has(current)) {
    seen.add(current)
    const row: unknown = byId[current]
    const preset = presetOf(row)
    if (preset !== undefined) return preset
    current = parentOf(row)
  }
  return undefined
}

/**
 * The session-chrome visibility controller: one inventory fetch per page
 * (composition data changes only with preset files, which a reload re-reads
 * anyway), re-evaluated by its consumers on every session switch.
 */
export class EvalPresetVisibility implements EvalChromeVisibility {
  /** The inventory answer; null while pending/failed and on namespace-less hosts. */
  private composition: EvalPluginInventorySnapshot | null = null
  private readonly listeners = new Set<() => void>()

  /**
   * @param ctx - client root context.
   */
  constructor(private readonly ctx: Context) {
    // The OFFICIAL pluginInventory namespace, probed through ctx.get (never
    // injected — declaring 'remote.pluginInventory' would pend the whole
    // client on a host without it, and the criterion must fail open there).
    const pluginInventory = ctx.get('remote.pluginInventory') as {
      list: () => Promise<{ ok: true; value: EvalPluginInventorySnapshot } | { ok: false }>
    } | undefined
    if (pluginInventory !== undefined) {
      void pluginInventory.list().then((result) => {
        if (!result.ok) return
        this.composition = result.value
        this.notify()
      }).catch(() => { /* an unreachable inventory reads as no data (fail-open) */ })
    }
    // Session switches re-decide the tab's registration (the tab strip's
    // buttons come from the registration, not the component).
    ctx.effect(
      () => ctx.sessions.list.subscribe(() => { this.notify() }),
      'eval: preset-visibility session follower',
    )
  }

  show(sessionId: SessionId | undefined): boolean {
    if (sessionId === undefined) return true
    const preset = effectivePresetOf(this.ctx.sessions.list.getSnapshot().byId, sessionId)
    if (preset === undefined) return true
    if (this.composition === null) return true
    const group = this.composition.agentPresets?.find(candidate => candidate.id === preset)
    if (group === undefined || group.broken !== undefined) return true
    return group.rows.some(row => row.moduleName === EVAL_TOOL_ROW_MODULE)
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
 * The 实验室 tab's registration toggle: the `conversation.view` tab strip's
 * BUTTONS enumerate the slot's registrations (ui-conversation's `viewTabs()`
 * has no per-session predicate), so a hidden tab means NO registration — a
 * component returning null would leave the button with an empty body. The
 * toggle registers exactly while the criterion passes for the current
 * session and disposes otherwise; the slot's own subscription re-renders the
 * strip (the same re-registration mechanism the room members tab uses).
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

  /** Whether the entry is registered right now. */
  get registered(): boolean {
    return this.dispose !== undefined
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
