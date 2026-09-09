/**
 * Browser shortcuts plugin: the shortcut action registry provider plus three
 * built-in actions (pause the running turn, steer-send the draft, new
 * session) bound to user-chosen keys. Pure UI over public services — the
 * built-in handlers never reach ui-conversation internals, and every action
 * (built-in or contributed by another plugin through `ctx.shortcuts`) rides
 * the same registration path:
 *
 * - steer-send submits the current session's draft through the public
 *   `conversation.input.for(scope).submit('steer')` facade.
 * - pause cancels the current session's running turn through the scope-addressed
 *   `conversation.cancel()` (the same action as the composer's Stop button).
 *   Its layering is `yield`: Escape yields to a consumed keydown
 *   (`defaultPrevented` — the composer's slash menu, popupSelect), an open
 *   overlay (`[role="dialog"]/menu/listbox` — modals, menus, and the settings
 *   panel close on Escape without preventDefault), or a non-composer editable
 *   target (inline rename, search fields).
 * - new-session starts a session through the public `sessions.create()` →
 *   `sessions.open()` pair (the same entry the sidebar New-session button
 *   rides). Its layering is `global`, like steer-send.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the Controller service merge (ctx.sessions).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the locale Context merge (ctx.locale), the settings-scope
// merge (ctx.settingsScope), and the conversation service merge
// (ctx.conversation) into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the ctx.slots service merge.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the settings.plugin.item keyed-slot SlotMap merge, so the card
// registration below type-checks against the official contract.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { matches } from './bindings.ts'
import { ShortcutRegistryRuntime } from './registry.ts'
import { DEFAULT_PREFERENCES, UI_SHORTCUTS_NAMESPACE } from '../settings.ts'
import type { ShortcutPreference, ShortcutSettings } from '../settings.ts'
import { ShortcutsCard } from './settings/ShortcutsCard.tsx'
import type { ShortcutsRowInjected } from './settings/ShortcutsRow.tsx'
import type { ShortcutLayering } from './contract.ts'
import { en, NS, zh, type ShortcutKey } from './locales.ts'

export type { ShortcutActionContribution, ShortcutLabelRef, ShortcutLayering, ShortcutRegistry } from './contract.ts'
import type {} from './contract.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The shortcut settings row copy. */
    shortcuts: ShortcutKey
  }
}

/** Services required by the shortcuts plugin. */
export const inject = ['slots', 'sessions', 'conversation', 'settingsScope', 'locale']

/** IME guard: a composition in flight never triggers a shortcut. */
function isComposing(event: KeyboardEvent): boolean {
  // keyCode 229 is the legacy IME-composition signal engines emit without isComposing.
  // oxlint-disable-next-line typescript/no-deprecated
  return event.isComposing || event.keyCode === 229
}

/** The composer's own key handling owns Escape when the event lands in its textarea. */
function isComposerTextarea(event: KeyboardEvent): boolean {
  return event.target instanceof HTMLTextAreaElement
    && event.target.closest('[data-composer-card]') !== null
}

/**
 * Escape inside an editable other than the composer belongs to that field's
 * own semantics (inline rename, search boxes); only the composer textarea's
 * Escape is the pause gesture.
 */
function isNonComposerEditable(event: KeyboardEvent): boolean {
  if (!(event.target instanceof HTMLElement) || isComposerTextarea(event)) return false
  return event.target instanceof HTMLTextAreaElement
    || event.target instanceof HTMLInputElement
    || event.target.isContentEditable
}

/** An open overlay (modal, menu, listbox popup) owns Escape: those layers close on Escape without preventDefault. */
function anyOverlayOpen(): boolean {
  return document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]') !== null
}

/**
 * Steer-send the current session's draft through the public input facade.
 * Absent services or an absent current session are silent no-ops; the machine
 * itself rejects an empty draft.
 * @param ctx - client root context.
 */
function steerSendDraft(ctx: Context): void {
  const sessions = ctx.get('sessions')
  const id = sessions?.list.getSnapshot().current
  // v8 ignore next -- defensive: the inject list guarantees the sessions service.
  if (sessions === undefined || id === undefined) return
  const scope = sessions.scope(id)
  if (scope === undefined) return
  const conversation = ctx.get('conversation')
  conversation?.input.for(scope).submit('steer')
}

/**
 * Pause the current session's running turn (the Stop-button action), honoring
 * the composer's Stop visibility: ordinary sessions and continuable children
 * stop; one-shot subagents do not. Failures surface via the session snapshot's
 * promptError, exactly as the composer's own stop path.
 * @param ctx - client root context.
 */
function pauseCurrentTask(ctx: Context): void {
  const sessions = ctx.get('sessions')
  const id = sessions?.list.getSnapshot().current
  // v8 ignore next -- defensive: the inject list guarantees the sessions service.
  if (sessions === undefined || id === undefined) return
  const scope = sessions.scope(id)
  if (scope === undefined) return
  const snapshot = sessions.binding(id)?.session.getSnapshot()
  // v8 ignore next -- defensive: a resolvable scope implies a live binding.
  if (snapshot === undefined) return
  if (!snapshot.running) return
  if (snapshot.subagent !== null && snapshot.subagent.address.mode !== 'continuable') return
  const conversation = scope.get('conversation')
  // v8 ignore next -- defensive: the plugin's inject list guarantees the conversation service.
  if (conversation === undefined) return
  void conversation.cancel().catch(() => {
    // Stop failure surfaces via snapshot.promptError; nothing to restore.
  })
}

