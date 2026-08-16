// @vitest-environment jsdom
// apply wiring: the shortcut settings row registers, and the global keydown
// listeners drive the public services — steer-send submits through
// conversation.input, Escape-pause cancels through the scope-addressed
// conversation face, gated on the composer's own Escape layering (a consumed
// key, an outside target, IME composition, repeats, capture mode, and unbound
// actions all stand down).

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { ConversationSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject } from '@khorsheed/dsh-ui-shortcuts/client'
import type { ShortcutsRowInjected } from '../src/client/settings/ShortcutsRow.tsx'

const SID = 's1' as SessionId

type BenchOptions = {
  running?: boolean
  subagent?: ConversationSnapshot['subagent']
}

async function bench(over: BenchOptions = {}) {
  const runtime = await SlotTestRuntime.create()
  const submit = vi.fn()
  const cancel = vi.fn(() => Promise.resolve())
  // The runtime provides a real workspaces service at root; shadow its
  // startSession with a spy (providing a second one fails loud).
  const startSession = vi.fn()
  const workspaces = runtime.ctx.get('workspaces') as { startSession: () => void } | undefined
  if (workspaces !== undefined) workspaces.startSession = startSession
  runtime.provide('conversation', {
    input: { for: () => ({ submit }) },
    cancel,
  } as never)
  runtime.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.provide('locale', locale)
  runtime.slots.installLocale(locale)
  // The General section declares the item row in production; the test root
  // declares it here so the registration lands.
  await runtime.root.declare({ 'settings.general.item': { kind: 'list', scope: 'root' } }, (_p: { renderSlot?: unknown }) => null)
  const feature = await runtime.mount({ inject: [...inject], apply })
  await runtime.sessions.add({
    id: SID,
    snapshot: {
      running: over.running ?? false,
      ...(over.subagent !== undefined ? { subagent: over.subagent } : {}),
    },
  })
  return { runtime, feature, slots: runtime.slots, submit, cancel, startSession }
}

/** The inject face the settings row entry serves (reaches the apply-built policy). */
async function rowInjected(b: Awaited<ReturnType<typeof bench>>): Promise<ShortcutsRowInjected> {
  const entry = b.slots.entries('settings.general.item').find(e => e.options.id === 'shortcuts')
  if (entry === undefined) throw new Error('shortcuts settings row not registered')
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
  it('registers the shortcut settings row', async () => {
    const b = await bench()
    expect(b.slots.entries('settings.general.item').map(entry => entry.options.id)).toContain('shortcuts')
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

  it('Ctrl/Cmd+O starts a new session through the workspaces service and suppresses the browser open-file', async () => {
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

  it('the settings row face writes and resets bindings', async () => {
    const b = await bench()
    const injected = await rowInjected(b)
    injected.reset('pause')
    expect(b.slots.entries('settings.general.item').map(entry => entry.options.id)).toContain('shortcuts')
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
