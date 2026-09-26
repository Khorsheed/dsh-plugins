// @vitest-environment jsdom
// apply wiring: the shortcut settings card registers, and the global
// keydown/mousedown listeners drive the public services — steer-send submits
// through conversation.input, Escape-pause cancels through the scope-addressed
// conversation face, gated on the composer's own Escape layering (a consumed
// key, an outside target, IME composition, repeats, capture mode, and unbound
// actions all stand down); compaction runs the `/compact` command through the
// session face; the right-sidebar toggle calls the probed ctx.sidebarRight
// service; and a
// mouse-bound action claims the button's down/up defaults.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionReference, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply, inject } from '@khorsheed/dsh-ui-shortcuts/client'
import type { ShortcutsRowInjected } from '../src/client/settings/ShortcutsRow.tsx'
import { UI_SHORTCUTS_NAMESPACE } from '../src/settings.ts'

const SID = 's1' as SessionId

type BenchOptions = {
  running?: boolean
  subagent?: SessionSnapshot['subagent']
  /** Whether the composition carries ui-sidebar-right's ctx.sidebarRight service. */
  sidebarRight?: boolean
  /** Make the service's write path throw, as it does with no mounted surface. */
  sidebarWriteThrows?: boolean
  /** Retain SID as the main-view (on-screen) session; false starts with nothing on screen. */
  current?: boolean
}

async function bench(over: BenchOptions = {}) {
  const runtime = await SlotTestRuntime.create()
  const submit = vi.fn()
  const cancel = vi.fn(() => Promise.resolve())
  // New-session rides the probed ctx.uiWorkspace navigation face (the official
  // New Session flow on both host lines); ui-workspace is not part of the test
  // runtime, so the composition stubs the probed service and records the call.
  const startSession = vi.fn()
  runtime.ctx.provide('uiWorkspace', { startSession })
  runtime.ctx.provide('conversation', {
    input: { for: () => ({ submit }) },
    cancel,
  } as never)
  // ui-sidebar-right provides this in production; the toggle action probes it.
  // ui-sidebar-right provides this in production; the toggle action probes it.
  // The fake deliberately carries ONLY the write verb: the action must not read
  // the face's `active()` (a never-opened column answers undefined with nothing
  // expanded yet, which is the state the gesture exists to expand).
  const toggleExpanded = vi.fn(() => {
    if (over.sidebarWriteThrows === true) throw new Error('sidebarRight: no session surface is mounted')
  })
  if (over.sidebarRight !== false) runtime.ctx.provide('sidebarRight', { toggleExpanded })
  runtime.ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  // The Plugins section declares the tab slot in production; the test root
  // declares it here so the registration lands.
  await runtime.root.declare({ 'settings.plugins.tab': { kind: 'list', scope: 'root' } }, (_p: { renderSlot?: unknown }) => null)
  const feature = await runtime.mount({ inject: [...inject], apply })
  // Compaction rides the public session face's command verb.
  const command = vi.fn(async () => ({ ok: true as const, value: { matched: true } }))
  await runtime.sessions.add({
    id: SID,
    snapshot: {
      running: over.running ?? false,
      ...(over.subagent !== undefined ? { subagent: over.subagent } : {}),
    },
    session: { command },
  })
  // The on-screen session: 0.1.6-alpha.2 reads the main-view retention count
  // (0.1.5's `current` field is gone), so tests drive it through real
  // references — release() stands in for "no session on screen".
  let mainView: SessionReference | undefined
  const setCurrent = async (id: SessionId | undefined): Promise<void> => {
    mainView?.release()
    mainView = id === undefined ? undefined : runtime.sessions.retain(id, { source: 'mainView' as never })
    await mainView?.ready
  }
  if (over.current !== false) await setCurrent(SID)
  return { runtime, feature, slots: runtime.slots, submit, cancel, startSession, toggleExpanded, command, setCurrent }
}

/** The inject face the settings card entry serves (reaches the apply-built policy). */
async function rowInjected(b: Awaited<ReturnType<typeof bench>>): Promise<ShortcutsRowInjected> {
  const entry = b.slots.entries('settings.plugins.tab').find(e => e.options.id === UI_SHORTCUTS_NAMESPACE)
  if (entry === undefined) throw new Error('shortcuts settings card not registered')
  return (entry.inject as unknown as () => ShortcutsRowInjected)()
}

