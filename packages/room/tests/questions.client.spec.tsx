// @vitest-environment jsdom
/** The member question card: options are picked, 其他 is typed, submit sends one answer per question; the answers fold in place. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { roomQuestionDefinition, type RoomQuestionData } from '../src/client/nodes.ts'
import { RoomQuestionView } from '../src/client/RoomQuestionView.tsx'
import { zh } from '../src/client/locales.ts'
import type { RoomQuestionViewProps } from '../src/client/slots.ts'

afterEach(() => { cleanup() })

const t = makeTranslate(zh) as unknown as RoomQuestionViewProps['t']
const ev = (seq: number, type: string, data: unknown) => ({ seq, time: 1000 + seq, type, data }) as never
const questions = [
  { id: 'fun', question: '核心乐趣是哪一种？', options: [{ label: '读懂习性', description: '解谜感' }, { label: '潜行张力' }] },
  { id: 'cut', question: '先做哪些兽？', multiSelect: true, options: [{ label: '九尾狐' }, { label: '毕方' }, { label: '嬴鱼' }] },
]

describe('room-question', () => {
  it('starts pending and folds the answers in place', () => {
    const asked = ev(5, 'room/question', { id: 'q1', member: '游戏大师', memberId: 'm', questions })
    expect(roomQuestionDefinition.match(asked)).toEqual({ id: 'q1', role: 'start' })
    const started = roomQuestionDefinition.start({} as never, { event: asked, role: 'start' } as never, undefined as never)
    expect(started).toMatchObject({ questionId: 'q1', member: '游戏大师', state: 'pending' })
    const answers = [{ id: 'fun', selected: ['潜行张力'] }]
    const done = roomQuestionDefinition.update({ state: started } as never, { event: ev(6, 'room/question-resolved', { id: 'q1', outcome: 'answered', answers }), role: 'update' } as never)
    expect(done).toMatchObject({ state: 'answered', answers })
  })

  it('picks, types and submits; the answered card shows the answers', async () => {
    const answerQuestion = vi.fn(async () => undefined)
    const data: RoomQuestionData = { seq: 5, time: 1005, questionId: 'q1', member: '游戏大师', questions, state: 'pending' }
    const view = (next: RoomQuestionData) => <RoomQuestionView {...{ node: { data: next }, answerQuestion, t } as unknown as RoomQuestionViewProps} />
    const { rerender } = render(view(data))
    expect(screen.getByText('游戏大师 问你')).toBeDefined()
    const submit = screen.getByRole('button', { name: '提交回答' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: /读懂习性/ }))
    expect(submit.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: /九尾狐/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /毕方/ }))
    fireEvent.change(screen.getAllByRole('textbox', { name: '其他' })[1]!, { target: { value: ' 再加烛龙 ' } })
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    await vi.waitFor(() => expect(answerQuestion).toHaveBeenCalledWith('q1', [
      { id: 'fun', selected: ['读懂习性'] }, { id: 'cut', selected: ['九尾狐', '毕方'], custom: '再加烛龙' },
    ]))
    rerender(view({ ...data, state: 'answered', answers: [{ id: 'fun', selected: ['读懂习性'] }, { id: 'cut', selected: ['九尾狐', '毕方'], custom: '再加烛龙' }] }))
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('你的回答：九尾狐；毕方；再加烛龙')).toBeDefined()
  })

  it('an expired card stays answerable and folds to 已补答; an expired consent gate does not', () => {
    const answerQuestion = vi.fn(async () => undefined)
    const data: RoomQuestionData = { seq: 5, time: 1005, questionId: 'q1', member: '游戏大师', questions, state: 'cancelled' }
    const view = (next: RoomQuestionData) => <RoomQuestionView {...{ node: { data: next }, answerQuestion, t } as unknown as RoomQuestionViewProps} />
    const { rerender } = render(view(data))
    expect(screen.getByText('已过期，仍可回答')).toBeDefined()
    expect(screen.getByRole('button', { name: '提交回答' })).toBeDefined()
    rerender(view({ ...data, state: 'answered', late: true, answers: [{ id: 'fun', selected: ['读懂习性'] }] }))
    expect(screen.getByText('已补答')).toBeDefined()
    rerender(view({ ...data, consent: true }))
    expect(screen.getByText('已过期，未作答')).toBeDefined()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
