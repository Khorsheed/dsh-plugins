// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ChapterReader as ChapterBook } from '../src/client/ChapterReader.tsx'
import type { NovelRemote, NovelSurfaceProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
import { NOVEL_GENRE_ID, type ChapterFeedbackBatch, type ChapterFeedbackIdea } from '../src/index.ts'

const SESSION = 's-feedback' as SessionId
const t = ((key: keyof typeof zh, params?: Record<string, string | number>) => zh[key].replace(/\{(\w+)\}/g, (match, name) => String(params?.[name] ?? match))) as NovelSurfaceProps['t']
const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })
const idea: ChapterFeedbackIdea = { id: 'f1', chapter: 1, quote: '他推开门。', start: 0, end: 5, baseBodyHash: '', text: '补一拍犹豫。', createdAt: 'now' }

afterEach(cleanup)

function fixture(feedback: { ideas?: ChapterFeedbackIdea[]; batches?: ChapterFeedbackBatch[] } = {}) {
  const chapter = { n: 1, seq: 1, title: '门与假门', file: '第1章.md', phase: 'extracted' as const, sessionIds: [], createdAt: 'now', updatedAt: 'now' }
  const remote = {
    chapters: vi.fn(() => ok({ ok: true, chapters: [{ chapter, phase: 'extracted' }], pending: {} })),
    chapter: vi.fn(({ n }: { n: number }) => ok(n === 1
      ? { ok: true, chapter, phase: 'extracted' as const, body: '# 门\n他推开门。', pending: 0, names: {} }
      : { ok: false, error: 'missing' as const, pending: 0, names: {} })),
    pending: vi.fn(() => ok({ ok: true, items: [] })),
    chapterFeedback: vi.fn(() => ok({ ok: true, ideas: feedback.ideas ?? [], batches: feedback.batches ?? [] })),
    addChapterFeedback: vi.fn(() => ok({ ok: true })),
    deleteChapterFeedback: vi.fn(() => ok({ ok: true })),
    restoreChapterFeedback: vi.fn(() => ok({ ok: true })),
    prepareChapterFeedback: vi.fn(() => ok({ ok: true, batchId: 'fb1', text: '原文：“他推开门。”\n想法：补一拍犹豫。' })),
    recallChapterFeedback: vi.fn(() => ok({ ok: true })),
    submitChapterFeedbackCandidate: vi.fn(() => ok({ ok: true })),
  } as unknown as NovelRemote & Record<string, ReturnType<typeof vi.fn>>
  const navigate = { openCard: vi.fn(), openPage: vi.fn(), openManuscripts: vi.fn(), refresh: vi.fn() }
  const props = {
    canvasId: 'canvas_novel', board: { id: 'canvas_novel', title: '潜梦者', genre: { id: NOVEL_GENRE_ID } },
    rev: 0, navigate, sessionId: SESSION, remote: () => remote, t,
    n: 1, onGo: vi.fn(), onToc: vi.fn(), editing: false, onEditingChange: vi.fn(),
  }
  return { remote, props }
}

async function openFeedback(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: zh['feedback.show'] }))
  await screen.findByRole('region', { name: zh['feedback.title'] })
}

function selectParagraph(paragraph: HTMLElement): void {
  const range = document.createRange()
  range.selectNodeContents(paragraph)
  Object.defineProperty(range, 'getBoundingClientRect', { value: () => new DOMRect() })
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}