/**
 * A catalog row whose main-view count names no live generation — the masked
 * gap: the id reads as on-screen while scope() has nothing to borrow.
 */
function ghostRow(id: SessionId) {
  return {
    id, displayTitle: id, running: false, blank: false, updatedAt: 99,
    retainedBy: { mainView: 1 },
  }
}

/** A composer-shaped textarea target for the Escape layering gate. */
function withComposerTextarea(fn: (textarea: HTMLTextAreaElement) => void): void {
  const card = document.createElement('div')
  card.setAttribute('data-composer-card', '')
  const textarea = document.createElement('textarea')
  card.appendChild(textarea)
  document.body.appendChild(card)
  try {
    fn(textarea)
  } finally {
    card.remove()
  }
}

afterEach(() => {
  document.body.textContent = ''
})

describe('ui-shortcuts apply', () => {
  it('registers the shortcut settings card', async () => {
    const b = await bench()
    expect(b.slots.entries('settings.plugins.tab').map(entry => entry.options.id)).toContain(UI_SHORTCUTS_NAMESPACE)
    await b.runtime.dispose()
  })

  it('Ctrl/Cmd+S steer-sends the current draft and suppresses the browser save', async () => {
    const b = await bench()
    const ctrl = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })
    document.dispatchEvent(ctrl)
    expect(b.submit).toHaveBeenCalledWith('steer')
    expect(ctrl.defaultPrevented).toBe(true)

    const cmd = new KeyboardEvent('keydown', { key: 'S', metaKey: true, bubbles: true, cancelable: true })
    document.dispatchEvent(cmd)
    expect(b.submit).toHaveBeenCalledTimes(2)
    await b.runtime.dispose()
  })

  it('Ctrl/Cmd+O starts a new session through the probed uiWorkspace face and suppresses the browser open-file', async () => {
    const b = await bench()
    const ctrl = new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, bubbles: true, cancelable: true })
    document.dispatchEvent(ctrl)
    expect(b.startSession).toHaveBeenCalledTimes(1)
    expect(ctrl.defaultPrevented).toBe(true)

    const cmd = new KeyboardEvent('keydown', { key: 'O', metaKey: true, bubbles: true, cancelable: true })
    document.dispatchEvent(cmd)
    expect(b.startSession).toHaveBeenCalledTimes(2)
    await b.runtime.dispose()
  })

  it('Ctrl/Cmd+Shift+X compacts through the session command face', async () => {
    const b = await bench()
    const chord = new KeyboardEvent('keydown', { key: 'x', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })
    document.dispatchEvent(chord)
    expect(b.command).toHaveBeenCalledWith('/compact')
    expect(chord.defaultPrevented).toBe(true)

    // Without a current session the gate stands the gesture down before the
    // browser default on the chord is claimed.
    await b.setCurrent(undefined)
    const gated = new KeyboardEvent('keydown', { key: 'x', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })
    document.dispatchEvent(gated)
    expect(b.command).toHaveBeenCalledTimes(1)
    expect(gated.defaultPrevented).toBe(false)
    await b.runtime.dispose()
  })

  it('the shipped right-sidebar binding is a middle click; it toggles through the probed ctx.sidebarRight and degrades without it', async () => {
    const b = await bench()
    const down = new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true })
    document.dispatchEvent(down)
    expect(b.toggleExpanded).toHaveBeenCalledTimes(1)
    expect(down.defaultPrevented).toBe(true)
    await b.runtime.dispose()

    // A composition without the right column keeps every other shortcut alive;
    // the gated action never claims the gesture either.
    const bare = await bench({ sidebarRight: false })
    const orphan = new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true })
    document.dispatchEvent(orphan)
    expect(orphan.defaultPrevented).toBe(false)
    await bare.runtime.dispose()
  })

  it('the gesture expands a right column that has never been opened', async () => {
    // Regression: gating on the service's `active()` read stands the gesture
    // down exactly when the user wants to open a never-opened column (nothing
    // is expanded yet, so there is no active tab). The bench's fake exposes
    // only the write verb, so reading `active()` would also throw here.
    const b = await bench()
    const down = new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true })
    document.dispatchEvent(down)
    expect(b.toggleExpanded).toHaveBeenCalledTimes(1)
    expect(down.defaultPrevented).toBe(true)
    await b.runtime.dispose()
  })

  it('the gesture stands down with no session on screen, and survives a seat that throws', async () => {
    // No session: there is no column of this session's to write to, so the
    // button must not be claimed either.
    const noSession = await bench()
    await noSession.setCurrent(undefined)
    const idle = new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true })
    document.dispatchEvent(idle)
    expect(noSession.toggleExpanded).not.toHaveBeenCalled()
    expect(idle.defaultPrevented).toBe(false)
    await noSession.runtime.dispose()

    // A seat whose write face throws (the window before it binds) must not
    // escape the listener: the gesture is claimed and swallowed.
    const throwing = await bench({ sidebarWriteThrows: true })
    const throwingDown = new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true })
    document.dispatchEvent(throwingDown)
    expect(throwing.toggleExpanded).toHaveBeenCalledTimes(1)
    expect(throwingDown.defaultPrevented).toBe(true)
    await throwing.runtime.dispose()
  })

  it('a mouse-bound action runs on mousedown and claims that button defaults', async () => {
    const b = await bench()
    const injected = await rowInjected(b)
    injected.setPreference('toggleSidebar', { kind: 'mouse', modifiers: [], button: 1 })
    // The primary button is not part of the vocabulary: a left click never dispatches.
    const primary = new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true })
    document.dispatchEvent(primary)
    expect(b.toggleExpanded).not.toHaveBeenCalled()
    expect(primary.defaultPrevented).toBe(false)

    // The middle button runs the action and claims autoscroll (Windows) /
    // primary-selection paste (Linux), which hang off the down event.
    const down = new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true })
    document.dispatchEvent(down)
    expect(b.toggleExpanded).toHaveBeenCalledTimes(1)
    expect(down.defaultPrevented).toBe(true)

    // The other defaults a claimed binding owns surface later: open-link-in-
    // new-tab on auxclick, the context menu on contextmenu. Neither re-runs
    // the action.
    const aux = new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true })
    document.dispatchEvent(aux)
    expect(aux.defaultPrevented).toBe(true)
    const menu = new MouseEvent('contextmenu', { button: 2, bubbles: true, cancelable: true })
    document.dispatchEvent(menu)
    expect(menu.defaultPrevented).toBe(false) // button 2 is not the bound button
    expect(b.toggleExpanded).toHaveBeenCalledTimes(1)
    await b.runtime.dispose()
  })

  it('a right-button binding claims the system context menu instead', async () => {
    const b = await bench()
    const injected = await rowInjected(b)
    injected.setPreference('toggleSidebar', { kind: 'mouse', modifiers: [], button: 2 })
    // The down event runs the action, as with any mouse binding.
    const down = new MouseEvent('mousedown', { button: 2, bubbles: true, cancelable: true })
    document.dispatchEvent(down)
    expect(b.toggleExpanded).toHaveBeenCalledTimes(1)
    expect(down.defaultPrevented).toBe(true)
    // The context menu is not a preventable default of the down event, so the
    // claimed binding owns it on `contextmenu` too.
    const menu = new MouseEvent('contextmenu', { button: 2, bubbles: true, cancelable: true })
    document.dispatchEvent(menu)
    expect(menu.defaultPrevented).toBe(true)
    await b.runtime.dispose()
  })

  it('recording a binding and the yield tier both stand mouse dispatch down', async () => {
    const b = await bench()
    const injected = await rowInjected(b)
    injected.setPreference('toggleSidebar', { kind: 'mouse', modifiers: [], button: 1 })
    // Recording another action claims the pointer too.
    injected.setCapturing('pause')
    const recording = new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true })
    document.dispatchEvent(recording)
    expect(b.toggleExpanded).not.toHaveBeenCalled()
    expect(recording.defaultPrevented).toBe(false)
    injected.setCapturing(null)

    // A yield-tier mouse action stands down while an overlay owns the pointer.
    const registry = b.runtime.ctx.get('shortcuts')!
    const run = vi.fn()
    const dispose = registry.registerAction({
      id: 'test.yieldMouse',
      label: { ns: 'ui-shortcuts', key: 'action.pause' },
      description: { ns: 'ui-shortcuts', key: 'action.pause.desc' },
      defaultBinding: { kind: 'mouse', modifiers: [], button: 2 },
      layering: 'yield',
      run,
    })
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)
    document.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true, cancelable: true }))
    expect(run).not.toHaveBeenCalled()
    dialog.remove()
    document.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true, cancelable: true }))
    expect(run).toHaveBeenCalledTimes(1)
    dispose()
    await b.runtime.dispose()
  })

  it('Ctrl/Cmd+O stands down while unbound and while recording', async () => {
    const b = await bench()
    const injected = await rowInjected(b)
    injected.setPreference('newSession', { kind: 'none' })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, bubbles: true }))
    expect(b.startSession).not.toHaveBeenCalled()
    injected.reset('newSession')
    // Recording another action claims the keyboard: the chord stands down.
    injected.setCapturing('pause')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, bubbles: true, cancelable: true }))
    expect(b.startSession).not.toHaveBeenCalled()
    injected.setCapturing(null)
    await b.runtime.dispose()
  })

  it('a contributed action dispatches its chord, honors its availability gate, and its disposer removes it', async () => {
    const b = await bench()
    const registry = b.runtime.ctx.get('shortcuts')!
    const run = vi.fn()
    let available = true
    const dispose = registry.registerAction({
      id: 'test.contributed',
      label: { ns: 'ui-shortcuts', key: 'action.pause' },
      description: { ns: 'ui-shortcuts', key: 'action.pause.desc' },
      defaultBinding: { kind: 'key', modifiers: ['primary'], key: 'k' },
      layering: 'global',
      available: () => available,
      run,
    })
    const chord = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true })
    document.dispatchEvent(chord)
    expect(run).toHaveBeenCalledTimes(1)
    expect(chord.defaultPrevented).toBe(true)
    // The availability gate stands the chord down.
    available = false
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }))
    expect(run).toHaveBeenCalledTimes(1)
    // The disposer removes the action from dispatch.
    dispose()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }))
    expect(run).toHaveBeenCalledTimes(1)
    await b.runtime.dispose()
  })

  it('Ctrl+S stands down without a current session, a current ghost, or an unbound action', async () => {
    const b = await bench()
    // No current session.
    await b.setCurrent(undefined)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))
    expect(b.submit).not.toHaveBeenCalled()
    // A main-view row with no live generation (masked gap) resolves no scope.
    b.runtime.sessions.list.update((draft) => { draft.byId['ghost' as SessionId] = ghostRow('ghost' as SessionId) as never })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))
    expect(b.submit).not.toHaveBeenCalled()
    // Unbound action.
    await b.setCurrent(SID)
    const injected = await rowInjected(b)
    injected.setPreference('steerSend', { kind: 'none' })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))
    expect(b.submit).not.toHaveBeenCalled()
    await b.runtime.dispose()
  })

  it('reads the 0.1.5-shaped list current when no row carries main-view retention', async () => {
    // The 0.1.5 host line publishes `current` with no per-row retainedBy; the
    // fallback keeps the gesture live there. The generation a real current
    // session always has is materialized by a non-main-view reference.
    const b = await bench({ current: false })
    b.runtime.sessions.retainFor(b.runtime.ctx, SID)
    b.runtime.sessions.list.update((draft) => { (draft as { current?: SessionId }).current = SID })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }))
    expect(b.submit).toHaveBeenCalledWith('steer')
    await b.runtime.dispose()
  })

  it('Escape pauses the running turn globally, from the composer or any non-editable surface', async () => {
    const b = await bench({ running: true })
    // Composer textarea: the classic path still fires.
    withComposerTextarea((textarea) => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(b.cancel).toHaveBeenCalledTimes(1)
    // No editable focus (sidebar, body): the global pause fires too.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(b.cancel).toHaveBeenCalledTimes(2)
    await b.runtime.dispose()
  })

  it('Escape stands down for open overlays and non-composer editables', async () => {
    const b = await bench({ running: true })
    // An open dialog/menu/listbox owns Escape: those layers close without
    // preventDefault, and their DOM is still present during dispatch.
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(b.cancel).not.toHaveBeenCalled()
    dialog.remove()
    // Another editable (inline rename, search input) keeps its own Escape.
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(b.cancel).not.toHaveBeenCalled()
    input.remove()
    // Once the surface is clear the global pause fires again.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(b.cancel).toHaveBeenCalledTimes(1)
    await b.runtime.dispose()
  })

  it('Escape respects composer layering: a consumed key never pauses', async () => {
    const b = await bench({ running: true })
    withComposerTextarea((textarea) => {
      // The slash menu consumed the key: the composer preventDefaults, the
      // plugin reads the flag and stands down.
      const consume = (event: Event): void => { event.preventDefault() }
      textarea.addEventListener('keydown', consume)
      try {
        const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        textarea.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(true)
        expect(b.cancel).not.toHaveBeenCalled()
      } finally {
        textarea.removeEventListener('keydown', consume)
      }
    })
    await b.runtime.dispose()
  })

  it('Escape does nothing while idle, for one-shot subagents, or with pause unbound', async () => {
    const idle = await bench()
    withComposerTextarea((textarea) => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(idle.cancel).not.toHaveBeenCalled()
    await idle.runtime.dispose()

    const oneShot = await bench({
      running: true,
      subagent: {
        address: { parentSessionId: 'parent' as SessionId, childSessionId: SID, mode: 'one-shot' },
        parentAvailable: true,
      },
    })
    withComposerTextarea((textarea) => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(oneShot.cancel).not.toHaveBeenCalled()
    await oneShot.runtime.dispose()

    const unbound = await bench({ running: true })
    const injected = await rowInjected(unbound)
    injected.setPreference('pause', { kind: 'none' })
    withComposerTextarea((textarea) => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(unbound.cancel).not.toHaveBeenCalled()
    await unbound.runtime.dispose()
  })

  it('Escape stands down without a current session or with a current ghost', async () => {
    const noCurrent = await bench({ running: true, current: false })
    withComposerTextarea((textarea) => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(noCurrent.cancel).not.toHaveBeenCalled()
    await noCurrent.runtime.dispose()

    const ghost = await bench({ running: true, current: false })
    ghost.runtime.sessions.list.update((draft) => { draft.byId['ghost' as SessionId] = ghostRow('ghost' as SessionId) as never })
    withComposerTextarea((textarea) => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(ghost.cancel).not.toHaveBeenCalled()
    await ghost.runtime.dispose()
  })

  it('a failed pause surfaces through the session snapshot, never here', async () => {
    const b = await bench({ running: true })
    b.cancel.mockRejectedValueOnce(new Error('boom'))
    withComposerTextarea((textarea) => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(b.cancel).toHaveBeenCalledTimes(1)
    await b.runtime.dispose()
  })

  it('the settings card face writes and resets bindings', async () => {
    const b = await bench()
    const injected = await rowInjected(b)
    injected.reset('pause')
    expect(b.slots.entries('settings.plugins.tab').map(entry => entry.options.id)).toContain(UI_SHORTCUTS_NAMESPACE)
    await b.runtime.dispose()
  })

  it('Escape pauses a running continuable subagent like the composer Stop button', async () => {
    const b = await bench({
      running: true,
      subagent: {
        address: { parentSessionId: 'parent' as SessionId, childSessionId: SID, mode: 'continuable' },
        parentAvailable: true,
      },
    })
    withComposerTextarea((textarea) => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(b.cancel).toHaveBeenCalledTimes(1)
    await b.runtime.dispose()
  })

  it('IME composition and held repeats never trigger shortcuts', async () => {
    const b = await bench({ running: true })
    fireEvent.keyDown(document, { key: 's', ctrlKey: true, isComposing: true })
    expect(b.submit).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 's', ctrlKey: true, keyCode: 229 })
    expect(b.submit).not.toHaveBeenCalled()
    withComposerTextarea((textarea) => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, repeat: true }))
    })
    expect(b.cancel).not.toHaveBeenCalled()
    await b.runtime.dispose()
  })

  it('key capture stands the global wiring down', async () => {
    const b = await bench({ running: true })
    const injected = await rowInjected(b)
    injected.setCapturing('pause')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))
    expect(b.submit).not.toHaveBeenCalled()
    withComposerTextarea((textarea) => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(b.cancel).not.toHaveBeenCalled()
    injected.setCapturing(null)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))
    expect(b.submit).toHaveBeenCalledTimes(1)
    await b.runtime.dispose()
  })
})
