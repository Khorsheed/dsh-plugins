// @vitest-environment jsdom
/** The member compaction row: numbers when the member reported them, an explicit "does not report" otherwise. */
import { afterEach, describe, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RoomCompactionView } from '../src/client/RoomCompactionView.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { RoomCompactionViewProps } from '../src/client/slots.ts'

afterEach(() => { cleanup() })

function row(data: Record<string, unknown>, locale: Record<string, string> = zh): void {
  const props = { node: { data: { seq: 1, time: 1, member: 'ada', ...data } }, t: makeTranslate(locale) } as unknown as RoomCompactionViewProps
  render(<RoomCompactionView {...props} />)
}

describe('RoomCompactionView', () => {
  it('a reported compaction reads as compacted, with its numbers', () => {
    row({ outcome: 'completed', beforeTokens: 560_000, afterTokens: 41_000 })
    expect(screen.getByText(/ada 已压缩上下文/).textContent).toContain('→')
  })

  it('a member that reports no compaction data says so instead of "compacted"', () => {
    row({ outcome: 'completed', unreported: true })
    const text = screen.getByText(/ada/).textContent ?? ''
    expect(text).toContain('该成员不报告压缩数据')
    expect(text).not.toContain('已压缩上下文')
  })

  it('the English row says the same', () => {
    row({ outcome: 'completed', unreported: true }, en)
    expect(screen.getByText(/ada/).textContent).toContain('does not report compaction data')
  })

  it('a long summary can be closed from its end, returning focus to the top toggle', () => {
    row({ outcome: 'completed', summary: '第一段的创作约束。\n\n最后一段的待办事项。' })
    const top = screen.getByRole('button', { name: /看摘要/ })
    fireEvent.click(top)

    const summaryId = top.getAttribute('aria-controls')!
    expect(document.getElementById(summaryId)?.textContent).toContain('最后一段的待办事项。')
    const toggles = screen.getAllByRole('button', { name: /收起摘要/ })
    expect(toggles).toHaveLength(2)
    fireEvent.click(toggles[1]!)

    expect(document.getElementById(summaryId)).toBeNull()
    expect(top.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(top)
    fireEvent.click(top)
    expect(document.getElementById(summaryId)?.textContent).toContain('第一段的创作约束。')
  })

  it('a compaction without a summary has no expand or end-collapse control', () => {
    row({ outcome: 'completed' })
    const line = screen.getByRole('button', { name: /ada 已压缩上下文/ }) as HTMLButtonElement
    expect(line.disabled).toBe(true)
    expect(line.getAttribute('aria-controls')).toBeNull()
    expect(screen.queryByRole('button', { name: '收起摘要' })).toBeNull()
  })
})