describe('chapter feedback surface', () => {
  it('keeps the idea panel hidden until requested and never opens a private selection popup', async () => {
    const { props } = fixture()
    render(<ChapterBook {...props} />)
    const toggle = await screen.findByRole('button', { name: zh['feedback.show'] })
    expect(screen.queryByRole('region', { name: zh['feedback.title'] })).toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    const paragraph = await screen.findByText('他推开门。')
    selectParagraph(paragraph)
    fireEvent.mouseUp(paragraph)
    await act(async () => { await new Promise(resolve => { setTimeout(resolve, 0) }) })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(toggle)
    const panel = await screen.findByRole('region', { name: zh['feedback.title'] })
    expect(panel.parentElement).toBe(toggle.parentElement)
    expect(document.querySelector('[data-novel-prose]')?.contains(panel)).toBe(false)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: zh['feedback.close'] }))
    expect(screen.queryByRole('region', { name: zh['feedback.title'] })).toBeNull()
    fireEvent.click(toggle)
    const reopened = await screen.findByRole('region', { name: zh['feedback.title'] })
    fireEvent.pointerDown(reopened)
    expect(screen.getByRole('region', { name: zh['feedback.title'] })).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('region', { name: zh['feedback.title'] })).toBeNull()
    fireEvent.click(toggle)
    await screen.findByRole('region', { name: zh['feedback.title'] })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: zh['feedback.title'] })).toBeNull()
  })

  it('does not register selection comments for a read-only canvas', async () => {
    const registerChapterComment = vi.fn()
    const { props } = fixture()
    render(<ChapterBook {...props} sessionId={undefined} registerChapterComment={registerChapterComment} />)
    expect(await screen.findByText('他推开门。')).toBeTruthy()
    expect(registerChapterComment).not.toHaveBeenCalled()
  })

  it('opens a selection comment only through the quote action and uses its session', async () => {
    const hostSession = 's-from-quote' as SessionId
    let openComment: ((sessionId: SessionId) => void) | undefined
    const registerChapterComment = vi.fn((_canvasId: string, _n: number, open: (sessionId: SessionId) => void) => {
      openComment = open
      return () => {}
    })
    const { remote, props } = fixture()
    render(<ChapterBook {...props} registerChapterComment={registerChapterComment} />)
    const paragraph = await screen.findByText('他推开门。')
    await waitFor(() => { expect(openComment).toBeDefined() })
    selectParagraph(paragraph)
    act(() => { openComment!(hostSession) })
    expect(await screen.findByRole('dialog', { name: zh['feedback.record'] })).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText(zh['feedback.commentPlaceholder']), { target: { value: '动作再慢一点。' } })
    fireEvent.click(screen.getByRole('button', { name: zh['feedback.save'] }))
    await waitFor(() => {
      expect(remote.addChapterFeedback).toHaveBeenCalledWith(hostSession, expect.objectContaining({ quote: '他推开门。', text: '动作再慢一点。' }))
    })
  })

  it('fills a later batch while an earlier one is still open', async () => {
    const previous: ChapterFeedbackBatch = {
      id: 'fb-old', sessionId: SESSION, canvasId: 'canvas_novel', chapter: 1, chapterTitle: '门与假门',
      ideas: [{ ...idea, id: 'previous' }], baseBodyHash: '', status: 'drafted', createdAt: 'now',
    }
    const { remote, props } = fixture({ ideas: [idea], batches: [previous] })
    const fillConversation = vi.fn(() => ({ before: '', after: '下一批完整请求' }))
    const watchChapterFeedback = vi.fn(() => vi.fn())
    render(<ChapterBook {...props} fillConversation={fillConversation} watchChapterFeedback={watchChapterFeedback} />)
    await openFeedback()
    const fill = screen.getByRole('button', { name: '把 1 条想法填入对话' }) as HTMLButtonElement
    expect(fill.disabled).toBe(false)
    fireEvent.click(fill)
    await waitFor(() => {
      expect(remote.prepareChapterFeedback).toHaveBeenCalledWith(SESSION, { canvasId: 'canvas_novel', n: 1 })
      expect(fillConversation).toHaveBeenCalledWith(SESSION, '原文：“他推开门。”\n想法：补一拍犹豫。')
      expect(watchChapterFeedback).toHaveBeenCalledWith(SESSION, 'canvas_novel', 'fb1')
    })
    expect(remote.recallChapterFeedback).not.toHaveBeenCalled()
  })

  it('fills the host composer and watches the final draft without submitting', async () => {
    const { remote, props } = fixture({ ideas: [idea] })
    const fillConversation = vi.fn(() => ({ before: '已有内容', after: '已有内容\n\n完整请求' }))
    const watchChapterFeedback = vi.fn(() => vi.fn())
    render(<ChapterBook {...props} fillConversation={fillConversation} watchChapterFeedback={watchChapterFeedback} />)
    const toggle = await screen.findByRole('button', { name: zh['feedback.show'] })
    await waitFor(() => { expect(toggle.textContent).toContain('1') })
    fireEvent.click(toggle)
    fireEvent.click(await screen.findByRole('button', { name: '把 1 条想法填入对话' }))
    await waitFor(() => {
      expect(fillConversation).toHaveBeenCalledWith(SESSION, '原文：“他推开门。”\n想法：补一拍犹豫。')
      expect(watchChapterFeedback).toHaveBeenCalledWith(SESSION, 'canvas_novel', 'fb1')
    })
    expect(remote.recallChapterFeedback).not.toHaveBeenCalled()
    expect(remote.submitChapterFeedbackCandidate).not.toHaveBeenCalled()
  })

  it('rolls the batch back when this session has no composer', async () => {
    const { remote, props } = fixture({ ideas: [idea] })
    render(<ChapterBook {...props} fillConversation={() => false} />)
    await openFeedback()
    fireEvent.click(screen.getByRole('button', { name: '把 1 条想法填入对话' }))
    await waitFor(() => { expect(remote.recallChapterFeedback).toHaveBeenCalledWith(SESSION, { canvasId: 'canvas_novel', n: 1, batchId: 'fb1' }) })
    expect(await screen.findByText(zh['feedback.noConversation'])).toBeTruthy()
  })

  it('keeps the archived original and actual submitted request available', async () => {
    const batch: ChapterFeedbackBatch = {
      id: 'fb1', sessionId: SESSION, canvasId: 'canvas_novel', chapter: 1, chapterTitle: '门与假门', ideas: [idea], baseBodyHash: '',
      status: 'archived', createdAt: 'now', submittedText: '用户编辑后的完整请求', completedAt: '2026-11-03T01:00:00.000Z',
    }
    const { props } = fixture({ batches: [batch] })
    render(<ChapterBook {...props} />)
    expect((await screen.findAllByText(/他推开门。/)).length).toBeGreaterThan(0)
    expect(screen.queryByText('用户编辑后的完整请求')).toBeNull()
    await openFeedback()
    expect(screen.getByText('用户编辑后的完整请求')).toBeTruthy()
  })
})
