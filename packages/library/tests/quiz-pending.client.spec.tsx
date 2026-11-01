// @vitest-environment jsdom
/**
 * The paper's 交卷 hold-back: 交卷 stays clickable; pressed early it jumps to
 * the first unsubmitted question, marks every one on the paper and lists a
 * capped few by number (written-but-unsubmitted ones named); an open answer goes back to editing until the sitting is handed
 * to the coach, a judged one never does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { zh } from '../src/client/locales.ts'
import { QuizView } from '../src/client/views/quiz.tsx'
import type { ViewProps } from '../src/client/ui.tsx'
import type { LibraryQuizQuestion } from '../src/types.ts'

const t = ((key: keyof typeof zh, params?: Record<string, string>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)) as TranslateNS<'library'>

const ok = <T,>(inner: T) => Promise.resolve({ ok: true, value: { ok: true, ...inner } })

const question = (id: string, kind: LibraryQuizQuestion['kind'], extra: Partial<LibraryQuizQuestion> = {}): LibraryQuizQuestion => ({
  id, kind, prompt: `${id} 的题干`, answer: '乙选项', target: { kind: 'topic' }, evidence: { kind: 'knowledge' }, ...extra,
})

const QUESTIONS = [
  question('q1', 'choice', { options: ['甲选项', '乙选项'] }),
  question('q2', 'free'),
  question('q3', 'free'),
]

function mount(questions: readonly LibraryQuizQuestion[] = QUESTIONS): { primeConversation: ReturnType<typeof vi.fn> } {
  const primeConversation = vi.fn(() => true)
  const p = {
    t,
    actions: { pop: vi.fn(), replace: vi.fn() },
    getAssessment: () => ok({ assessment: { id: 'quiz-1', type: 'quiz', questions } }),
    getProject: () => ok({ project: { template: undefined } }),
    bindTarget: vi.fn(),
    primeConversation,
  } as unknown as ViewProps['p']
  render(<QuizView p={p} projectId="p1" resourceId={undefined} quizId="quiz-1" />)
  return { primeConversation }
}

beforeEach(() => {
  localStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => { cleanup() })

describe('QuizView 交卷 with questions still unsubmitted', () => {
  it('stays quiet until 交卷 is pressed, then jumps to the first, lists the numbers and marks the cards', async () => {
    const { primeConversation } = mount()
    await screen.findByText('q1 的题干')
    fireEvent.click(screen.getByText('乙选项'))
    const [box2] = screen.getAllByRole('textbox')
    fireEvent.change(box2!, { target: { value: '写好了还没交' } })
    expect(screen.queryByText('还有 2 题没提交：')).toBeNull()
    expect(document.querySelectorAll('[data-pending="true"]')).toHaveLength(0)
    const finish = screen.getByText('交卷') as HTMLButtonElement
    expect(finish.disabled).toBe(false)
    fireEvent.click(finish)
    expect(primeConversation).not.toHaveBeenCalled()
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(box2)
    expect(screen.getByText('还有 2 题没提交：')).toBeTruthy()
    expect(screen.getByText('其中 2 写了，没点「提交」')).toBeTruthy()
    expect(document.querySelectorAll('[data-pending="true"]')).toHaveLength(2)
    fireEvent.click(screen.getByTitle('跳到第 3 题'))
    expect(document.activeElement).toBe(screen.getAllByRole('textbox')[1])
  })

  it('caps the listed numbers on a long paper', async () => {
    mount(Array.from({ length: 10 }, (_, at) => question(`f${at + 1}`, 'free')))
    await screen.findByText('f1 的题干')
    fireEvent.click(screen.getByText('交卷'))
    expect(screen.getByText('还有 10 题没提交：')).toBeTruthy()
    expect(screen.getAllByTitle(/^跳到第 \d+ 题$/)).toHaveLength(6)
    expect(screen.getByText('…')).toBeTruthy()
  })

  it('the hint and marks clear once everything is submitted', async () => {
    mount()
    await screen.findByText('q1 的题干')
    fireEvent.click(screen.getByText('交卷'))
    fireEvent.click(screen.getByText('乙选项'))
    const [box2, box3] = screen.getAllByRole('textbox')
    fireEvent.change(box2!, { target: { value: '甲' } })
    fireEvent.change(box3!, { target: { value: '乙' } })
    for (const button of screen.getAllByText('提交')) fireEvent.click(button)
    expect(screen.queryByRole('status')).toBeNull()
    expect(document.querySelectorAll('[data-pending="true"]')).toHaveLength(0)
  })
})

describe('QuizView 改答案', () => {
  it('an open answer goes back to editing with its text; a judged choice offers no edit', async () => {
    mount()
    await screen.findByText('q1 的题干')
    fireEvent.click(screen.getByText('乙选项'))
    const [box2] = screen.getAllByRole('textbox')
    fireEvent.change(box2!, { target: { value: '第一版' } })
    fireEvent.click(screen.getAllByText('提交')[0]!)
    // Only q2 (open, submitted) carries the edit — not the judged choice.
    expect(screen.getAllByText('改答案')).toHaveLength(1)
    fireEvent.click(screen.getByText('改答案'))
    const reopened = screen.getAllByRole('textbox')[0] as HTMLTextAreaElement
    expect(reopened.disabled).toBe(false)
    expect(reopened.value).toBe('第一版')
    expect(screen.getByText('章节考 1/3')).toBeTruthy()
  })

  it('once handed to the coach, no answer goes back to editing', async () => {
    const { primeConversation } = mount()
    await screen.findByText('q1 的题干')
    fireEvent.click(screen.getByText('乙选项'))
    const [box2, box3] = screen.getAllByRole('textbox')
    fireEvent.change(box2!, { target: { value: '甲' } })
    fireEvent.change(box3!, { target: { value: '乙' } })
    for (const button of screen.getAllByText('提交')) fireEvent.click(button)
    expect(screen.getAllByText('改答案')).toHaveLength(2)
    fireEvent.click(screen.getByText('交卷'))
    expect(primeConversation).toHaveBeenCalledOnce()
    expect(screen.queryByText('改答案')).toBeNull()
  })
})
