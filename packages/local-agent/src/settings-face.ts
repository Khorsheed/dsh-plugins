/**
 * Dual-line settings face for the family providers: one read/watch contract
 * over the two host settings generations, probed by capability, never by
 * version.
 *
 * - 0.1.5: `settings.register(ns, schema, { base })` returns a namespace scope
 *   whose `get()` resolves schema defaults ← composition base ← user layer and
 *   whose `watch` round-trips every write. That scope IS the face.
 * - 0.1.7-rc.1 (`SettingsForms`): the settings fields live on the provider's
 *   own plugin Config as `.volatile()` fields — writes ride the profile patch,
 *   the running fiber's Volatile references track them without a remount, and
 *   `settings/document-updated` is the change channel. `get()` unwraps the
 *   Volatile references; `watch` re-reads on a matching namespace update.
 *
 * The legacy arm keeps old `settings.yaml` values working untouched; on rc.1
 * the official one-shot import moves the same-named section into the row's
 * config, which the volatile read then serves.
 */

import type {} from '@deepseek-ai/dsh-settings'
import type { Context } from '@deepseek-ai/cordis'

/** The resolved settings document one provider consumes. */
export interface SettingsFace<T> {
  /** Read the current resolved settings. */
  get(): T
  /**
   * Observe settings replacements. The listener receives the freshly re-read
   * value on every change (own writes round-trip too, exactly like the 0.1.5
   * namespace scope).
   * @returns the unwatch disposer.
   */
  watch(listener: (next: T) => void): () => void
}

/**
 * Unwrap one volatile config reference (rc.1 wraps each `.volatile()` field
 * in a `{ get() }` reference) or pass a plain value through (0.1.5's
 * schemastery has no `.volatile()`, so the field resolves bare there).
 * @param field - the config field as the fiber received it.
 * @returns the plain value.
 */
export function vol<T>(field: T | { get(): T }): T {
  if (field !== null && typeof field === 'object' && typeof (field as { get?: unknown }).get === 'function') {
    return (field as { get(): T }).get()
  }
  return field as T
}

/** The 0.1.5 settings service face, structurally probed (`register` was removed in rc.1). */
interface LegacySettingsRegistry {
  register(namespace: string, schema: unknown, options?: { base?: Record<string, unknown> }): SettingsFace<never>
}

/**
 * Resolve the provider's settings face for the host line actually serving.
 * @param ctx - the provider's plugin context (`settings` injected).
 * @param options.namespace - the settings namespace; identical to the plugin
 *   row id, which is what rc.1's `settings/document-updated` emits and what
 *   the rc.1 legacy import maps the old settings.yaml section onto.
 * @param options.legacySchema - the 0.1.5 namespace schema (plain fields).
 * @param options.legacyBase - the 0.1.5 composition base, built from the
 *   deployment's plugin config exactly as before.
 * @param options.read - the rc.1 read: unwrap the row config's volatile
 *   fields into the same resolved shape.
 * @returns the face both arms share.
 */
export function settingsFace<T>(ctx: Context, options: {
  namespace: string
  legacySchema: unknown
  legacyBase: Record<string, unknown>
  read: () => T
}): SettingsFace<T> {
  const legacy = ctx.get('settings') as LegacySettingsRegistry | undefined
  if (legacy !== undefined && typeof legacy.register === 'function') {
    return legacy.register(options.namespace, options.legacySchema, { base: options.legacyBase }) as SettingsFace<T>
  }
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
