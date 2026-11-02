import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readCodexModelTiming } from '../src/timing.ts'

describe('readCodexModelTiming', () => {
  it('reconstructs coarse model streams and tool intervals from a rollout', async () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-history-'))
    const dir = join(home, 'sessions', '2026', '01', '01')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'rollout-test-s1.jsonl'), [
      JSON.stringify({ type: 'response_item', timestamp: '2026-01-01T00:00:00.500Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'instructions' }] } }),
      JSON.stringify({ type: 'turn_context', timestamp: '2026-01-01T00:00:01.000Z', payload: { turn_id: 'turn-1' } }),
      JSON.stringify({ type: 'response_item', timestamp: '2026-01-01T00:00:01.100Z', payload: { type: 'custom_tool_call', id: 'ctc1', call_id: 'call-1', name: 'exec', input: 'x', status: 'completed' } }),
      JSON.stringify({ type: 'response_item', timestamp: '2026-01-01T00:00:01.600Z', payload: { type: 'custom_tool_call_output', id: 'out1', call_id: 'call-1', output: 'ok' } }),
      JSON.stringify({ type: 'turn_context', timestamp: '2026-01-01T00:00:02.000Z', payload: { turn_id: 'turn-2' } }),
      JSON.stringify({ type: 'response_item', timestamp: '2026-01-01T00:00:02.200Z', payload: { type: 'message', id: 'm2', role: 'assistant', content: [{ type: 'output_text', text: 'answer' }] } }),
    ].join('\n'))
    const timing = await readCodexModelTiming(home, 's1')
    expect(timing?.streams['1:1']).toHaveLength(2)
    expect(timing?.streams['1:1']?.[0]).toMatchObject({ time: Date.parse('2026-01-01T00:00:01.100Z') })
    expect(timing?.streams['1:1']?.[1]).toMatchObject({ time: Date.parse('2026-01-01T00:00:01.100Z') })
    expect(timing?.toolTimings['ctc1']).toMatchObject({ startedAt: Date.parse('2026-01-01T00:00:01.100Z'), endedAt: Date.parse('2026-01-01T00:00:01.600Z') })
    expect(Object.keys(timing?.streams ?? {}).some(key => key.startsWith('0:'))).toBe(false)
    expect(timing?.streams['2:1']?.[0]).toMatchObject({ time: Date.parse('2026-01-01T00:00:02.000Z') })
    expect(timing?.streams['2:1']?.[1]).toMatchObject({ time: Date.parse('2026-01-01T00:00:02.200Z') })
  })

  it('prefers native item identities and execution durations when present', async () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-native-history-'))
    const dir = join(home, 'sessions', '2026', '01', '01')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'rollout-test-s1.jsonl'), [
      JSON.stringify({ type: 'turn_context', timestamp: '2026-01-01T00:00:01.000Z', payload: { turn_id: 'turn-1' } }),
      JSON.stringify({ type: 'event_msg', timestamp: '2026-01-01T00:00:01.200Z', payload: { type: 'item_completed', started_at_ms: Date.parse('2026-01-01T00:00:01.100Z'), completed_at_ms: Date.parse('2026-01-01T00:00:01.200Z'), item: { type: 'AgentMessage', id: 'm1', content: [{ type: 'output_text', text: 'checking' }] } } }),
      JSON.stringify({ type: 'response_item', timestamp: '2026-01-01T00:00:01.200Z', payload: { type: 'message', id: 'm1', role: 'assistant', content: [{ type: 'output_text', text: 'checking' }] } }),
      JSON.stringify({ type: 'event_msg', timestamp: '2026-01-01T00:00:01.300Z', payload: { type: 'item_completed', started_at_ms: Date.parse('2026-01-01T00:00:01.300Z'), completed_at_ms: Date.parse('2026-01-01T00:00:01.300Z'), item: { type: 'CommandExecution', id: 'exec-native', command: 'true', duration: { secs: 0, nanos: 5000000 }, status: 'completed' } } }),
    ].join('\n'))
    const timing = await readCodexModelTiming(home, 's1')
    expect(timing?.requestStarts).toMatchObject({ '1:1': Date.parse('2026-01-01T00:00:01.000Z'), '1:2': Date.parse('2026-01-01T00:00:01.200Z') })
    expect(timing?.streams['1:1']?.[0]).toMatchObject({ time: Date.parse('2026-01-01T00:00:01.100Z') })
    expect(timing?.streams['1:2']?.[1]?.chunk).toMatchObject({ type: 'block-end', block: { id: 'exec-native' } })
    expect(timing?.toolTimings['exec-native']).toMatchObject({ startedAt: Date.parse('2026-01-01T00:00:01.300Z') - 5, endedAt: Date.parse('2026-01-01T00:00:01.300Z') })
    expect(timing?.toolTimings['ctc1']).toBeUndefined()
  })
})
