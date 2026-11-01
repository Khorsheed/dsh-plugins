/**
 * The reader host half writes the destination line through its own copy (host
 * faces are not bundled); this pins that copy to the reference reader of
 * @khorsheed/dsh-client-ui-agent-nav, and the row model to the place it reads.
 */
import { describe, expect, it } from 'vitest'
import { NAV_MARK as REFERENCE_MARK, readDestinations } from '@khorsheed/dsh-client-ui-agent-nav/src/destination.ts'
import { NAV_MARK, withReaderDestination } from '../src/nav-line.ts'
import { writeRowModel } from '../src/client/WriteToolRow.tsx'

describe('reader destination line', () => {
  it('uses the reference marker and reads back as a reader destination', () => {
    expect(NAV_MARK).toBe(REFERENCE_MARK)
    const answer = withReaderDestination('完成：结论已写在《雨》的笔记 n2 下。', 'reader:e1:note:n2:1', { entryId: 'e1', tab: 'notes' }, '《雨》笔记 n2')
    expect(readDestinations(answer)).toEqual([
      { id: 'reader:e1:note:n2:1', kind: 'reader', params: { entryId: 'e1', tab: 'notes' }, label: '《雨》笔记 n2' },
    ])
  })

  it('the row shows the answer without the line, and its door names the place', () => {
    const answer = withReaderDestination('完成：结论已写在《雨》的笔记 n2 下。', 'x', { entryId: 'e1', tab: 'notes' }, '《雨》笔记 n2')
    expect(writeRowModel({ kind: 'tool-result', content: [{ type: 'text', text: answer }] })).toEqual({
      state: 'done', text: '完成：结论已写在《雨》的笔记 n2 下。', place: { entryId: 'e1', tab: 'notes' },
    })
    // An answer from before the line: the text, no door.
    expect(writeRowModel({ kind: 'tool-result', content: [{ type: 'text', text: '完成：旧答复。' }] })).toEqual({ state: 'done', text: '完成：旧答复。' })
    expect(writeRowModel({ kind: 'tool-result', isError: true, content: [{ type: 'text', text: '失败：没有找到文章。' }] }).state).toBe('failed')
    expect(writeRowModel({}).state).toBe('running')
  })
})
