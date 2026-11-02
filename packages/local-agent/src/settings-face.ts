/**
 * Settings face for the family providers: one read/watch contract over the
 * host's row-config settings (`SettingsForms`, host 0.2.0+).
 *
 * The settings fields live on the provider's own plugin Config as
 * `.volatile()` fields — writes ride the profile patch, the running fiber's
 * Volatile references track them without a remount, and
 * `settings/document-updated` is the change channel. `get()` unwraps the
 * Volatile references; `watch` re-reads on a matching namespace update.
 */

import type {} from '@deepseek-ai/dsh-settings'
import type { Context } from '@deepseek-ai/cordis'

/** The resolved settings document one provider consumes. */
export interface SettingsFace<T> {
  /** Read the current resolved settings. */
  get(): T
  /**
   * Observe settings replacements. The listener receives the freshly re-read
   * value on every change (own writes round-trip too).
   * @returns the unwatch disposer.
   */
  watch(listener: (next: T) => void): () => void
}

/**
 * Unwrap one volatile config reference (the host wraps each `.volatile()`
 * field in a `{ get() }` reference) or pass a plain value through (a bare
 * value, e.g. a config handed in directly by a test).
 * @param field - the config field as the fiber received it.
 * @returns the plain value.
 */
export function vol<T>(field: T | { get(): T }): T {
  if (field !== null && typeof field === 'object' && typeof (field as { get?: unknown }).get === 'function') {
    return (field as { get(): T }).get()
  }
  return field as T
}

/**
 * Resolve the provider's settings face.
 * @param ctx - the provider's plugin context (`settings` injected).
 * @param options.namespace - the settings namespace; identical to the plugin
 *   row id, which is what `settings/document-updated` emits.
 * @param options.read - unwrap the row config's volatile fields into the
 *   resolved shape.
 * @returns the face.
 */
export function settingsFace<T>(ctx: Context, options: {
  namespace: string
  read: () => T
  /**
   * The harness whose settings-card overrides (card-settings.json in its
   * scoped home) layer over the row config: a field stored there wins, an
   * absent one falls back to `read()`. Absent = row config only.
   */
  harness?: string
}): SettingsFace<T> {
  if (options.harness !== undefined) return cardSettingsFace(ctx, options.harness, rowFace(ctx, options))
  return rowFace(ctx, options)
}

/** The family core's card-settings face, structurally probed. */
interface CardSettingsHost {
  cardSettings(name: string): Readonly<Record<string, unknown>>
  onCardSettings(name: string, listener: () => void): () => void
}

/** Layer a harness's card-settings overrides over a row face. */
function cardSettingsFace<T>(ctx: Context, harness: string, row: SettingsFace<T>): SettingsFace<T> {
  const host = (): CardSettingsHost | undefined => {
    const service = (ctx.get as (name: string) => unknown)('localAgent') as Partial<CardSettingsHost> | undefined
    return typeof service?.cardSettings === 'function' && typeof service.onCardSettings === 'function' ? service as CardSettingsHost : undefined
  }
  const get = (): T => {
    const stored = host()?.cardSettings(harness) ?? {}
    return { ...row.get(), ...stored } as T
  }
  return {
    get,
    watch: (listener) => {
      const offRow = row.watch(() => { listener(get()) })
      const offStore = host()?.onCardSettings(harness, () => { listener(get()) }) ?? (() => {})
      return () => { offRow(); offStore() }
    },
  }
}

/** The row-config face. */
function rowFace<T>(ctx: Context, options: {
  namespace: string
  read: () => T
}): SettingsFace<T> {
  return {
    get: options.read,
    watch: (listener) => {
      const dispose = ctx.on('settings/document-updated', (ns) => {
        if ((ns as unknown as string) !== options.namespace) return
        listener(options.read())
      })
      return () => { dispose() }
    },
  }
}
