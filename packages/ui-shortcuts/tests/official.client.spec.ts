// @vitest-environment jsdom
// The rc.2+ path: when the composition carries the official shortcuts service
// (dsh-client-shortcuts, resident in the web-app bundle), apply contributes
// steer-send and compact to it and stands down everything of its own — no
// `shortcuts` provide (cordis throws on the duplicate), no settings card, no
// global keydown/mousedown listeners.

import { describe, expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply, inject } from '@khorsheed/dsh-ui-shortcuts/client'

const SID = 's1' as SessionId

interface RegisteredCommand {
  id: string
  label: () => string
  defaults: Record<string, { code: string, modifiers: readonly string[] }>
  resolve(): { status: 'handled', run(): void } | { status: 'pass' }
}

async function bench() {
  const runtime = await SlotTestRuntime.create()
  const register = vi.fn((_command: RegisteredCommand) => vi.fn())
  // The official bundle rows mount before this package's in every rc.2
  // composition, so the service is already resident when apply runs.
  const official = { register, catalog: { getSnapshot: () => [] as never[] } }
  runtime.ctx.provide('shortcuts', official)
  const submit = vi.fn()
  runtime.ctx.provide('conversation', { input: { for: () => ({ submit }) } } as never)
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  // Compaction rides the public session face's command verb.
  const command = vi.fn(async () => ({ ok: true as const, value: { matched: true } }))
  await runtime.mount({ inject: [...inject], apply })
  await runtime.sessions.add({ id: SID, snapshot: {}, session: { command } })
  // The on-screen session: main-view retention, as the apply spec drives it.
  let mainView: SessionReference | undefined
  const setCurrent = async (id: SessionId | undefined): Promise<void> => {
    mainView?.release()
    mainView = id === undefined ? undefined : runtime.sessions.retain(id, { source: 'mainView' as never })
    await mainView?.ready
  }
  const commands = (): RegisteredCommand[] => register.mock.calls.map(call => call[0])
  return { runtime, official, submit, command, commands, setCurrent }
}

describe('ui-shortcuts apply on an rc.2 composition (official shortcuts service resident)', () => {
  it('contributes exactly steer-send and compact, and provides no registry of its own', async () => {
    const b = await bench()
    expect(b.commands().map(command => command.id)).toEqual(['ui-shortcuts.steerSend', 'ui-shortcuts.compact'])
    expect(b.runtime.ctx.get('shortcuts')).toBe(b.official)
    await b.runtime.dispose()
  })

  it('installs no global dispatch of its own — a Ctrl/Cmd+S keydown reaches no handler', async () => {
    const b = await bench()
    await b.setCurrent(SID)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }))
    expect(b.submit).not.toHaveBeenCalled()
    await b.runtime.dispose()
  })

  it('steer-send resolves handled with a session on screen and submits through the public input face', async () => {
    const b = await bench()
    await b.setCurrent(SID)
    const steerSend = b.commands().find(command => command.id === 'ui-shortcuts.steerSend')!
    expect(steerSend.label()).toBeTruthy()
    const resolution = steerSend.resolve()
    expect(resolution.status).toBe('handled')
    if (resolution.status !== 'handled') return
    resolution.run()
    expect(b.submit).toHaveBeenCalledWith('steer')
    await b.runtime.dispose()
  })

  it('compact resolves handled with a session on screen and runs /compact through the session face', async () => {
    const b = await bench()
    await b.setCurrent(SID)
    const compact = b.commands().find(command => command.id === 'ui-shortcuts.compact')!
    const resolution = compact.resolve()
    expect(resolution.status).toBe('handled')
    if (resolution.status !== 'handled') return
    resolution.run()
    expect(b.command).toHaveBeenCalledWith('/compact')
    await b.runtime.dispose()
  })

  it('both commands pass with nothing on screen', async () => {
    const b = await bench()
    for (const command of b.commands()) expect(command.resolve().status).toBe('pass')
    await b.runtime.dispose()
  })

  it('a registry refusal costs one command, not the plugin', async () => {
    // The official registry throws on policy violations (the rc.2 migration hit
    // `Unsupported Web shortcut` / `Reserved shortcut default`); a refusal must
    // degrade to one missing command, never a dead plugin entry.
    const runtime = await SlotTestRuntime.create()
    const register = vi.fn((command: RegisteredCommand) => {
      if (command.id === 'ui-shortcuts.steerSend') throw new Error('Reserved shortcut default')
      return vi.fn()
    })
    runtime.ctx.provide('shortcuts', { register, catalog: { getSnapshot: () => [] as never[] } })
    runtime.ctx.provide('conversation', { input: { for: () => ({ submit: vi.fn() }) } } as never)
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale)
    runtime.slots.installLocale(locale)
    await runtime.mount({ inject: [...inject], apply })
    expect(register.mock.calls.map(call => (call[0] as RegisteredCommand).id))
      .toEqual(['ui-shortcuts.steerSend', 'ui-shortcuts.compact'])
    await runtime.dispose()
  })

  it('keeps web defaults inside the official web admission policy', async () => {
    // The official registry rejects web defaults it considers browser-owned: a
    // bare primary+Key throws `Unsupported Web shortcut` at register time, and
    // web:linux admits only a three-chord allowlist (the first migration
    // attempt failed both ways). Pin: no web:linux default; macOS/Windows web
    // defaults carry primary plus a second modifier.
    const b = await bench()
    for (const command of b.commands()) {
      expect(Object.keys(command.defaults)).not.toContain('web:linux')
      for (const profile of ['web:macos', 'web:windows']) {
        const binding = command.defaults[profile]
        expect(binding?.modifiers, `${command.id} on ${profile}`).toContain('primary')
        expect(binding?.modifiers.length, `${command.id} on ${profile}`).toBeGreaterThanOrEqual(2)
      }
    }
    await b.runtime.dispose()
  })
})
