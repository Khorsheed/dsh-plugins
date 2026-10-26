/**
 * Dual-line client settings scope for the family settings cards: one
 * snapshot/write contract over the two host client generations, probed by
 * capability, never by version.
 *
 * - 0.1.5: `ctx.settingsScope.bind({ namespace })` — the removed
 *   `SettingsScope` face.
 * - 0.1.7-rc.1: `ctx.configForms.get(entryId)` — the `ConfigForm` controller
 *   (`packages/client/ui-settings/src/client/config-form.ts`), keyed by the
 *   plugin row id, which is the same string the 0.1.5 namespace used.
 *
 * Both are snapshot stores with ordered field writes, so the cards consume
 * one structural type. The 0.1.5 card keeps reading old `settings.yaml`
 * values through the legacy arm; on rc.1 the official one-shot import has
 * already moved the same-named section into the row's config.
 */

import type { Context } from '@deepseek-ai/cordis'

/**
 * Client-side sync state of one settings namespace. The field set is the
 * intersection both host lines serve; the cards read `status`, `value`, and
 * `writable`, the rest ride along for editors that layer on top.
 */
export interface SettingsScopeSnapshot<T> {
  /** `loading` until the first accepted section, `ready` while one stands, `unavailable` when the namespace is not exposed. */
  readonly status: 'loading' | 'ready' | 'unavailable'
  /** Last accepted schema-resolved section; undefined before the first acceptance. */
  readonly value: T | undefined
  /** Composition layer a cleared field reverts to, when the owning plugin declared one. */
  readonly base: unknown
  /** Raw user layer as stored; a field's PRESENCE here marks it overridden. */
  readonly user: unknown
  /** Namespace revision fencing the next write. */
  readonly revision: number | undefined
  /** Whether the Host document accepts writes. */
  readonly writable: boolean
  /** `host` syncs with the Host document; `memory` keeps a remote browser process-local. */
  readonly mode: 'host' | 'memory'
}

/**
 * The card's settings face: a hooks source (the renderer's `hooks.settings`
 * compartment turns `getSnapshot`/`subscribe` into the `useSettings` hook)
 * plus ordered field writes. `set`/`unset` settle after the write and any
 * latest-write recovery read on both lines (rc.1's `ConfigForm` additionally
 * resolves whether the Host accepted the write — the cards ignore it).
 */
export interface SettingsScope<T> {
  getSnapshot(): SettingsScopeSnapshot<T>
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<unknown>
  unset(field: string): Promise<unknown>
}

/** The rc.1 settings client face, structurally probed (`configForms` exists only there). */
interface ConfigFormsFace {
  get<T>(entryId: string): SettingsScope<T>
}

/** The 0.1.5 settings client face, structurally probed (`settingsScope` was removed in rc.1). */
interface LegacySettingsScopeBinder {
  bind<T>(spec: { namespace: string }): SettingsScope<T>
}

/**
 * Observable channel behind the card's settings face: delegates to the armed
 * line scope and republishes on arming, reporting the degraded face until
 * either host line's deferred probe arms it. The channel exists because the
 * line probe cannot run as a direct property read — cordis 4.0.4's
 * service-access guard throws `cannot get property "<name>" without inject`
 * on any undeclared `ctx.<service>` touch, and neither service name exists on
 * the other host line, so a static inject would pend there; `ctx.inject` +
 * `ctx.get` is the only probe that is safe on both.
 */
class SettingsScopeChannel<T> implements SettingsScope<T> {
  private inner: SettingsScope<T> = unavailableSettingsScope<T>()
  private readonly listeners = new Set<() => void>()

  readonly getSnapshot = (): SettingsScopeSnapshot<T> => this.inner.getSnapshot()

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  readonly set = (field: string, value: unknown): Promise<unknown> => this.inner.set(field, value)

  readonly unset = (field: string): Promise<unknown> => this.inner.unset(field)

