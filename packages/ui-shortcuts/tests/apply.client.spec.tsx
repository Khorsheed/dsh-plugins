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
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
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
}

async function bench(over: BenchOptions = {}) {
  const runtime = await SlotTestRuntime.create()
  const submit = vi.fn()
  const cancel = vi.fn(() => Promise.resolve())
  // The runtime provides a real sessions service at root; new-session rides
  // its create → open pair, so stub creation to return the fixture session.
  const startSession = vi.fn(async () => SID)
  runtime.sessions.stubCreate(startSession)
  runtime.ctx.provide('conversation', {
    input: { for: () => ({ submit }) },
    cancel,
  } as never)
  // ui-sidebar-right provides this in production; the toggle action probes it.
  // `active()` answers with the mounted surface's tab — the same seat probe the
  // action's gate reads, and undefined is what makes `toggleExpanded()` throw.
  // `seat.mounted` lets a test unmount the surface without providing the
  // service twice (a second provide fails loud).
  const seat = { mounted: true }
  const toggleExpanded = vi.fn()
  if (over.sidebarRight !== false) {
    runtime.ctx.provide('sidebarRight', {
      active: () => (seat.mounted ? { id: 'tab.guide' } : undefined),
      toggleExpanded,
    })
  }
  runtime.ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  // The Plugins section declares the keyed card slot in production; the test
  // root declares it here so the registration lands.
  await runtime.root.declare({ 'settings.plugin.item': { kind: 'keyed', scope: 'root' } }, (_p: { renderSlot?: unknown }) => null)
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
  return { runtime, feature, slots: runtime.slots, submit, cancel, startSession, toggleExpanded, seat, command }
}

/** The inject face the settings card entry serves (reaches the apply-built policy). */
async function rowInjected(b: Awaited<ReturnType<typeof bench>>): Promise<ShortcutsRowInjected> {
  const entry = b.slots.entries('settings.plugin.item').find(e => e.options.key === UI_SHORTCUTS_NAMESPACE)
  if (entry === undefined) throw new Error('shortcuts settings card not registered')
  return (entry.inject as unknown as () => ShortcutsRowInjected)()
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
    expect(b.slots.entries('settings.plugin.item').map(entry => entry.options.key)).toContain(UI_SHORTCUTS_NAMESPACE)
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

  it('Ctrl/Cmd+O starts a new session through the sessions service and suppresses the browser open-file', async () => {
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
    await b.runtime.sessions.setCurrent(undefined)
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

  it('a right column with no mounted session surface stands the gesture down', async () => {
    // The service is present but answers "no seat": `toggleExpanded()` would
    // throw, so the gate must stand the gesture down instead of claiming it.
    const b = await bench()
    b.seat.mounted = false
    const down = new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true })
    document.dispatchEvent(down)
    expect(b.toggleExpanded).not.toHaveBeenCalled()
    expect(down.defaultPrevented).toBe(false)
    await b.runtime.dispose()
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
      label: { ns: 'shortcuts', key: 'action.pause' },
      description: { ns: 'shortcuts', key: 'action.pause.desc' },
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
      label: { ns: 'shortcuts', key: 'action.pause' },
      description: { ns: 'shortcuts', key: 'action.pause.desc' },
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
    await b.runtime.sessions.setCurrent(undefined)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))
    expect(b.submit).not.toHaveBeenCalled()
    // A current id with no binding (masked gap) resolves no scope.
    b.runtime.sessions.list.update((draft) => { draft.current = 'ghost' as SessionId })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))
    expect(b.submit).not.toHaveBeenCalled()
    // Unbound action.
    await b.runtime.sessions.setCurrent(SID)
    const injected = await rowInjected(b)
    injected.setPreference('steerSend', { kind: 'none' })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))
    expect(b.submit).not.toHaveBeenCalled()
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
    const noCurrent = await bench({ running: true })
    await noCurrent.runtime.sessions.setCurrent(undefined)
    withComposerTextarea((textarea) => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(noCurrent.cancel).not.toHaveBeenCalled()
    await noCurrent.runtime.dispose()

    const ghost = await bench({ running: true })
    ghost.runtime.sessions.list.update((draft) => { draft.current = 'ghost' as SessionId })
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
    expect(b.slots.entries('settings.plugin.item').map(entry => entry.options.key)).toContain(UI_SHORTCUTS_NAMESPACE)
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
