/**
 * Browser shortcuts plugin: the shortcut action registry provider plus five
 * built-in actions (pause the running turn, steer-send the draft, new
 * session, compact the context, toggle the right sidebar) bound to user-chosen
 * key chords or mouse buttons. Pure UI over public services — the built-in
 * handlers never reach ui-conversation internals, and every action (built-in
 * or contributed by another plugin through `ctx.shortcuts`) rides the same
 * registration path:
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
 * - compact runs the host's `/compact` command through the public session
 *   face (`ISession.command`) — the typed slash command's own admission path,
 *   so the outcome is the same flow node. `global`.
 * - toggle-right-sidebar calls ui-sidebar-right's public
 *   `ctx.sidebarRight.toggleExpanded()` — the right column's own
 *   expand/collapse action. Probed at dispatch time, not injected, so a
 *   composition without the right column keeps every other shortcut alive;
 *   the gesture stands down while no session surface is mounted, because the
 *   write face has no session to write to. `global`.
 *
 * Gestures: a preference is a key chord or a mouse button (the middle and
 * secondary buttons — see settings.ts for why the primary button is not
 * bindable). Mouse dispatch mirrors key dispatch: the down event runs the
 * action and, for `global` actions, claims the browser defaults that hang off
 * it (autoscroll on Windows, primary-selection paste on Linux) plus the ones
 * that only surface later (`auxclick`'s open-link-in-new-tab, the secondary
 * button's context menu).
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
import { matches, matchesMouse } from './bindings.ts'
import { ShortcutRegistryRuntime } from './registry.ts'
import { DEFAULT_PREFERENCES, UI_SHORTCUTS_NAMESPACE } from '../settings.ts'
import type { ShortcutPreference, ShortcutSettings } from '../settings.ts'
import { ShortcutsCard } from './settings/ShortcutsCard.tsx'
import type { ShortcutsRowInjected } from './settings/ShortcutsRow.tsx'
import type { ShortcutActionContribution, ShortcutLayering } from './contract.ts'
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
function isComposerTextarea(event: Event): boolean {
  return event.target instanceof HTMLTextAreaElement
    && event.target.closest('[data-composer-card]') !== null
}

/**
 * Escape inside an editable other than the composer belongs to that field's
 * own semantics (inline rename, search boxes); only the composer textarea's
 * Escape is the pause gesture.
 */
