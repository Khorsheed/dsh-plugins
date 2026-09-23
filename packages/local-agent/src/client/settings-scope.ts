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
 * Synchronous: the settings client package is a declared client inject of
 * every family provider, so its service (whichever generation) is already
 * provided when the provider's client apply runs. Absent both — a broken
 * composition — the degraded scope keeps the card alive and disabled.
 * @param ctx - the provider's client context.
 * @param entryId - the plugin row id (`local-agent-dsh` and friends), the
 *   same string the 0.1.5 namespace used.
 * @returns the bound scope.
 */
export function bindSettingsScope<T>(ctx: Context, entryId: string): SettingsScope<T> {
  const probe = ctx as unknown as {
    configForms?: ConfigFormsFace
    settingsScope?: LegacySettingsScopeBinder
  }
  if (typeof probe.configForms?.get === 'function') return probe.configForms.get<T>(entryId)
  if (typeof probe.settingsScope?.bind === 'function') return probe.settingsScope.bind<T>({ namespace: entryId })
  return unavailableSettingsScope<T>()
}
