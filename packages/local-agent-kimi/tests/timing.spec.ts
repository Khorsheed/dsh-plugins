import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readKimiModelTiming } from '../src/timing.ts'

describe('readKimiModelTiming', () => {
  it('reconstructs model streams and tool intervals from the original wire', async () => {
    const home = mkdtempSync(join(tmpdir(), 'kimi-history-'))
    const dir = join(home, 'sessions', 'wd_x', 'session_s1', 'agents', 'main')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'wire.jsonl'), [
      JSON.stringify({ type: 'turn.prompt', time: 1000, input: [{ type: 'text', text: 'go' }] }),
      JSON.stringify({ type: 'context.append_loop_event', time: 1000, event: { type: 'step.begin', turnId: 0, step: 1 } }),
      JSON.stringify({ type: 'llm.request', time: 1000, turnStep: '1.1' }),
      JSON.stringify({ type: 'context.append_loop_event', time: 1100, event: { type: 'content.part', turnId: 0, step: 1, part: { type: 'think', think: 'reason' } } }),
      JSON.stringify({ type: 'context.append_loop_event', time: 1200, event: { type: 'tool.call', turnId: 0, step: 1, toolCallId: 'tc1', name: 'Write' } }),
      JSON.stringify({ type: 'context.append_loop_event', time: 1300, event: { type: 'tool.result', toolCallId: 'tc1', result: { output: 'ok' } } }),
      JSON.stringify({ type: 'context.append_loop_event', time: 1300, event: { type: 'step.end', turnId: 0, step: 1, llmFirstTokenLatencyMs: 50 } }),
    ].join('\n'))
    const timing = await readKimiModelTiming(home, 's1')
    expect(timing?.streams['1:1']).toHaveLength(4)
    expect(timing?.streams['1:1']?.[0]).toMatchObject({ time: 1050 })
    expect(timing?.requestStarts?.['1:1']).toBe(1000)
    expect(timing?.toolTimings['tc1']).toMatchObject({ startedAt: 1200, endedAt: 1300 })
  })
})
