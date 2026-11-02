import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readClaudeModelTiming } from '../src/timing.ts'

describe('readClaudeModelTiming', () => {
  it('reconstructs coarse model streams and tool intervals from stream-json', async () => {
    const home = mkdtempSync(join(tmpdir(), 'claude-history-'))
    const dir = join(home, 'projects', '-home-user')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 's1.jsonl'), [
      JSON.stringify({ type: 'system', timestamp: '2026-08-16T00:00:00.000Z' }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-08-16T00:00:00.100Z', message: { id: 'm1', content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'true' } }] } }),
      JSON.stringify({ type: 'user', timestamp: '2026-08-16T00:00:00.300Z', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }] } }),
      JSON.stringify({ type: 'result', timestamp: '2026-08-16T00:00:00.300Z' }),
    ].join('\n'))
    const timing = await readClaudeModelTiming(home, 's1')
    expect(timing?.streams['1:1']).toHaveLength(2)
    expect(timing?.streams['1:1']?.[0]).toMatchObject({ time: Date.parse('2026-08-16T00:00:00.000Z') })
    expect(timing?.toolTimings['tu1']).toMatchObject({ startedAt: Date.parse('2026-08-16T00:00:00.100Z'), endedAt: Date.parse('2026-08-16T00:00:00.300Z') })
  })

  it('uses native dequeue and API-request boundaries when result events are absent', async () => {
    const home = mkdtempSync(join(tmpdir(), 'claude-native-history-'))
    const dir = join(home, 'projects', '-home-user')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 's1.jsonl'), [
      JSON.stringify({ type: 'queue-operation', operation: 'dequeue', timestamp: '2026-08-16T00:00:00.000Z' }),
      JSON.stringify({ type: 'api-request', timestamp: '2026-08-16T00:00:00.050Z' }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-08-16T00:00:00.100Z', message: { id: 'm1', content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'true' } }] } }),
      JSON.stringify({ type: 'user', timestamp: '2026-08-16T00:00:00.300Z', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }] } }),
      JSON.stringify({ type: 'queue-operation', operation: 'dequeue', timestamp: '2026-08-16T00:00:01.000Z' }),
      JSON.stringify({ type: 'api-request', timestamp: '2026-08-16T00:00:01.050Z' }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-08-16T00:00:01.100Z', message: { id: 'm2', content: [{ type: 'text', text: 'answer' }] } }),
    ].join('\n'))
    const timing = await readClaudeModelTiming(home, 's1')
    expect(timing?.requestStarts).toMatchObject({
      '1:1': Date.parse('2026-08-16T00:00:00.050Z'),
      '2:1': Date.parse('2026-08-16T00:00:01.050Z'),
    })
    expect(timing?.streams['2:1']?.[0]).toMatchObject({ time: Date.parse('2026-08-16T00:00:01.050Z') })
    expect(timing?.toolTimings['tu1']).toMatchObject({ startedAt: Date.parse('2026-08-16T00:00:00.100Z'), endedAt: Date.parse('2026-08-16T00:00:00.300Z') })
  })
})
