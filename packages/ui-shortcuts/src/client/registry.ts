/**
 * Shortcut registry runtime: the provider half of `ctx.shortcuts`. It owns
 * the registered actions, the live per-action preferences, and the key-capture
 * flag; the keydown wiring reads its snapshots, the Settings row writes
 * preferences and toggles capture through it.
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ShortcutPreference, ShortcutSettings } from '../settings.ts'
import type { ShortcutActionContribution, ShortcutRegistry } from './contract.ts'

/**
 * The live registry. Direct preference reads stay process-local when no Host
 * scope is bound.
 */
export class ShortcutRegistryRuntime implements ShortcutRegistry {
  /** Registered actions in registration order (dispatch order). */
  readonly actions: SnapshotStore<readonly ShortcutActionContribution[]> = createSnapshotStore([])
  /** Live preference per action id; unwritten actions ride their default binding. */
  readonly preferences: SnapshotStore<Record<string, ShortcutPreference>> = createSnapshotStore({})
  /** Action currently recording a new binding, or null; the global wiring stands down while set. */
  readonly capturing: SnapshotStore<string | null> = createSnapshotStore<string | null>(null)
  private readonly host: SettingsScope<ShortcutSettings> | undefined

  /**
   * @param host - durable preference scope owned by the providing plugin;
   * absent compositions stay process-local. The adoption subscription shares
   * the scope's plugin lifetime — a disposed scope never publishes again, so
   * the registry needs no release hook.
   */
  constructor(host?: SettingsScope<ShortcutSettings>) {
    this.host = host
    if (host !== undefined) {
      host.subscribe(() => { this.adopt(host) })
      this.adopt(host)
    }
  }

  /**
   * Contribute one action; its live preference starts at the persisted value
   * or the shipped default.
   * @param contribution - the action to mount.
   * @returns the disposer removing the action and its live preference.
   */
  registerAction(contribution: ShortcutActionContribution): () => void {
    if (this.actions.getSnapshot().some(action => action.id === contribution.id)) {
      throw new Error(`shortcut action "${contribution.id}" is already registered`)
    }
    this.actions.set([...this.actions.getSnapshot(), contribution])
    this.preferences.set({ ...this.preferences.getSnapshot(), [contribution.id]: this.persisted(contribution) })
    return () => {
      this.actions.set(this.actions.getSnapshot().filter(action => action.id !== contribution.id))
      const preferences = { ...this.preferences.getSnapshot() }
      delete preferences[contribution.id]
      this.preferences.set(preferences)
    }
  }

  /**
   * The live preference of one action (its default while nothing is persisted).
   * @param id - the action id.
   * @returns the current preference.
   */
  preferenceOf(id: string): ShortcutPreference {
    return this.preferences.getSnapshot()[id] ?? this.defaultOf(id)
  }

  /**
   * Replace one action's preference; the live value publishes before the
   * durable write starts.
   * @param id - the action to rebind.
   * @param preference - the new preference (`{ kind: 'none' }` unbinds).
   */
  setPreference(id: string, preference: ShortcutPreference): void {
    if (this.preferences.getSnapshot()[id] === preference) return
    this.preferences.set({ ...this.preferences.getSnapshot(), [id]: preference })
    void this.host?.set(id, preference)
  }

  /**
   * Restore one action to its shipped default binding.
   * @param id - the action to reset.
   */
  reset(id: string): void {
    this.setPreference(id, this.defaultOf(id))
  }

  /**
   * The shipped default of one action.
   * @param id - the action id.
   * @returns the registered default binding, or the unbound marker for an unknown id.
   */
  defaultOf(id: string): ShortcutPreference {
    return this.actions.getSnapshot().find(action => action.id === id)?.defaultBinding ?? { kind: 'none' }
  }

  private persisted(contribution: ShortcutActionContribution): ShortcutPreference {
    return this.host?.getSnapshot().value?.[contribution.id] ?? contribution.defaultBinding
  }

  /**
   * Adopt the scope's accepted durable preferences without writing them back.
   * Ids the Host section does not carry fall back to the registered default.
   * @param host - the constructor-narrowed scope driving this adoption.
   */
  private adopt(host: SettingsScope<ShortcutSettings>): void {
    const section = host.getSnapshot().value
    if (section === undefined) return
    const preferences = { ...this.preferences.getSnapshot() }
    for (const action of this.actions.getSnapshot()) {
      const next = section[action.id] ?? action.defaultBinding
      if (preferences[action.id] !== next) preferences[action.id] = next
    }
    this.preferences.set(preferences)
  }
}
