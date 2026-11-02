// @vitest-environment jsdom
/** The member compaction row: numbers when the member reported them, an explicit "does not report" otherwise. */
import { afterEach, describe, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { cleanup, render, screen } from '@testing-library/react'
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
})
