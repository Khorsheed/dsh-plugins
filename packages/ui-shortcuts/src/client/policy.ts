/**
 * Shortcut-binding policy. It owns the live per-action preferences and the
 * key-capture flag; the global keydown wiring reads snapshots, the Settings
 * row writes preferences and toggles capture.
 */
import { createSnapshotStore, type SettingsScope, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { DEFAULT_PREFERENCES } from '../settings.ts'
import type { ShortcutAction, ShortcutPreference, ShortcutSettings } from '../settings.ts'

/** Durable field per action, in settings-document order. */
const FIELD_OF: Record<ShortcutAction, keyof ShortcutSettings> = {
  pause: 'pause',
  steerSend: 'steerSend',
}

/**
 * Shortcut preferences used by the keydown wiring and its Settings row.
 * Direct preference reads stay process-local when no Host scope is bound.
 */
export class ShortcutBindingsPolicy {
  /** Preference of the pause action. */
  readonly pause: SnapshotStore<ShortcutPreference> = createSnapshotStore(DEFAULT_PREFERENCES.pause)
  /** Preference of the steer-send action. */
  readonly steerSend: SnapshotStore<ShortcutPreference> = createSnapshotStore(DEFAULT_PREFERENCES.steerSend)
  /** Action currently recording a new binding, or null; the global wiring stands down while set. */
  readonly capturing: SnapshotStore<ShortcutAction | null> = createSnapshotStore<ShortcutAction | null>(null)
  private readonly host: SettingsScope<ShortcutSettings> | undefined

  /**
   * @param host - durable preference scope owned by the providing plugin;
   * absent compositions stay process-local. The adoption subscription shares
   * the scope's plugin lifetime — a disposed scope never publishes again, so
   * the policy needs no release hook.
   */
  constructor(host?: SettingsScope<ShortcutSettings>) {
    this.host = host
    if (host !== undefined) {
      host.subscribe(() => { this.adopt(host) })
      this.adopt(host)
    }
  }

  /**
   * Replace one action's preference; the live value publishes before the
   * durable write starts.
   * @param action - the action to rebind.
   * @param preference - the new preference (`{ kind: 'none' }` unbinds).
   */
  setPreference(action: ShortcutAction, preference: ShortcutPreference): void {
    const store = this.storeOf(action)
    if (store.getSnapshot() === preference) return
    store.set(preference)
    void this.host?.set(FIELD_OF[action], preference)
  }

  /**
   * Restore one action to its shipped default preference.
   * @param action - the action to reset.
   */
  reset(action: ShortcutAction): void {
    this.setPreference(action, DEFAULT_PREFERENCES[action])
  }

  private storeOf(action: ShortcutAction): SnapshotStore<ShortcutPreference> {
    return action === 'pause' ? this.pause : this.steerSend
  }

  /**
   * Adopt the scope's accepted durable preferences without writing them back.
   * Fields the Host section does not carry (schema defaults not yet
   * persisted) leave the live values untouched.
   * @param host - the constructor-narrowed scope driving this adoption.
   */
  private adopt(host: SettingsScope<ShortcutSettings>): void {
    const section = host.getSnapshot().value
    if (section === undefined) return
    if (section.pause !== undefined && this.pause.getSnapshot() !== section.pause) this.pause.set(section.pause)
    if (section.steerSend !== undefined && this.steerSend.getSnapshot() !== section.steerSend) {
      this.steerSend.set(section.steerSend)
    }
  }
}
