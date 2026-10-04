// @vitest-environment jsdom
/**
 * The chapter reader: chapter switching (numbers + prev/next by seq), the
 * plan card with the ✓确认计划 state machine, the phase lamp with the
 * ✓审过本章 gate, the outline-draft view for a planning chapter, and the
 * manuscript body through the content pane.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReaderTab } from '../src/client/ReaderTab.tsx'
import { DREAM, makeStoryBench } from './bench.tsx'

afterEach(() => { cleanup() })

describe('ReaderTab', () => {
  it('defaults to the planning chapter with its plan card, unconfirmed', async () => {
    const { props } = makeStoryBench()
    render(<ReaderTab {...props} />)
    await screen.findByText('第6章 · 本章计划')
    expect(screen.getByText('POV').parentElement?.textContent).toContain('赵启明')
    expect(screen.getByText('推进 #12')).toBeTruthy()
    expect(screen.getByText('门后传来妹妹的声音')).toBeTruthy()
    expect(screen.getByRole('button', { name: '✓ 确认计划' })).toBeTruthy()
    // A planning chapter reads as the outline-draft view, not an empty body.
    expect(screen.getByText('第6–8章：门后空间三层递进。')).toBeTruthy()
    expect(screen.getByText(/正文尚未生成/)).toBeTruthy()
  })

  it('confirms the plan and echoes the confirmed state', async () => {
    const { props, mocks } = makeStoryBench()
    render(<ReaderTab {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: '✓ 确认计划' }))
    await waitFor(() => {
      expect(mocks.confirmChapterPlan).toHaveBeenCalledWith('s1', { workId: DREAM, n: 6 })
    })
    await screen.findByText('已确认计划，可以开写')
    await screen.findByText(/✓ 已确认/)
  })

  it('switches chapters by the number grid and by prev/next', async () => {
    const { props, store } = makeStoryBench()
    render(<ReaderTab {...props} />)
    await screen.findByText('第6章 · 本章计划')
    fireEvent.click(screen.getByRole('button', { name: '1' }))
    await screen.findByText(/赵启明入职梦境监护所。/)
    expect(store.source.getSnapshot().readerN).toBe(1)
    expect(screen.getByRole('button', { name: '‹ 上一章' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: '下一章 ›' }))
    await screen.findByText(/赵启明按半页守则找到门缝。/)
    expect(store.source.getSnapshot().readerN).toBe(5)
    // The reviewed chapter renders its manuscript through the pane.
    await screen.findByText(/门缝里飘出一片蓝色的叶子/)
    expect(screen.getAllByText(/第5章\.md/).length).toBeGreaterThan(0)
  })

  it('the phase lamp gates ✓审过本章 until the user fires reviewChapter', async () => {
    const { props, mocks } = makeStoryBench()
    render(<ReaderTab {...props} />)
    await screen.findByText('第6章 · 本章计划')
    // A planning chapter offers the gate; a reviewed one echoes 已审过.
    fireEvent.click(screen.getByRole('button', { name: '5' }))
    await screen.findByText('✓ 已审过')
    expect(screen.queryByRole('button', { name: '✓ 审过本章' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '6' }))
    fireEvent.click(await screen.findByRole('button', { name: '✓ 审过本章' }))
    await waitFor(() => {
      expect(mocks.reviewChapter).toHaveBeenCalledWith('s1', { workId: DREAM, n: 6 })
    })
    await screen.findByText('已审过本章——可以对账了')
  })

  it('renders the no-focus and the no-chapters empty states', async () => {
    const noFocus = makeStoryBench({ focusId: null })
    const { unmount } = render(<ReaderTab {...noFocus.props} />)
    expect(await screen.findByText('本会话还没有 focus 作品：选一部，或新建一部')).toBeTruthy()
    unmount()
    const empty = makeStoryBench()
    empty.fixtures.get(DREAM)!.chapters.splice(0)
    render(<ReaderTab {...empty.props} />)
    expect(await screen.findByText('还没有章节——在会话里规划第 1 章')).toBeTruthy()
  })
})
