import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findKimiSessionDir, readKimiTranscript, renderTranscript, sumUsageRecords } from '../src/session-view.ts'

function tempHome(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

/** A session directory with a small wire log covering every transcript kind. */
function wireSession(sessionId: string): { home: string; dir: string } {
  const home = tempHome('kimi-session-')
  const dir = join(home, 'sessions', 'wd_tmp_abc', `session_${sessionId}`)
  mkdirSync(join(dir, 'agents', 'main'), { recursive: true })
  writeFileSync(join(dir, 'agents', 'main', 'wire.jsonl'), [
    JSON.stringify({ type: 'context.append_message', message: { role: 'user', content: [{ type: 'text', text: '建个文件' }] } }),
    JSON.stringify({ type: 'context.append_loop_event', event: { type: 'step.begin', turnId: 0 } }),
    JSON.stringify({ type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'think', think: 'Simple task.' } } }),
    JSON.stringify({ type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'text', text: '我开始了。' } } }),
    JSON.stringify({ type: 'context.append_loop_event', event: { type: 'tool.call', toolCall: { name: 'Write', args: { path: '/tmp/a.txt' } }, uuid: 'u1', toolCallId: 'tc1' } }),
    JSON.stringify({ type: 'context.append_loop_event', event: { type: 'tool.result', parentUuid: 'u1', result: { output: 'Wrote 10 bytes' } } }),
    JSON.stringify({ type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'text', text: '任务完成。' } } }),
    'not-json garbage line',
  ].join('\n'))
  return { home, dir }
}

