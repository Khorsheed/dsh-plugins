import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findKimiSessionDir, readKimiTranscript, renderTranscript } from '../src/session-view.ts'

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
    JSON.stringify({ type: 'context.append_message', message: { role: 'user', content: [{ type: 'tool-result', content: 'x' }] } }),
    JSON.stringify({ type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'think', think: 'Simple task.' } } }),
    JSON.stringify({ type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'text', text: '我开始了。' } } }),
    JSON.stringify({ type: 'context.append_loop_event', event: { type: 'tool.call', toolCall: { name: 'Write' } } }),
    JSON.stringify({ type: 'context.append_loop_event', event: { type: 'tool.result', result: { output: 'Wrote 10 bytes' } } }),
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

  it('parses a wire log into a readable transcript', async () => {
    const { dir } = wireSession('s1')
    const transcript = await readKimiTranscript(dir)
    expect(transcript.lines).toEqual([
      { kind: 'user', text: '建个文件' },
      { kind: 'think', text: 'Simple task.' },
      { kind: 'assistant', text: '我开始了。' },
      { kind: 'tool', name: 'Write', result: 'Wrote 10 bytes' },
      { kind: 'assistant', text: '任务完成。' },
    ])
  })

  it('renders the transcript as reply text', async () => {
    const { dir } = wireSession('s1')
    const text = renderTranscript(await readKimiTranscript(dir))
    expect(text).toContain('用户: 建个文件')
    expect(text).toContain('kimi: 任务完成。')
    expect(text).toContain('↳ 工具 Write → Wrote 10 bytes')
  })

  it('returns an empty transcript when the wire log is absent', async () => {
    const home = tempHome('kimi-session-empty-')
    const dir = join(home, 'sessions', 'wd_x', 'session_s2')
    mkdirSync(join(dir, 'agents', 'main'), { recursive: true })
    const transcript = await readKimiTranscript(dir)
    expect(transcript.lines).toEqual([])
    expect(renderTranscript(transcript)).toContain('no readable transcript')
  })

  it('carries the last usage.record as the transcript usage', async () => {
    const home = tempHome('kimi-session-usage-')
    const dir = join(home, 'sessions', 'wd_x', 'session_u1')
    mkdirSync(join(dir, 'agents', 'main'), { recursive: true })
    writeFileSync(join(dir, 'agents', 'main', 'wire.jsonl'), [
      JSON.stringify({ type: 'usage.record', usage: { inputOther: 10, output: 5, inputCacheRead: 3, inputCacheCreation: 2 } }),
      JSON.stringify({ type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'text', text: 'hi' } } }),
      JSON.stringify({ type: 'usage.record', usage: { inputOther: 100, output: 50, inputCacheRead: 30, inputCacheCreation: 20 } }),
    ].join('\n'))
    const transcript = await readKimiTranscript(dir)
    expect(transcript.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 30,
      cacheWriteTokens: 20,
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
    expect(transcript.usage).toBeUndefined()
  })
})
