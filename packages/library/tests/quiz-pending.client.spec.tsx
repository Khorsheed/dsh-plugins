// @vitest-environment jsdom
/**
 * The paper's 交卷 hold-back: the unsubmitted questions are listed by number
 * under the button (a written-but-unsubmitted one says so) and each jumps to
 * its card; an open answer goes back to editing until the sitting is handed
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

function mount(): { primeConversation: ReturnType<typeof vi.fn> } {
  const primeConversation = vi.fn(() => true)
  const p = {
    t,
    actions: { pop: vi.fn(), replace: vi.fn() },
    getAssessment: () => ok({ assessment: { id: 'quiz-1', type: 'quiz', questions: QUESTIONS } }),
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

describe('QuizView pending list', () => {
  it('lists the unsubmitted questions and says which one is written but not submitted', async () => {
    mount()
    await screen.findByText('q1 的题干')
    expect(screen.getByText('还差 3 题')).toBeTruthy()
    fireEvent.click(screen.getByText('乙选项'))
    const [box2] = screen.getAllByRole('textbox')
    fireEvent.change(box2!, { target: { value: '写好了还没交' } })
    expect(screen.getByText('还没提交：')).toBeTruthy()
    expect(screen.getByText('第 2 题（写了，没点提交）')).toBeTruthy()
    const jump = screen.getByText('第 3 题')
    fireEvent.click(jump)
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(screen.getAllByRole('textbox')[1])
  })

  it('the list goes away once everything is submitted', async () => {
    mount()
    await screen.findByText('q1 的题干')
    fireEvent.click(screen.getByText('乙选项'))
    const [box2, box3] = screen.getAllByRole('textbox')
    fireEvent.change(box2!, { target: { value: '甲' } })
    fireEvent.change(box3!, { target: { value: '乙' } })
    for (const button of screen.getAllByText('提交')) fireEvent.click(button)
    expect(screen.queryByText('还没提交：')).toBeNull()
    expect(screen.getByText('交卷')).toBeTruthy()
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
    expect(screen.getByText('还差 2 题')).toBeTruthy()
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