/**
 * Start a new session through the public sessions service — the same
 * create-then-open pair the sidebar New-session button rides. An absent
 * service is a silent no-op.
 * @param ctx - client root context.
 */
function startNewSession(ctx: Context): void {
  const sessions = ctx.get('sessions')
  if (sessions === undefined) return
  void sessions.create().then(
    (id) => { sessions.open(id) },
    () => { /* the creation failure surfaces through the host's own error path */ },
  )
}

/**
 * Dispatch one keydown against the registered actions of one layering.
 * First match in registration order wins; `global` actions suppress the
 * browser default, `yield` actions stand down when anything else owns the key.
 * @param event - the keydown event.
 * @param layering - which action tier this listener serves.
 * @param registry - the live registry.
 */
function dispatch(event: KeyboardEvent, layering: ShortcutLayering, registry: ShortcutRegistryRuntime): void {
  if (registry.capturing.getSnapshot() !== null) return
  if (isComposing(event) || event.repeat) return
  for (const action of registry.actions.getSnapshot()) {
    if (action.layering !== layering) continue
    if (!matches(event, registry.preferenceOf(action.id))) continue
    if (action.available?.() === false) continue
    if (layering === 'yield') {
      // Component handlers run before document bubble listeners, so a
      // consumed key is visible here; an overlay's DOM is still present
      // during dispatch (its state-driven unmount lands after it).
      if (event.defaultPrevented) return
      if (anyOverlayOpen()) return
      if (isNonComposerEditable(event)) return
    } else {
      event.preventDefault() // the browser gesture (save, open-file) must not fire
    }
    action.run()
    return
  }
}

/**
 * Browser plugin body: provide the registry, bind the built-in actions
 * through it, and register the shortcut settings card. The binding snapshots
 * are read in the handlers (event-handler code may read live snapshots); the
 * wiring stands down entirely while the card records a new binding.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  const registry = new ShortcutRegistryRuntime(
    ctx.settingsScope.bind<ShortcutSettings>({ namespace: UI_SHORTCUTS_NAMESPACE }),
  )
  ctx.provide('shortcuts', registry)

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-shortcuts: dictionaries')

  // The built-ins register through the public face like any consumer.
  ctx.effect(() => registry.registerAction({
    id: 'pause',
    label: { ns: NS, key: 'action.pause' },
    description: { ns: NS, key: 'action.pause.desc' },
    defaultBinding: DEFAULT_PREFERENCES['pause']!,
    layering: 'yield',
    run: () => { pauseCurrentTask(ctx) },
  }), 'ui-shortcuts: action pause')
  ctx.effect(() => registry.registerAction({
    id: 'steerSend',
    label: { ns: NS, key: 'action.steerSend' },
    description: { ns: NS, key: 'action.steerSend.desc' },
    defaultBinding: DEFAULT_PREFERENCES['steerSend']!,
    layering: 'global',
    run: () => { steerSendDraft(ctx) },
  }), 'ui-shortcuts: action steerSend')
  ctx.effect(() => registry.registerAction({
    id: 'newSession',
    label: { ns: NS, key: 'action.newSession' },
    description: { ns: NS, key: 'action.newSession.desc' },
    defaultBinding: DEFAULT_PREFERENCES['newSession']!,
    layering: 'global',
    run: () => { startNewSession(ctx) },
  }), 'ui-shortcuts: action newSession')

  ctx.effect(() => {
    const onKeyDownCapture = (event: KeyboardEvent): void => { dispatch(event, 'global', registry) }
    const onKeyDownBubble = (event: KeyboardEvent): void => { dispatch(event, 'yield', registry) }
    document.addEventListener('keydown', onKeyDownCapture, true)
    document.addEventListener('keydown', onKeyDownBubble)
    return () => {
      document.removeEventListener('keydown', onKeyDownCapture, true)
      document.removeEventListener('keydown', onKeyDownBubble)
    }
  }, 'ui-shortcuts: global keydown')

  // The plugin configuration tab keys its cards on the settings namespace, so
  // the shortcut preferences card registers under UI_SHORTCUTS_NAMESPACE and
  // renders wherever the tab dispatches that key.
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: UI_SHORTCUTS_NAMESPACE,
    locale: NS,
    inject: (): ShortcutsRowInjected => ({
      hooks: {
        actions: registry.actions,
        preferences: registry.preferences,
        capturing: registry.capturing,
      },
      translate: (ns, key) => ctx.locale.bind(ns)(key),
      setPreference: (id, preference: ShortcutPreference) => { registry.setPreference(id, preference) },
      reset: (id) => { registry.reset(id) },
      setCapturing: (id) => { registry.capturing.set(id) },
    }),
  }, ShortcutsCard))
}