  /** Bind the line-served scope; the first arm wins (the two lines never coexist). */
  arm(scope: SettingsScope<T>): void {
    this.inner = scope
    scope.subscribe(() => { this.emit() })
    this.emit()
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

/**
 * An inert scope for a composition whose settings client never came up:
 * reads report `unavailable` (the cards disable their controls, exactly like
 * an unregistered namespace) and writes never settle a value change.
 * @returns the degraded scope.
 */
export function unavailableSettingsScope<T>(): SettingsScope<T> {
  const snapshot: SettingsScopeSnapshot<T> = {
    status: 'unavailable',
    value: undefined,
    base: undefined,
    user: undefined,
    revision: undefined,
    writable: false,
    mode: 'memory',
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    set: () => Promise.resolve(false),
    unset: () => Promise.resolve(false),
  }
}

/**
 * Bind the provider row's settings scope on the host line actually serving.
 * Returns the channel synchronously; both line probes ride deferred injects,
 * so the serving line's arm fires as soon as its settings service is up (the
 * settings client package is a declared client inject of every family
 * provider, so in a normal composition arming lands immediately) and a
 * provider mounting first still gets armed later. Absent both — a broken
 * composition — the channel keeps the card on the degraded face, alive and
 * disabled.
 * @param ctx - the provider's client context.
 * @param entryId - the plugin row id (`local-agent-dsh` and friends), the
 *   same string the 0.1.5 namespace used.
 * @returns the bound scope channel.
 */
export function bindSettingsScope<T>(ctx: Context, entryId: string): SettingsScope<T> {
  const channel = new SettingsScopeChannel<T>()
  ctx.inject(['configForms'], (formsCtx) => {
    const forms = formsCtx.get('configForms') as ConfigFormsFace | undefined
    if (typeof forms?.get === 'function') channel.arm(forms.get<T>(entryId))
  })
  ctx.inject(['settingsScope'], (legacyCtx) => {
    const legacy = legacyCtx.get('settingsScope') as LegacySettingsScopeBinder | undefined
    if (typeof legacy?.bind === 'function') channel.arm(legacy.bind<T>({ namespace: entryId }))
  })
  return channel
}

/** The family gateway's card-settings face, structurally probed. */
interface CardSettingsGateway {
  cardSettings(name: string): Promise<{ readonly ok: boolean; readonly value?: Readonly<Record<string, unknown>> }>
  setCardSettings(name: string, patch: Readonly<Record<string, unknown>>): Promise<{ readonly ok: boolean; readonly value?: Readonly<Record<string, unknown>> }>
}

/**
 * Bind a settings card to the harness's own card-settings store (card-settings.ts
 * on the host) layered over the row's host settings form: reads are the
 * form's value with the stored overrides on top; writes go to the store only,
 * never the profile patch — so they cannot be refused when several suites
 * insert the same row. A host without the store keeps the plain row scope.
 * @param ctx - the provider's client context.
 * @param harness - the harness name (`dsh`, `kimi`, …).
 * @param entryId - the plugin row id the base values come from.
 * @returns the bound scope.
 */
export function bindCardSettingsScope<T>(ctx: Context, harness: string, entryId: string): SettingsScope<T> {
  const row = bindSettingsScope<T>(ctx, entryId)
  const gateway = (): CardSettingsGateway | undefined => {
    const remote = ctx.get('remote.localAgentGateway') as Partial<CardSettingsGateway> | undefined
    return typeof remote?.cardSettings === 'function' && typeof remote.setCardSettings === 'function' ? remote as CardSettingsGateway : undefined
  }
  const listeners = new Set<() => void>()
  let stored: Readonly<Record<string, unknown>> | undefined
  let cached: { rowSnapshot: SettingsScopeSnapshot<T>; stored: typeof stored; snapshot: SettingsScopeSnapshot<T> } | undefined
  const emit = (): void => { for (const listener of [...listeners]) listener() }
  const load = (): void => {
    void gateway()?.cardSettings(harness).then((result) => {
      if (!result.ok || result.value === undefined) return
      stored = result.value
      emit()
    }).catch(() => {})
  }
  const write = async (patch: Record<string, unknown>): Promise<boolean> => {
    const remote = gateway()
    if (remote === undefined) return false
    try {
      const result = await remote.setCardSettings(harness, patch)
      if (!result.ok || result.value === undefined) return false
      stored = result.value
      emit()
      return true
    } catch {
      return false
    }
  }
  return {
    getSnapshot: () => {
      const rowSnapshot = row.getSnapshot()
      // One object per (row snapshot, stored) pair: useSyncExternalStore needs a stable answer.
      if (cached !== undefined && cached.rowSnapshot === rowSnapshot && cached.stored === stored) return cached.snapshot
      const overrides = stored ?? {}
      const snapshot: SettingsScopeSnapshot<T> = gateway() === undefined ? rowSnapshot : {
        ...rowSnapshot,
        value: rowSnapshot.value === undefined && stored === undefined ? undefined : { ...rowSnapshot.value, ...overrides } as T,
        // The store accepts writes whether or not the host form would.
        writable: true,
        status: rowSnapshot.status === 'loading' && stored !== undefined ? 'ready' : rowSnapshot.status === 'unavailable' && stored !== undefined ? 'ready' : rowSnapshot.status,
      }
      cached = { rowSnapshot, stored, snapshot }
      return snapshot
    },
    subscribe: (listener) => {
      if (listeners.size === 0) load()
      listeners.add(listener)
      const off = row.subscribe(listener)
      return () => { listeners.delete(listener); off() }
    },
    set: (field, value) => gateway() === undefined ? row.set(field, value) : write({ [field]: value }),
    unset: field => gateway() === undefined ? row.unset(field) : write({ [field]: null }),
  }
}