function isNonComposerEditable(event: Event): boolean {
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
 * The `yield` tier's stand-down test, shared by the key and mouse paths:
 * a consumed event (component handlers run before the document bubble
 * listener, so the flag is already set; an overlay's DOM is still present
 * during dispatch because its state-driven unmount lands afterwards), an open
 * overlay, or a non-composer editable target.
 * @param event - the dispatching event.
 * @returns whether another surface owns this event.
 */
function yieldsToOthers(event: KeyboardEvent | MouseEvent): boolean {
  return event.defaultPrevented || anyOverlayOpen() || isNonComposerEditable(event)
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
 * Compact the current session's model history by running the host's
 * `/compact` command through the public session face — the client end of the
 * very command the composer's slash menu executes, never a private compaction
 * service. Admission is the host's: a busy agent answers with the same error
 * flow node the typed command produces, so a stray press is visible rather
 * than silently swallowed.
 * @param ctx - client root context.
 */
function compactCurrentSession(ctx: Context): void {
  const sessions = ctx.get('sessions')
  const id = sessions?.list.getSnapshot().current
  // v8 ignore next -- defensive: the inject list guarantees the sessions service.
  if (sessions === undefined || id === undefined) return
  const session = sessions.binding(id)?.session
  if (session === undefined) return
  void session.command('/compact').catch(() => {
    // The host executor durably logs the command lifecycle and renders the
    // outcome as a flow node, exactly as the typed command's does.
  })
}

/** Minimal face of ui-sidebar-right's `ctx.sidebarRight` this plugin probes for. */
interface RightSidebarFace {
  /** Collapse an expanded right column, or expand a collapsed one. */
  toggleExpanded(): void
}

/**
 * The live right-column service, or undefined in a composition without the
 * right column.
 *
 * Deliberately **not** gated on the face's own `active()` read. A column that
 * has never been opened has no active tab, and that is precisely the state this
 * gesture exists to expand — using `active()` as a seat probe made the shortcut
 * do nothing until something else opened the panel first. The seat check lives
 * on the write path instead (see {@link toggleRightSidebar}).
 * @param ctx - client root context.
 * @returns the service face, or undefined.
 */
function rightSidebarService(ctx: Context): RightSidebarFace | undefined {
  return ctx.reflect.get('sidebarRight') as RightSidebarFace | undefined
}

/**
 * Toggle the right column through ui-sidebar-right's public
 * `ctx.sidebarRight.toggleExpanded()` — the same action the column's own
 * expand/collapse control performs. Probed rather than injected so a
 * composition without the right column keeps every other shortcut alive; the
 * minimal local face is why this package carries no dependency on it.
 *
 * The write face throws while no session surface is mounted, which the action's
 * gate normally rules out; the catch is the backstop for the window before the
 * seat binds and for a session whose surface was never materialized.
 * @param ctx - client root context.
 */
function toggleRightSidebar(ctx: Context): void {
  try {
    rightSidebarService(ctx)?.toggleExpanded()
  } catch {
    // No session surface to write to; the gesture is already claimed, so the
    // failure is swallowed rather than escaping the listener.
  }
}

/**
 * The action one event dispatches to, or undefined. First match in
 * registration order wins; a gated-off action never shadows a later one.
 * @param registry - the live registry.
 * @param layering - which action tier the listener serves.
 * @param test - the gesture test for this event kind.
 * @returns the action to run.
 */
function matchAction(
  registry: ShortcutRegistryRuntime,
  layering: ShortcutLayering,
  test: (preference: ShortcutPreference) => boolean,
): ShortcutActionContribution | undefined {
  for (const action of registry.actions.getSnapshot()) {
    if (action.layering !== layering) continue
    if (!test(registry.preferenceOf(action.id))) continue
    if (action.available?.() === false) continue
    return action
  }
  return undefined
}

/**
 * Dispatch one keydown against the registered actions of one layering.
 * `global` actions suppress the browser default, `yield` actions stand down
 * when anything else owns the key.
 * @param event - the keydown event.
 * @param layering - which action tier this listener serves.
 * @param registry - the live registry.
 */
function dispatch(event: KeyboardEvent, layering: ShortcutLayering, registry: ShortcutRegistryRuntime): void {
  if (registry.capturing.getSnapshot() !== null) return
  if (isComposing(event) || event.repeat) return
  if (layering === 'yield' && yieldsToOthers(event)) return
  const action = matchAction(registry, layering, preference => matches(event, preference))
  if (action === undefined) return
  if (layering === 'global') event.preventDefault() // the browser gesture (save, open-file) must not fire
  action.run()
}

/**
 * Dispatch one mousedown against the registered actions of one layering. A
 * claimed gesture claims the button's down action too — autoscroll (Windows)
 * and primary-selection paste (Linux) hang off it.
 * @param event - the mousedown event.
 * @param layering - which action tier this listener serves.
 * @param registry - the live registry.
 */
function dispatchMouse(event: MouseEvent, layering: ShortcutLayering, registry: ShortcutRegistryRuntime): void {
  if (registry.capturing.getSnapshot() !== null) return
  if (layering === 'yield' && yieldsToOthers(event)) return
  const action = matchAction(registry, layering, preference => matchesMouse(event, preference))
  if (action === undefined) return
  event.preventDefault()
  action.run()
}

/**
 * Suppress the browser defaults that hang off the *later* halves of a claimed
 * global mouse gesture: middle-clicking a link opens it in a new tab on
 * `auxclick` (never preventable from the down event), and the secondary
 * button's system context menu is only preventable on `contextmenu`.
 * @param event - the auxclick or contextmenu event.
 * @param registry - the live registry.
 */
function suppressAuxiliaryDefault(event: MouseEvent, registry: ShortcutRegistryRuntime): void {
  if (registry.capturing.getSnapshot() !== null) return
  if (matchAction(registry, 'global', preference => matchesMouse(event, preference)) === undefined) return
  event.preventDefault()
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
  ctx.effect(() => registry.registerAction({
    id: 'compact',
    label: { ns: NS, key: 'action.compact' },
    description: { ns: NS, key: 'action.compact.desc' },
    defaultBinding: DEFAULT_PREFERENCES['compact']!,
    layering: 'global',
    // Without a current session there is nothing to compact; standing the
    // gesture down also leaves the browser default on this chord alone.
    available: () => ctx.get('sessions')?.list.getSnapshot().current !== undefined,
    run: () => { compactCurrentSession(ctx) },
  }), 'ui-shortcuts: action compact')
  ctx.effect(() => registry.registerAction({
    // The id stays `toggleSidebar` from the first cut of this action: it is a
    // durable settings key, and the retarget from the left column to the right
    // one must not orphan a binding the user already recorded under it.
    id: 'toggleSidebar',
    label: { ns: NS, key: 'action.toggleSidebar' },
    description: { ns: NS, key: 'action.toggleSidebar.desc' },
    defaultBinding: DEFAULT_PREFERENCES['toggleSidebar']!,
    layering: 'global',
    // A composition without the right column has nothing to toggle, and with
    // no session on screen there is no column of this session's to write to.
    // Neither case may claim the gesture (and with it the button's browser
    // default) for a no-op.
    available: () => rightSidebarService(ctx) !== undefined
      && ctx.get('sessions')?.list.getSnapshot().current !== undefined,
    run: () => { toggleRightSidebar(ctx) },
  }), 'ui-shortcuts: action toggleSidebar')

  ctx.effect(() => {
    const onKeyDownCapture = (event: KeyboardEvent): void => { dispatch(event, 'global', registry) }
    const onKeyDownBubble = (event: KeyboardEvent): void => { dispatch(event, 'yield', registry) }
    const onMouseDownCapture = (event: MouseEvent): void => { dispatchMouse(event, 'global', registry) }
    const onMouseDownBubble = (event: MouseEvent): void => { dispatchMouse(event, 'yield', registry) }
    const onAuxClick = (event: MouseEvent): void => { suppressAuxiliaryDefault(event, registry) }
    const onContextMenu = (event: MouseEvent): void => { suppressAuxiliaryDefault(event, registry) }
    document.addEventListener('keydown', onKeyDownCapture, true)
    document.addEventListener('keydown', onKeyDownBubble)
    document.addEventListener('mousedown', onMouseDownCapture, true)
    document.addEventListener('mousedown', onMouseDownBubble)
    document.addEventListener('auxclick', onAuxClick, true)
    document.addEventListener('contextmenu', onContextMenu, true)
    return () => {
      document.removeEventListener('keydown', onKeyDownCapture, true)
      document.removeEventListener('keydown', onKeyDownBubble)
      document.removeEventListener('mousedown', onMouseDownCapture, true)
      document.removeEventListener('mousedown', onMouseDownBubble)
      document.removeEventListener('auxclick', onAuxClick, true)
      document.removeEventListener('contextmenu', onContextMenu, true)
    }
  }, 'ui-shortcuts: global keydown + mousedown')

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