describe('session-view', () => {
  it('finds a session directory by id across workspaces', async () => {
    const { home, dir } = wireSession('s1')
    expect(await findKimiSessionDir(home, 's1')).toBe(dir)
    expect(await findKimiSessionDir(home, 'missing')).toBeUndefined()
  })

  it('parses a wire log into a readable transcript tagged with turn numbers', async () => {
    const { dir } = wireSession('s1')
    const transcript = await readKimiTranscript(dir)
    expect(transcript.lines).toEqual([
      { kind: 'user', text: '建个文件', turn: 1 },
      { kind: 'think', text: 'Simple task.', turn: 1 },
      { kind: 'assistant', text: '我开始了。', turn: 1 },
      { kind: 'tool', id: 'tc1', name: 'Write', args: '/tmp/a.txt', result: 'Wrote 10 bytes', turn: 1 },
      { kind: 'assistant', text: '任务完成。', turn: 1 },
    ])
  })

  it('matches parallel tool results to their owning call by parentUuid', async () => {
    const home = tempHome('kimi-session-toolpair-')
    const dir = join(home, 'sessions', 'wd_x', 'session_tp')
    mkdirSync(join(dir, 'agents', 'main'), { recursive: true })
    writeFileSync(join(dir, 'agents', 'main', 'wire.jsonl'), [
      JSON.stringify({ type: 'context.append_loop_event', event: { type: 'tool.call', toolCall: { name: 'WebSearch', args: { query: 'A' } }, uuid: 'uA', toolCallId: 'tA' } }),
      JSON.stringify({ type: 'context.append_loop_event', event: { type: 'tool.call', toolCall: { name: 'WebSearch', args: { query: 'B' } }, uuid: 'uB', toolCallId: 'tB' } }),
      JSON.stringify({ type: 'context.append_loop_event', event: { type: 'tool.result', parentUuid: 'uB', result: { output: 'RESULT_B' } } }),
      JSON.stringify({ type: 'context.append_loop_event', event: { type: 'tool.result', parentUuid: 'uA', result: { output: 'RESULT_A' } } }),
    ].join('\n'))
    const transcript = await readKimiTranscript(dir)
    expect(transcript.lines).toEqual([
      { kind: 'tool', id: 'tA', name: 'WebSearch', args: 'A', result: 'RESULT_A', turn: 1 },
      { kind: 'tool', id: 'tB', name: 'WebSearch', args: 'B', result: 'RESULT_B', turn: 1 },
    ])
  })

  it('filters kimi system-reminder user messages out of the transcript', async () => {
    const home = tempHome('kimi-session-reminder-')
    const dir = join(home, 'sessions', 'wd_x', 'session_rm')
    mkdirSync(join(dir, 'agents', 'main'), { recursive: true })
    writeFileSync(join(dir, 'agents', 'main', 'wire.jsonl'), [
      JSON.stringify({ type: 'turn.prompt', input: [{ type: 'text', text: '真正的任务' }] }),
      JSON.stringify({ type: 'context.append_message', message: { role: 'user', content: [{ type: 'text', text: '<system-reminder>\nAuto permission mode is active. Continue normally.' }] } }),
      JSON.stringify({ type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'text', text: '做完了。' } } }),
    ].join('\n'))
    const transcript = await readKimiTranscript(dir)
    expect(transcript.lines.map(line => line.kind)).toEqual(['user', 'assistant'])
    expect(transcript.lines[0]).toMatchObject({ kind: 'user', text: '真正的任务' })
  })

  it('renders the transcript as reply text with tool arguments', async () => {
    const { dir } = wireSession('s1')
    const text = renderTranscript(await readKimiTranscript(dir))
    expect(text).toContain('用户: 建个文件')
    expect(text).toContain('kimi: 任务完成。')
    expect(text).toContain('↳ [工具 Write] /tmp/a.txt → Wrote 10 bytes')
  })

  it('returns an empty transcript when the wire log is absent', async () => {
    const home = tempHome('kimi-session-empty-')
    const dir = join(home, 'sessions', 'wd_x', 'session_s2')
    mkdirSync(join(dir, 'agents', 'main'), { recursive: true })
    const transcript = await readKimiTranscript(dir)
    expect(transcript.lines).toEqual([])
    expect(renderTranscript(transcript)).toContain('no readable transcript')
  })

  it('collects every usage.record with its transcript position', async () => {
    const home = tempHome('kimi-session-usage-')
    const dir = join(home, 'sessions', 'wd_x', 'session_u1')
    mkdirSync(join(dir, 'agents', 'main'), { recursive: true })
    writeFileSync(join(dir, 'agents', 'main', 'wire.jsonl'), [
      JSON.stringify({ type: 'usage.record', usage: { inputOther: 10, output: 5, inputCacheRead: 3, inputCacheCreation: 2 } }),
      JSON.stringify({ type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'text', text: 'hi' } } }),
      JSON.stringify({ type: 'usage.record', usage: { inputOther: 100, output: 50, inputCacheRead: 30, inputCacheCreation: 20 } }),
    ].join('\n'))
    const transcript = await readKimiTranscript(dir)
    expect(transcript.usageRecords).toHaveLength(2)
    expect(transcript.usageRecords[0]).toEqual({
      line: 0,
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 3, cacheWriteTokens: 2 },
    })
  })

  it('sums usage records across a delta (per-request records, not cumulative)', async () => {
    const sum = sumUsageRecords([
      { line: 0, usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 3, cacheWriteTokens: 2 } },
      { line: 3, usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 30, cacheWriteTokens: 20 } },
    ])
    expect(sum).toEqual({
      inputTokens: 110,
      outputTokens: 55,
      cacheReadTokens: 33,
      cacheWriteTokens: 22,
    })
  })

  it('omits usage when the wire reports none', async () => {
    const home = tempHome('kimi-session-nousage-')
    const dir = join(home, 'sessions', 'wd_x', 'session_u2')
    mkdirSync(join(dir, 'agents', 'main'), { recursive: true })
    writeFileSync(join(dir, 'agents', 'main', 'wire.jsonl'),
      JSON.stringify({ type: 'context.append_message', message: { role: 'user', content: [{ type: 'text', text: 'x' }] } }),
    )
    const transcript = await readKimiTranscript(dir)
    expect(transcript.usageRecords).toEqual([])
  })

  it('parses the real two-round resume wire fixture with correct turns and summed usage', async () => {
    const fixtureWire = readFileSync(
      fileURLToPath(new URL('./fixtures/two-round-resume.wire.jsonl', import.meta.url)),
      'utf8',
    )
    const home = tempHome('kimi-session-fixture-')
    const dir = join(home, 'sessions', 'wd_tmp_abc', 'session_fixture')
    mkdirSync(join(dir, 'agents', 'main'), { recursive: true })
    writeFileSync(join(dir, 'agents', 'main', 'wire.jsonl'), fixtureWire)
    const transcript = await readKimiTranscript(dir)
    // Round 1: real prompt, reminder filtered, web searches with args+results.
    expect(transcript.lines[0]).toMatchObject({ kind: 'user', turn: 1 })
    expect(transcript.lines[0]).not.toMatchObject({ text: expect.stringContaining('system-reminder') })
    expect(transcript.lines.some(line => line.kind === 'user' && line.turn === 2)).toBe(true)
    // Every WebSearch call carries its query argument.
    const searches = transcript.lines.filter(line => line.kind === 'tool' && line.name === 'WebSearch')
    expect(searches.length).toBeGreaterThan(0)
    for (const search of searches) {
      if (search.kind === 'tool') expect(search.args).toBeTruthy()
    }
    // 8 usage records (3 in round 1, 5 in round 2), each a per-request record.
    expect(transcript.usageRecords).toHaveLength(8)
    const round1 = sumUsageRecords(transcript.usageRecords.filter(record => record.line < 10))
    expect(round1).toEqual({
      inputTokens: 4027 + 7855 + 2799,
      outputTokens: 169 + 300 + 1069,
      cacheReadTokens: 18944 + 22784 + 30720,
    })
    // Round 2 continues past the first user line of turn 2 (index 10).
    const round2 = sumUsageRecords(transcript.usageRecords.filter(record => record.line >= 10))
    expect(round2?.inputTokens).toBe(15817 + 8360 + 1160 + 5698 + 5268)
    expect(round2?.outputTokens).toBe(138 + 175 + 251 + 224 + 881)
  })
})
