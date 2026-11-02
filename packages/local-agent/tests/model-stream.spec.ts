import { describe, expect, it } from 'vitest'
import { localAgentStreamRecords } from '../src/model-stream.ts'

describe('localAgentStreamRecords', () => {
  it('preserves model block types, times, and tool identity in the native stream vocabulary', () => {
    expect(localAgentStreamRecords([
      { kind: 'tool-call', index: 1, startedAt: 130, endedAt: 160, call: { id: 'c1', name: 'Read', arguments: '{"path":"a"}' } },
      { kind: 'reasoning', index: 0, startedAt: 100, endedAt: 120, text: 'think' },
    ])).toEqual([
      { type: 'chunk', time: 100, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } },
      { type: 'chunk', time: 120, chunk: { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'think' } } },
      { type: 'chunk', time: 130, chunk: { type: 'block-start', index: 1, blockType: 'tool-call' } },
      { type: 'chunk', time: 160, chunk: { type: 'block-end', index: 1, block: { type: 'tool-call', id: 'c1', name: 'Read', arguments: '{"path":"a"}' } } },
    ])
  })

  it('omits incomplete and invalid blocks', () => {
    expect(localAgentStreamRecords([
      { kind: 'text', index: 0, startedAt: 100, endedAt: 99 },
      { kind: 'tool-call', index: 1, startedAt: 100, endedAt: 100 },
      { kind: 'text', index: -1, startedAt: 100, endedAt: 100 },
    ])).toEqual([])
  })
})
