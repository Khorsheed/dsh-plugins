// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionListState, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { ShortcutsRow } from '../src/client/settings/ShortcutsRow.tsx'
import { ShortcutsCard } from '../src/client/settings/ShortcutsCard.tsx'
import type { ShortcutsRowProps } from '../src/client/settings/ShortcutsRow.tsx'
import type { ShortcutActionContribution } from '../src/client/contract.ts'
import type { ShortcutPreference } from '../src/settings.ts'
import { DEFAULT_PREFERENCES } from '../src/settings.ts'
import { NS, zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  document.body.textContent = ''
})

/** The built-in actions as the row receives them from the registry. */
const ACTIONS: readonly ShortcutActionContribution[] = [
  {
    id: 'pause',
    label: { ns: NS, key: 'action.pause' },
    description: { ns: NS, key: 'action.pause.desc' },
    defaultBinding: DEFAULT_PREFERENCES['pause']!,
    layering: 'yield',
    run: () => {},
  },
  {
    id: 'steerSend',
    label: { ns: NS, key: 'action.steerSend' },
    description: { ns: NS, key: 'action.steerSend.desc' },
    defaultBinding: DEFAULT_PREFERENCES['steerSend']!,
    layering: 'global',
    run: () => {},
  },
  {
    id: 'newSession',
    label: { ns: NS, key: 'action.newSession' },
    description: { ns: NS, key: 'action.newSession.desc' },
    defaultBinding: DEFAULT_PREFERENCES['newSession']!,
    layering: 'global',
    run: () => {},
  },
]

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

function buildProps() {
  const t = makeTranslate(zh)
  const actions = createSnapshotStore<readonly ShortcutActionContribution[]>(ACTIONS)
  const preferences = createSnapshotStore<Record<string, ShortcutPreference>>({ ...DEFAULT_PREFERENCES })
  const capturing = createSnapshotStore<string | null>(null)
  const setPreference = vi.fn((id: string, preference: ShortcutPreference) => {
    preferences.set({ ...preferences.getSnapshot(), [id]: preference })
  })
  const reset = vi.fn((id: string) => {
    const action = ACTIONS.find(entry => entry.id === id)!
    preferences.set({ ...preferences.getSnapshot(), [id]: action.defaultBinding })
  })
  const setCapturing = vi.fn((id: string | null) => { capturing.set(id) })
  const props: ShortcutsRowProps = {
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useActions: bindSnapshotSelector(actions),
    usePreferences: bindSnapshotSelector(preferences),
    useCapturing: bindSnapshotSelector(capturing),
    translate: (_ns, key) => t(key),
    setPreference,
    reset,
    setCapturing,
    t,
  }
  return { preferences, capturing, setPreference, reset, setCapturing, props }
}

function mount() {
  const b = buildProps()
  render(<ShortcutsRow {...b.props} />)
  return b
}

/** Keydown against the document capture listener the row installs while recording. */
function press(init: KeyboardEventInit): void {
  fireEvent.keyDown(document, init)
}

describe('ShortcutsRow', () => {
  it('describes the registered actions and hides reset and the default hint at defaults', () => {
    mount()
    expect(screen.getByText('暂停当前任务')).toBeDefined()
    expect(screen.getByText('插队发送')).toBeDefined()
    expect(screen.getByText('新建会话')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Esc' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Ctrl/Cmd+S' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Ctrl/Cmd+O' })).toBeDefined()
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
    act(() => {
      b.preferences.set({ ...b.preferences.getSnapshot(), pause: { kind: 'key', modifiers: ['alt'], key: 'p' } })
    })
    // Only the modified action offers a reset.
    const resetButton = screen.getByRole('button', { name: '恢复默认' })
    fireEvent.click(resetButton)
    expect(b.reset).toHaveBeenCalledWith('pause')
    // Back at the default, the reset control leaves the row again.
    expect(screen.queryByRole('button', { name: '恢复默认' })).toBeNull()
    // The stores are authoritative: an external preference change re-renders.
    act(() => { b.preferences.set({ ...b.preferences.getSnapshot(), steerSend: { kind: 'none' } }) })
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

describe('ShortcutsCard', () => {
  it('collapses the rebinding fields by default and discloses them on header click', () => {
    // mount() builds the same injected props the card passes through.
    const { props } = buildProps()
    const card = render(<ShortcutsCard {...props} />)
    // Collapsed: the header names the card; the fields stay hidden.
    expect(card.getByRole('button', { name: /展开快捷键设置: 快捷键/ })).toBeDefined()
    expect(card.queryByRole('button', { name: 'Esc' })).toBeNull()
    // Header click discloses the fields in place.
    fireEvent.click(card.getByRole('button', { name: /展开快捷键设置: 快捷键/ }))
    expect(card.getByRole('button', { name: /收起快捷键设置: 快捷键/ })).toBeDefined()
    expect(card.getByRole('button', { name: 'Esc' })).toBeDefined()
    // And the key-capture interaction still works inside the open card.
    fireEvent.click(card.getByRole('button', { name: 'Esc' }))
    expect(card.getByRole('button', { name: /按下新键位/ })).toBeDefined()
  })
})
