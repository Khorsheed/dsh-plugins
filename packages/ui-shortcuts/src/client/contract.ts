/**
 * Service Definition for the shortcut action registry (`ctx.shortcuts`).
 * Any plugin can contribute a keyboard action; the ui-shortcuts provider owns
 * chord dispatch, rebinding, persistence, and the Settings row. The provider's
 * own built-in actions register through this same face (dogfooding), so the
 * contract is the only path an action can take.
 */
import type { BoundKey } from '../settings.ts'

/**
 * Dispatch layering of an action's chord:
 * - `global`: capture-phase listener; the browser default (save, open-file)
 *   is suppressed when the chord fires. For deliberate global gestures.
 * - `yield`: bubble-phase listener that stands down when the key was already
 *   consumed (`defaultPrevented`), when an overlay is open
 *   (`[role="dialog"]/menu/listbox`), or when the target is a non-composer
 *   editable. For keys like Escape that other surfaces also own.
 */
export type ShortcutLayering = 'global' | 'yield'

/** Locale seat for one user-facing string: namespace + dictionary key. */
export interface ShortcutLabelRef {
  /** Locale namespace the registering plugin owns. */
  ns: string
  /** Dictionary key inside the namespace. */
  key: string
}

/** One keyboard action contributed by a plugin. */
export interface ShortcutActionContribution {
  /**
   * Unique action id, conventionally `<plugin>.<action>` (the provider's
   * built-ins keep their bare legacy ids, which existing settings documents
   * already persist). Duplicate ids fail loud at registration.
   */
  id: string
  /** Settings-row label locale seat. */
  label: ShortcutLabelRef
  /** Settings-row description locale seat. */
  description: ShortcutLabelRef
  /** Shipped default binding; the user can rebind or unbind it in Settings. */
  defaultBinding: BoundKey
  /** Dispatch layering (see {@link ShortcutLayering}). */
  layering: ShortcutLayering
  /**
   * Optional gate evaluated at dispatch time (fresh state, no caching) —
   * the chord stands down while it returns false.
   */
  available?: () => boolean
  /** The action body; a closure capturing the registering plugin's context. */
  run: () => void
}

/** The shortcut action registry service. */
export interface ShortcutRegistry {
  /**
   * Contribute one keyboard action. The chord dispatches in registration
   * order when several actions share a binding.
   * @param contribution - the action to mount.
   * @returns the disposer removing the action (and its Settings row entry).
   */
  registerAction: (contribution: ShortcutActionContribution) => () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The shortcut action registry, provided by @khorsheed/dsh-ui-shortcuts. */
    shortcuts: ShortcutRegistry
  }
}
