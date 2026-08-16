// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { createSnapshotStore, type SessionListState, type WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ShortcutsRow } from '../src/client/settings/ShortcutsRow.tsx'
import type { ShortcutsRowProps } from '../src/client/settings/ShortcutsRow.tsx'
import type { ShortcutAction, ShortcutPreference } from '../src/settings.ts'
import { DEFAULT_PREFERENCES } from '../src/settings.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  document.body.textContent = ''
})

function emptySessions() {
  return bindSnapshotSelector(createSnapshotStore<SessionListState>({
    ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  }))
}

function emptyWorkspaces() {
  return bindSnapshotSelector(createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  }))
}

function mount() {
  const pause = createSnapshotStore<ShortcutPreference>(DEFAULT_PREFERENCES.pause)
  const steerSend = createSnapshotStore<ShortcutPreference>(DEFAULT_PREFERENCES.steerSend)
  const capturing = createSnapshotStore<ShortcutAction | null>(null)
  const setPreference = vi.fn((action: ShortcutAction, preference: ShortcutPreference) => {
    const store = action === 'pause' ? pause : steerSend
    store.set(preference)
  })
  const reset = vi.fn((action: ShortcutAction) => {
    const store = action === 'pause' ? pause : steerSend
    store.set(DEFAULT_PREFERENCES[action])
  })
  const setCapturing = vi.fn((action: ShortcutAction | null) => { capturing.set(action) })
  const props: ShortcutsRowProps = {
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    usePause: bindSnapshotSelector(pause),
    useSteerSend: bindSnapshotSelector(steerSend),
    useCapturing: bindSnapshotSelector(capturing),
    setPreference,
    reset,
    setCapturing,
    t: makeTranslate(zh),
  }
  render(<ShortcutsRow {...props} />)
  return { pause, steerSend, capturing, setPreference, reset, setCapturing }
}

/** Keydown against the document capture listener the row installs while recording. */
function press(init: KeyboardEventInit): void {
  fireEvent.keyDown(document, init)
}

describe('ShortcutsRow', () => {
  it('describes both fixed actions and hides reset and the default hint at defaults', () => {
    mount()
    expect(screen.getByText('快捷键')).toBeDefined()
    expect(screen.getByText('暂停当前任务')).toBeDefined()
    expect(screen.getByText('插队发送')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Esc' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Ctrl/Cmd+S' })).toBeDefined()
    // At the shipped defaults there is nothing to reset and no hint to show.
    expect(screen.queryByRole('button', { name: '恢复默认' })).toBeNull()
    expect(screen.queryByText(/默认：/)).toBeNull()
  })

  it('records a plain key and a chord, and shows reset only while modified', () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Esc' }))
    expect(screen.getByRole('button', { name: /按下新键位/ })).toBeDefined()
    press({ key: 'x' })
    expect(b.setPreference).toHaveBeenCalledWith('pause', { kind: 'key', modifiers: [], key: 'x' })
    expect(screen.getByRole('button', { name: 'X' })).toBeDefined()
    // Pause now differs from its default: the hint and the reset control appear.
    expect(screen.getByText('默认：Esc')).toBeDefined()
    expect(screen.getAllByRole('button', { name: '恢复默认' })).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Ctrl/Cmd+S' }))
    press({ key: 's', ctrlKey: true })
    expect(b.setPreference).toHaveBeenCalledWith('steerSend', { kind: 'key', modifiers: ['primary'], key: 's' })
    // steerSend recorded its own default: still only pause offers a reset.
    expect(screen.getAllByRole('button', { name: '恢复默认' })).toHaveLength(1)
  })

  it('capture suppresses native defaults and ignores modifier-only keys', () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Esc' }))
    // A modifier-only key keeps the capture open and never completes (the
    // chord is fully claimed, so the keydown reports prevented).
    const shiftOnly = fireEvent.keyDown(document, { key: 'Shift', shiftKey: true })
    expect(shiftOnly).toBe(false)
    expect(b.setPreference).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /按下新键位/ })).toBeDefined()
    // The capture hint sits next to the recording field only while recording.
    expect(screen.getByText('Esc 取消 · Delete 解绑')).toBeDefined()
    // A chord completes and is prevented from reaching the browser (save).
    const chord = fireEvent.keyDown(document, { key: 's', ctrlKey: true })
    expect(chord).toBe(false) // preventDefault
    expect(b.setPreference).toHaveBeenCalledWith('pause', { kind: 'key', modifiers: ['primary'], key: 's' })
  })

  it('Escape cancels capture and Delete unbinds', () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Ctrl/Cmd+S' }))
    press({ key: 'Escape' })
    expect(b.setPreference).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Ctrl/Cmd+S' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Ctrl/Cmd+S' }))
    press({ key: 'Delete' })
    expect(b.setPreference).toHaveBeenCalledWith('steerSend', { kind: 'none' })
    expect(screen.getByRole('button', { name: '未绑定' })).toBeDefined()
  })

  it('reset restores the default and following a preference change updates the row', () => {
    const b = mount()
    act(() => { b.pause.set({ kind: 'key', modifiers: ['alt'], key: 'p' }) })
    // Only the modified action offers a reset.
    const resetButton = screen.getByRole('button', { name: '恢复默认' })
    fireEvent.click(resetButton)
    expect(b.reset).toHaveBeenCalledWith('pause')
    // Back at the default, the reset control leaves the row again.
    expect(screen.queryByRole('button', { name: '恢复默认' })).toBeNull()
    // The stores are authoritative: an external preference change re-renders.
    act(() => { b.steerSend.set({ kind: 'none' }) })
    expect(screen.getByRole('button', { name: '未绑定' })).toBeDefined()
  })

  it('clicking the binding button again cancels capture', () => {
    const b = mount()
    const trigger = screen.getByRole('button', { name: 'Esc' })
    fireEvent.click(trigger)
    expect(screen.getByRole('button', { name: /按下新键位/ })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /按下新键位/ }))
    expect(b.setCapturing).toHaveBeenLastCalledWith(null)
    expect(screen.getByRole('button', { name: 'Esc' })).toBeDefined()
  })

  it('abandons capture when the row unmounts', () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Esc' }))
    cleanup()
    expect(b.setCapturing).toHaveBeenLastCalledWith(null)
  })
})
