/**
 * Browser shortcuts plugin: fixed actions (pause the running turn, steer-send
 * the draft) bound to user-chosen keys. Pure UI over public services — the
 * actions never reach ui-conversation internals:
 *
 * - steer-send submits the current session's draft through the public
 *   `conversation.input.for(scope).submit('steer')` facade.
 * - pause cancels the current session's running turn through the scope-addressed
 *   `conversation.cancel()` (the same action as the composer's Stop button).
 *   Escape is a GLOBAL pause that yields to whatever owns the key first: a
 *   consumed keydown (`defaultPrevented` — the composer's slash menu,
 *   popupSelect), an open overlay (`[role="dialog"]/menu/listbox` — modals,
 *   menus, and the settings panel close on Escape without preventDefault),
 *   or a non-composer editable target (inline rename, search fields).
 * - new-session starts a session through the public `workspaces.startSession()`
 *   (the same entry the sidebar New-session button calls), a global chord like
 *   steer-send.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale Context merge (ctx.locale), the settings-scope
// merge (ctx.settingsScope), and the conversation service merge
// (ctx.conversation) into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { matches } from './bindings.ts'
import { ShortcutBindingsPolicy } from './policy.ts'
import { UI_SHORTCUTS_NAMESPACE } from '../settings.ts'
import type { ShortcutPreference, ShortcutSettings } from '../settings.ts'
import { ShortcutsRow } from './settings/ShortcutsRow.tsx'
import type { ShortcutsRowInjected } from './settings/ShortcutsRow.tsx'
import { en, NS, zh, type ShortcutKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The shortcut settings row copy. */
    shortcuts: ShortcutKey
  }
}

/** Services required by the shortcuts plugin. */
export const inject = ['slots', 'sessions', 'conversation', 'workspaces', 'settingsScope', 'locale']

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
function steerSendDraft(ctx: ClientContext): void {
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
function pauseCurrentTask(ctx: ClientContext): void {
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
 * Start a new session through the public workspaces service — the same entry
 * the sidebar New-session button calls. An absent service is a silent no-op.
 * @param ctx - client root context.
 */
function startNewSession(ctx: ClientContext): void {
  ctx.get('workspaces')?.startSession()
}

/**
 * Browser plugin body: bind the fixed actions to the persisted keys and
 * register the shortcut settings row. The binding snapshots are read in the
 * handlers (event-handler code may read live snapshots); the wiring stands
 * down entirely while the settings row records a new binding.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const policy = new ShortcutBindingsPolicy(
    ctx.settingsScope.bind<ShortcutSettings>({ namespace: UI_SHORTCUTS_NAMESPACE }),
  )

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-shortcuts: dictionaries')

  ctx.effect(() => {
    const onKeyDownCapture = (event: KeyboardEvent): void => {
      if (policy.capturing.getSnapshot() !== null) return
      if (isComposing(event) || event.repeat) return
      if (matches(event, policy.steerSend.getSnapshot())) {
        event.preventDefault() // the browser save gesture must not fire
        steerSendDraft(ctx)
        return
      }
      if (matches(event, policy.newSession.getSnapshot())) {
        event.preventDefault() // the browser open-file gesture must not fire
        startNewSession(ctx)
      }
    }
    const onKeyDownBubble = (event: KeyboardEvent): void => {
      if (policy.capturing.getSnapshot() !== null) return
      if (isComposing(event) || event.repeat) return
      if (!matches(event, policy.pause.getSnapshot())) return
      // Global pause that yields to whoever owns Escape first: a consumed key
      // (composer slash menu, popupSelect — component handlers run before
      // document bubble listeners), an open overlay (modals/menus close on
      // Escape without preventDefault, and their DOM is still present during
      // dispatch), or a non-composer editable (inline rename, search).
      if (event.defaultPrevented) return
      if (anyOverlayOpen()) return
      if (isNonComposerEditable(event)) return
      pauseCurrentTask(ctx)
    }
    document.addEventListener('keydown', onKeyDownCapture, true)
    document.addEventListener('keydown', onKeyDownBubble)
    return () => {
      document.removeEventListener('keydown', onKeyDownCapture, true)
      document.removeEventListener('keydown', onKeyDownBubble)
    }
  }, 'ui-shortcuts: global keydown')

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'shortcuts',
    order: 30,
    locale: NS,
    inject: (): ShortcutsRowInjected => ({
      hooks: {
        pause: policy.pause,
        steerSend: policy.steerSend,
        newSession: policy.newSession,
        capturing: policy.capturing,
      },
      setPreference: (action, preference: ShortcutPreference) => { policy.setPreference(action, preference) },
      reset: (action) => { policy.reset(action) },
      setCapturing: (action) => { policy.capturing.set(action) },
    }),
  }, ShortcutsRow))
}
