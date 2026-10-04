// @vitest-environment jsdom
/**
 * The fragments tab: the five views rendering from ONE fixture (同源), the
 * ghost-card acceptance flow, the pending queue's ✓/✗, and the no-focus
 * empty state.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { FragmentsTab } from '../src/client/FragmentsTab.tsx'
import { DREAM, makeStoryBench, REPAIR } from './bench.tsx'

afterEach(() => { cleanup() })

/** Switch to one fragments view by its chip label. */
function switchView(label: string): void {
  fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${label}`) }))
}

describe('FragmentsTab — the shell', () => {
  it('renders the no-focus empty state and nothing else', async () => {
    const { props } = makeStoryBench({ focusId: null })
    render(<FragmentsTab {...props} />)
    expect(await screen.findByText('本会话还没有 focus 作品：选一部，或新建一部')).toBeTruthy()
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('echoes the focus and the live counts on the work strip', async () => {
    const { props } = makeStoryBench()
    render(<FragmentsTab {...props} />)
    await screen.findByText(/3 章 · 待确认 3/)
    expect((screen.getByRole('combobox', { name: '切换作品（即本会话 focus）' }) as HTMLSelectElement).value).toBe(DREAM)
  })

  it('switches the work (focusWork) and re-reads the views', async () => {
    const { props, mocks } = makeStoryBench()
    render(<FragmentsTab {...props} />)
    await screen.findByText(/3 章 · 待确认 3/)
    fireEvent.change(screen.getByRole('combobox', { name: '切换作品（即本会话 focus）' }), { target: { value: REPAIR } })
    await waitFor(() => { expect(mocks.focusWork).toHaveBeenCalledWith('s1', { workId: REPAIR }) })
    // The empty repair shop reads as the wall's empty state, not stale dream data.
    await screen.findByText(/墙还是空的/)
  })
})

describe('FragmentsTab — the five views, one source', () => {
  it('灵感墙 files ghost cards into three topic columns with destinations', async () => {
    const { props } = makeStoryBench()
    render(<FragmentsTab {...props} />)
    await screen.findByText('梦境有层数，越深越接近梦主的伤口。')
    // The adopted outline (近期采纳) shows its 归档 → gesture; ghosts show ✓/✗.
    expect(screen.getAllByText('近期采纳').length).toBeGreaterThan(0)
    expect(screen.getAllByText('归档 →').length).toBeGreaterThan(0)
    expect(screen.getAllByText('提议中').length).toBe(2)
    expect(screen.getByText('采纳后 → 设定集 · 世界观')).toBeTruthy()
    expect(screen.getByText('采纳后 → 设定集 · 人物卡')).toBeTruthy()
    expect(screen.getByText('第6–8章：门后空间三层递进。')).toBeTruthy()
  })

  it('a ghost card ✓采纳 fires decideMemory(accept); ✗ fires discard', async () => {
    const { props, mocks } = makeStoryBench()
    render(<FragmentsTab {...props} />)
    const card = (await screen.findByText('梦境有层数，越深越接近梦主的伤口。')).closest('div')!
    fireEvent.click(within(card.parentElement!).getByText('✓ 采纳'))
    await waitFor(() => {
      expect(mocks.decideMemory).toHaveBeenCalledWith('s1', { workId: DREAM, id: 'm6', action: 'accept' })
    })
    await screen.findByText('已采纳（进 brief）')
  })

  it('设定集 shows the character board (image placeholder + 角色记忆 →) and edits a canon row', async () => {
    const { props, mocks } = makeStoryBench()
    render(<FragmentsTab {...props} />)
    await screen.findByText(/3 章 · 待确认 3/)
    switchView('设定集')
    await screen.findByText('赵启明')
    expect(screen.getAllByText('＋ 形象图（预留）').length).toBe(2)
    // 角色记忆 → jumps the view and the pane's character.
    fireEvent.click(screen.getAllByText('角色记忆 →')[0]!)
    await screen.findByText(/◉ 当前态/)
    // The world board edits a canon memory through patchMemory (derives_from).
    switchView('设定集')
    await screen.findByRole('tab', { name: /^世界观/ })
    fireEvent.click(screen.getByRole('tab', { name: /^世界观/ }))
    await screen.findByText('监护者不能在梦里说出自己的真名。')
    fireEvent.click(screen.getByLabelText('✎'))
    fireEvent.change(screen.getByDisplayValue('监护者不能在梦里说出自己的真名。'), { target: { value: '真名是锚，说出即被梦主锁定。' } })
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() => {
      expect(mocks.patchMemory).toHaveBeenCalledWith('s1', { workId: DREAM, id: 'm1', content: '真名是锚，说出即被梦主锁定。' })
    })
  })

  it('角色记忆 renders the five blocks and the cursor filters experiences', async () => {
    const { props, store } = makeStoryBench()
    render(<FragmentsTab {...props} />)
    await screen.findByText(/3 章 · 待确认 3/)
    switchView('角色记忆')
    await screen.findByText(/◉ 当前态/)
    expect(screen.getByText('🧭 内核（极慢变）')).toBeTruthy()
    expect(screen.getByText('🗝 知道的事 · 不知道的事')).toBeTruthy()
    expect(screen.getByText('🔗 关系')).toBeTruthy()
    expect(screen.getByText('📁 档案')).toBeTruthy()
    // Two experiences for c1 (chapters 4 and 5); the cursor at 4 hides the fifth.
    expect(screen.getByText('决定推开档案室的门缝')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '4' }))
    await waitFor(() => { expect(screen.queryByText('决定推开档案室的门缝')).toBeNull() })
    expect(store.source.getSnapshot().cmCursor).toBe(4)
    // The automatic line carries the 自动·撤销 tag.
    fireEvent.click(screen.getByRole('button', { name: '5' }))
    await screen.findByText('决定推开档案室的门缝')
    expect(screen.getByText('自动 · 撤销')).toBeTruthy()
  })

  it('世界记忆 renders the health line, the dot strip, and resolves through the exit form', async () => {
    const { props, mocks } = makeStoryBench()
    render(<FragmentsTab {...props} />)
    await screen.findByText(/3 章 · 待确认 3/)
    switchView('世界记忆')
    await screen.findByText('门缝里的东西')
    expect(screen.getByText(/超期未动/)).toBeTruthy()
    expect(screen.getByText('🌐 世界规则（canon）')).toBeTruthy()
    // 登记揭晓 opens the answer form; submitting fires the resolve exit.
    fireEvent.click(screen.getAllByText('登记揭晓')[0]!)
    fireEvent.change(await screen.findByPlaceholderText(/答案/), { target: { value: '是艾文。' } })
    fireEvent.click(screen.getByText('确定'))
    await waitFor(() => {
      expect(mocks.foreshadowExit).toHaveBeenCalledWith('s1', { workId: DREAM, id: 'm12', action: 'resolve', answer: '是艾文。' })
    })
  })

  it('信息 renders the registry facts with same-source marks', async () => {
    const { props } = makeStoryBench()
    render(<FragmentsTab {...props} />)
    await screen.findByText(/3 章 · 待确认 3/)
    switchView('信息')
    await screen.findByText(/梦境监护者》（work-dream0001）/)
    expect(screen.getAllByText(/= 与视图同源/).length).toBeGreaterThan(0)
    expect(screen.getByText(/pending\.json 为派生缓存/)).toBeTruthy()
  })
})

describe('FragmentsTab — the pending queue', () => {
  it('pins the queue at the bottom with confidence dots, evidence, and the 新角色 mark', async () => {
    const { props } = makeStoryBench()
    render(<FragmentsTab {...props} />)
    await screen.findByText(/⚠ 待你处理/)
    expect(screen.getByText('新角色')).toBeTruthy()
    expect(screen.getByText('●●○')).toBeTruthy()
    expect(screen.getByText('●○○')).toBeTruthy()
    expect(screen.getByText(/门后传来一个女人的声音/)).toBeTruthy()
    expect(screen.getAllByText(/忘了还是改主意/).length).toBeGreaterThan(0)
  })

  it('✓ files and ✗ drops through decidePending, settling the row', async () => {
    const { props, mocks } = makeStoryBench()
    render(<FragmentsTab {...props} />)
    await screen.findByText(/⚠ 待你处理/)
    fireEvent.click(screen.getByText('✓ 建档'))
    await waitFor(() => {
      expect(mocks.decidePending).toHaveBeenCalledWith('s1', { workId: DREAM, id: 'p1', action: 'accept' })
    })
    await screen.findByText('已采纳并落库')
    fireEvent.click(screen.getByText('✗ 丢弃'))
    await waitFor(() => {
      expect(mocks.decidePending).toHaveBeenCalledWith('s1', { workId: DREAM, id: 'p2', action: 'discard' })
    })
  })
})
