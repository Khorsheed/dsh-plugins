/**
 * The two host lines' per-namespace settings scope behind one observable.
 *
 * 0.1.5 binds `ctx.settingsScope`; rc.1 replaced that service with
 * `ctx.configForms` — the two carry the SAME snapshot shape and the same
 * field writes (only the resolutions gained an acceptance boolean, which the
 * card's then/catch usage never reads), so one structural face covers both.
 * Neither service is declared in the plugin's inject list: a composition
 * without ui-settings must not pend the bundle, and the providers can mount
 * after this plugin, so the channel publishes `unavailable` until either
 * line's deferred probe arms it.
 *
 * @module @khorsheed/dsh-context-guard/client/scope
 */
import type { Context } from '@deepseek-ai/cordis'
import { CONTEXT_GUARD_NS } from '../namespace.ts'
import type { ContextGuardConfig } from './config.ts'

/** Snapshot shape shared by 0.1.5's `SettingsScopeSnapshot` and rc.1's `ConfigFormSnapshot`. */
export interface GuardScopeSnapshot {
  readonly status: 'loading' | 'ready' | 'unavailable'
  readonly value: ContextGuardConfig | undefined
  /** Composition layer the value resolves over; a cleared field reverts to it. */
  readonly base: unknown
  /** Raw user layer as stored; a field's PRESENCE here marks it overridden. */
  readonly user: unknown
  /** Namespace revision fencing the next write. */
  readonly revision: number | undefined
  readonly writable: boolean
}

/** The reads and field writes both lines' scopes share. */
export interface GuardScope {
  getSnapshot(): GuardScopeSnapshot
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<unknown>
  unset(field: string): Promise<unknown>
}

/** Published while no settings provider serves the section (stable identity). */
const UNAVAILABLE: GuardScopeSnapshot = {
  status: 'unavailable',
  value: undefined,
  base: undefined,
  user: undefined,
  revision: undefined,
  writable: false,
}

/**
 * Observable mirror of the bound scope. The slot entries' `hooks.config` seat
 * binds to this at registration time — before (and whether or not) a settings
 * provider appears — and arming swaps the source in and republishes.
 */
export class GuardScopeChannel {
  private scope: GuardScope | undefined
  private readonly listeners = new Set<() => void>()

  readonly getSnapshot = (): GuardScopeSnapshot => this.scope?.getSnapshot() ?? UNAVAILABLE

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  readonly set = (field: string, value: unknown): Promise<unknown> =>
    this.scope?.set(field, value) ?? Promise.resolve(false)

  readonly unset = (field: string): Promise<unknown> =>
    this.scope?.unset(field) ?? Promise.resolve(false)

  /** Bind the line-served scope; the first arm wins (the two lines never coexist). */
  arm(scope: GuardScope): void {
    if (this.scope !== undefined) return
    this.scope = scope
    scope.subscribe(() => { this.emit() })
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

/**
 * Arm the channel from whichever settings face the host line serves: rc.1's
 * `configForms.get(entryId)` — the entry id IS the settings namespace, both
 * being the row id — first, 0.1.5's `settingsScope.bind({ namespace })`
 * second. Both probes ride deferred injects so a later-mounting provider
 * still lands; a composition with neither leaves the channel unavailable.
 * @param ctx - the client plugin context.
 * @param channel - the observable the slot entries read.
 */
export function bindGuardScope(ctx: Context, channel: GuardScopeChannel): void {
  ctx.inject(['configForms'], (formsCtx) => {
    const forms = formsCtx.get('configForms') as { get?(entryId: string): GuardScope } | undefined
    if (typeof forms?.get === 'function') channel.arm(forms.get(CONTEXT_GUARD_NS))
  })
  ctx.inject(['settingsScope'], (legacyCtx) => {
    const legacy = legacyCtx.get('settingsScope') as { bind?(spec: { namespace: string }): GuardScope } | undefined
    if (typeof legacy?.bind === 'function') channel.arm(legacy.bind({ namespace: CONTEXT_GUARD_NS }))
  })
}
