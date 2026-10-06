// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  ChipRow, HEADER_VISIBLE_COMPACT, HEADER_VISIBLE_WIDE, ListRow, PanelHeader, PanelRoot, UnderlineTabs,
  panelVar, splitActions, type PanelAction,
} from '../src/client/index.ts'

let resize: (width: number) => void = () => {}
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) {
      resize = width => act(() => callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver))
    }
    observe() {}
    disconnect() {}
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function actions(n: number, more: Partial<Record<number, Partial<PanelAction>>> = {}): PanelAction[] {
  return Array.from({ length: n }, (_, i) => ({ id: `a${i}`, label: `Action ${i}`, icon: <i />, onSelect: vi.fn(), ...more[i] }))
}

describe('tokens', () => {
  it('always spells a token with its desktop fallback', () => {
    expect(panelVar('body')).toBe('var(--dsh-panel-text-body, 13px)')
    expect(panelVar('readingLineHeight')).toBe('var(--dsh-panel-reading-line-height, 1.65)')
  })
})

describe('splitActions', () => {
  it('keeps everything inline when it fits, so a one-row menu never appears', () => {
    expect(splitActions(actions(2), 2).overflow).toEqual([])
  })
  it('keeps the first `limit` inline in order and pins jump the queue', () => {
    const list = actions(5, { 4: { pinned: true } })
    const { inline, overflow } = splitActions(list, 2)
    expect(inline.map(a => a.id)).toEqual(['a0', 'a4'])
    expect(overflow.map(a => a.id)).toEqual(['a1', 'a2', 'a3'])
  })
  it('puts a lone overflowing action in the ⋯ slot instead of opening a one-row menu', () => {
    const { inline, overflow } = splitActions(actions(3), 2)
    expect(inline.map(a => a.id)).toEqual(['a0', 'a1', 'a2'])
    expect(overflow).toEqual([])
  })
  it('still folds a lone extra row when pins already exceed the budget', () => {
    const list = actions(4, { 0: { pinned: true }, 1: { pinned: true }, 2: { pinned: true } })
    const { inline, overflow } = splitActions(list, 2)
    expect(inline.map(a => a.id)).toEqual(['a0', 'a1', 'a2'])
    expect(overflow.map(a => a.id)).toEqual(['a3'])
  })
})

describe('splitActions menu-only rows', () => {
  it('never inlines a menu-only action, even with room to spare', () => {
    const list = actions(2, { 1: { menuOnly: true } })
    const { inline, overflow } = splitActions(list, 4)
    expect(inline.map(a => a.id)).toEqual(['a0'])
    expect(overflow.map(a => a.id)).toEqual(['a1'])
  })
})

