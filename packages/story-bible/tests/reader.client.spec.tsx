// @vitest-environment jsdom
/**
 * The reader pane (through the one story tab): chapter switching, the plan
 * card's ✓确认计划 state machine, the phase lamp's NEW order (规划中→写作中→
 * 已抽取→已审过, F1-6) with ✓审过本章 armed only at 已抽取, the outline-draft
 * view for planning chapters, and the 文件丢失 state for a registered chapter
 * whose manuscript is gone (F1-2's migration face).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StoryTab } from '../src/client/StoryTab.tsx'
import { DREAM, makeStoryBench } from './bench.tsx'

afterEach(() => { cleanup() })

/** Open the reader pane. */
async function openReader(): Promise<void> {
  await screen.findByRole('combobox', { name: '切换作品（即本会话 focus）' })
  fireEvent.click(screen.getByRole('tab', { name: '章节阅读' }))
}

describe('the reader pane', () => {
  it('defaults to the planning chapter with its plan card, unconfirmed, on the outline view', async () => {
    const { props } = makeStoryBench()
    render(<StoryTab {...props} />)
    await openReader()
    await screen.findByText('第6章 · 本章计划')
    expect(screen.getByText('POV').parentElement?.textContent).toContain('赵启明')
    expect(screen.getByText('推进 #12')).toBeTruthy()
    expect(screen.getByText('门后传来妹妹的声音')).toBeTruthy()
    expect(screen.getByRole('button', { name: '✓ 确认计划' })).toBeTruthy()
    expect(screen.getByText('第6–8章：门后空间三层递进。')).toBeTruthy()
    expect(screen.getByText(/正文尚未生成/)).toBeTruthy()
  })

  it('confirms the plan and echoes the confirmed state', async () => {
    const { props, mocks } = makeStoryBench()
    render(<StoryTab {...props} />)
    await openReader()
    fireEvent.click(await screen.findByRole('button', { name: '✓ 确认计划' }))
    await waitFor(() => {
      expect(mocks.confirmChapterPlan).toHaveBeenCalledWith('s1', { workId: DREAM, n: 6 })
    })
    await screen.findByText('已确认计划，可以开写')
    await screen.findByText(/✓ 已确认/)
  })

  it('switches chapters by the number grid and by prev/next', async () => {
    const { props, store } = makeStoryBench()
    render(<StoryTab {...props} />)
    await openReader()
    await screen.findByText('第6章 · 本章计划')
    fireEvent.click(screen.getByRole('button', { name: '1' }))
    await screen.findByText(/赵启明入职梦境监护所。/)
    expect(store.source.getSnapshot().readerN).toBe(1)
    expect(screen.getByRole('button', { name: '‹ 上一章' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: '下一章 ›' }))
    await screen.findByText(/赵启明按半页守则找到门缝。/)
    expect(store.source.getSnapshot().readerN).toBe(5)
    await screen.findByText(/门缝里飘出一片蓝色的叶子/)
    expect(screen.getAllByText(/第5章\.md/).length).toBeGreaterThan(0)
  })

  it('the lamp reads 规划中→写作中→已抽取→已审过 and arms ✓审过本章 only at 已抽取 (F1-6)', async () => {
    const { props, mocks } = makeStoryBench()
    render(<StoryTab {...props} />)
    await openReader()
    await screen.findByText('第6章 · 本章计划')
    // The station order, as rendered (textContent across the station spans).
    const lamp = document.querySelector('[class*="phaseLamp"]')!
    expect(lamp.textContent).toMatch(/规划中.*写作中.*已抽取.*已审过/)
    // Chapter 5 sits at 已抽取: the gate is armed.
    fireEvent.click(screen.getByRole('button', { name: '5' }))
    await screen.findByText('✓ 审过本章')
    // Chapter 6 (planning): the gate is disabled with the reason.
    fireEvent.click(screen.getByRole('button', { name: '6' }))
    await screen.findByText('第6章 · 本章计划')
    expect(screen.getByRole('button', { name: '✓ 审过本章' })).toHaveProperty('disabled', true)
    // Back to 5: approve fires reviewChapter and the lamp closes.
    fireEvent.click(screen.getByRole('button', { name: '5' }))
    fireEvent.click(await screen.findByRole('button', { name: '✓ 审过本章' }))
    await waitFor(() => {
      expect(mocks.reviewChapter).toHaveBeenCalledWith('s1', { workId: DREAM, n: 5 })
    })
    await screen.findByText('已审过本章——可以对账了')
  })

  it('a reviewed chapter echoes 已审过 with no live gate', async () => {
    const { props, fixtures } = makeStoryBench()
    const row = fixtures.get(DREAM)!.chapters[1]!
    ;(row.chapter as { phase: string }).phase = 'reviewed'
    ;(row as { phase: string }).phase = 'reviewed'
    render(<StoryTab {...props} />)
    await openReader()
    fireEvent.click(await screen.findByRole('button', { name: '5' }))
    await screen.findByText('✓ 已审过')
    expect(screen.queryByRole('button', { name: '✓ 审过本章' })).toBeNull()
  })

  it('a chapter past planning whose manuscript is gone reads 文件丢失 (F1-2 migration face)', async () => {
    const { props, fixtures } = makeStoryBench()
    const row = fixtures.get(DREAM)!.chapters[1]!
    ;(row as { phase: string }).phase = 'fileMissing'
    render(<StoryTab {...props} />)
    await openReader()
    fireEvent.click(await screen.findByRole('button', { name: '5' }))
    await screen.findAllByText(/文件丢失/)
    expect(screen.getByText(/登记在、文件不在/)).toBeTruthy()
  })

  it('renders the no-focus and the no-chapters empty states', async () => {
    const noFocus = makeStoryBench({ focusId: null })
    const { unmount } = render(<StoryTab {...noFocus.props} />)
    expect(await screen.findByText('本会话还没有 focus 作品：选一部，或新建一部')).toBeTruthy()
    unmount()
    const empty = makeStoryBench()
    empty.fixtures.get(DREAM)!.chapters.splice(0)
    render(<StoryTab {...empty.props} />)
    await openReader()
    expect(await screen.findByText('还没有章节——在会话里规划第 1 章')).toBeTruthy()
  })
})