describe('PanelHeader', () => {
  it('shows the compact budget inside a narrow PanelRoot and the wide budget once it widens', () => {
    const list = actions(6)
    render(<PanelRoot><PanelHeader title="Writing" meta="~/code" actions={list} moreLabel="More" /></PanelRoot>)
    resize(390)
    expect(screen.getAllByRole('button').filter(b => b.getAttribute('aria-label')?.startsWith('Action'))).toHaveLength(HEADER_VISIBLE_COMPACT)
    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy()
    resize(900)
    expect(screen.getAllByRole('button').filter(b => b.getAttribute('aria-label')?.startsWith('Action'))).toHaveLength(HEADER_VISIBLE_WIDE)
    resize(0)
    expect(screen.getAllByRole('button').filter(b => b.getAttribute('aria-label')?.startsWith('Action'))).toHaveLength(HEADER_VISIBLE_WIDE)
  })

  it('opens the overflow menu, runs the picked action and closes; Escape closes too', () => {
    const list = actions(4)
    render(<PanelHeader title="Canvas" actions={list} moreLabel="More" compact />)
    const more = screen.getByRole('button', { name: 'More' })
    fireEvent.click(more)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Action 3' }))
    expect(list[3]!.onSelect).toHaveBeenCalledOnce()
    expect(more.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(more)
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('renders back only when asked', () => {
    const back = vi.fn()
    const { rerender } = render(<PanelHeader title="a.md" moreLabel="More" />)
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
    rerender(<PanelHeader title="a.md" moreLabel="More" onBack={back} backLabel="Back" />)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(back).toHaveBeenCalledOnce()
  })
  it('places an extra control before the icons without spending the budget', () => {
    const actions = ['one', 'two'].map(id => ({ id, label: id, icon: id, onSelect: () => {} }))
    render(<PanelHeader title="a.md" moreLabel="More" compact extra={<button type="button">Globe</button>} actions={actions} />)
    const names = screen.getAllByRole('button').map(button => button.getAttribute('aria-label') ?? button.textContent)
    expect(names).toEqual(['Globe', 'one', 'two'])
  })
})

describe('PanelHeader toggles and PanelRoot render prop', () => {
  it('marks a pressed toggle and hands the compact state to a render-prop child', () => {
    render(<PanelRoot>{compact => <><span>{compact ? 'compact' : 'wide'}</span>
      <PanelHeader title="Files" moreLabel="More" actions={actions(1, { 0: { pressed: true } })} /></>}</PanelRoot>)
    resize(390)
    expect(screen.getByText('compact')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Action 0' }).getAttribute('aria-pressed')).toBe('true')
    resize(800)
    expect(screen.getByText('wide')).toBeTruthy()
  })
})

describe('UnderlineTabs', () => {
  function Fixture() {
    const [value, setValue] = useState<'board' | 'links' | 'draft'>('board')
    return <UnderlineTabs label="View" value={value} onChange={setValue}
      tabs={[{ id: 'board', label: 'Board' }, { id: 'links', label: 'Links', disabled: true }, { id: 'draft', label: 'Draft' }]} />
  }
  it('walks with arrows past disabled tabs, wraps, and honours Home/End', () => {
    render(<Fixture />)
    const tab = (name: string) => screen.getByRole('tab', { name })
    expect(tab('Board').getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tab('Board'), { key: 'ArrowRight' })
    expect(tab('Draft').getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tab('Draft'))
    fireEvent.keyDown(tab('Draft'), { key: 'ArrowRight' })
    expect(tab('Board').getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tab('Board'), { key: 'ArrowLeft' })
    expect(tab('Draft').getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tab('Draft'), { key: 'Home' })
    expect(tab('Board').getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tab('Board'), { key: 'End' })
    expect(tab('Draft').getAttribute('aria-selected')).toBe('true')
    expect(tab('Draft').tabIndex).toBe(0)
    expect(tab('Board').tabIndex).toBe(-1)
  })
})

describe('ChipRow', () => {
  it('reports the pressed chip and reflects single or multiple selection', () => {
    const onSelect = vi.fn()
    const chips = [{ id: 'all', label: 'All', count: 2 }, { id: 'idea', label: 'Idea', count: 1, color: 'red' }]
    const { rerender } = render(<ChipRow label="Filter" chips={chips} value="all" onSelect={onSelect} />)
    expect(screen.getByRole('button', { name: /All/ }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /Idea/ }))
    expect(onSelect).toHaveBeenCalledWith('idea')
    rerender(<ChipRow label="Filter" chips={chips} value={['all', 'idea']} onSelect={onSelect} />)
    expect(screen.getAllByRole('button').every(b => b.getAttribute('aria-pressed') === 'true')).toBe(true)
  })
})

describe('ListRow', () => {
  it('is a button only when actionable and marks the current row', () => {
    const onSelect = vi.fn()
    const { rerender } = render(<ListRow title="notes.md" trailing="9/02" />)
    expect(screen.queryByRole('button')).toBeNull()
    rerender(<ListRow title="notes.md" trailing="9/02" selected onSelect={onSelect} />)
    const row = screen.getByRole('button', { name: /notes\.md/ })
    expect(row.getAttribute('aria-current')).toBe('true')
    fireEvent.click(row)
    expect(onSelect).toHaveBeenCalledOnce()
  })
})
