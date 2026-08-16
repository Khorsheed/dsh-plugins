import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { mirrorKimiSession } from '../src/session-mirror.ts'

function tempHome(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

/** A kimi scoped home with one session directory carrying a wire log. */
function wireHome(sessionId: string, wireLines: unknown[]): { home: string; dir: string } {
  const home = tempHome('kimi-mirror-')
  const dir = join(home, 'sessions', 'wd_tmp_abc', `session_${sessionId}`)
  mkdirSync(join(dir, 'agents', 'main'), { recursive: true })
  writeFileSync(join(dir, 'agents', 'main', 'wire.jsonl'), wireLines.map(line => JSON.stringify(line)).join('\n'))
  return { home, dir }
}

const fullWire = [
  { type: 'context.append_message', message: { role: 'user', content: [{ type: 'text', text: '建个文件' }] } },
  { type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'think', think: 'Simple task.' } } },
  { type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'text', text: '我开始了。' } } },
  { type: 'context.append_loop_event', event: { type: 'tool.call', toolCall: { name: 'Write' } } },
  { type: 'context.append_loop_event', event: { type: 'tool.result', result: { output: 'Wrote 10 bytes' } } },
  { type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'text', text: '任务完成。' } } },
]

describe('session-mirror', () => {
  it('mirrors user prompts and folds assistant activity into messages', async () => {
    const { home } = wireHome('s1', fullWire)
    const child = Session.create(SessionId('child-1'))
    const ctx = new Context()
    const append = vi.fn(async () => {})
    ctx.provide('sessionPersistence', { create: async () => {}, append })

    await mirrorKimiSession(ctx, child, home)

    const events = child.events
    expect(events.filter(event => event.type === 'user/message').map(event => event.data.content)).toEqual([
      [{ type: 'text', text: '建个文件' }],
    ])
    const assistant = events.filter(event => event.type === 'assistant/message')
    expect(assistant.map(event => event.data.message.content)).toEqual([
      [{ type: 'reasoning', text: 'Simple task.' }],
      [{ type: 'text', text: '我开始了。' }],
      [{ type: 'text', text: '[工具 Write] → Wrote 10 bytes' }],
      [{ type: 'text', text: '任务完成。' }],
    ])
    // assistant events attribute the kimi route
    expect(assistant[0]!.data.message.source).toEqual({ kind: 'model', provider: 'kimi-cli', model: 'k3' })
    // the mirrored batch reaches persistence
    expect(append).toHaveBeenCalledWith(child.id, events)
  })

  it('attaches the wire usage record to the final assistant message', async () => {
    const wire = [
      { type: 'context.append_message', message: { role: 'user', content: [{ type: 'text', text: '建个文件' }] } },
      { type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'text', text: '我开始了。' } } },
      { type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'text', text: '任务完成。' } } },
      { type: 'usage.record', model: 'kimi-code/k3', usage: { inputOther: 100, output: 25, inputCacheRead: 40, inputCacheCreation: 0 }, usageScope: 'turn', time: 1 },
    ]
    const { home } = wireHome('usage', wire)
    const child = Session.create(SessionId('child-usage'))
    await mirrorKimiSession(new Context(), child, home)

    const assistant = child.events.filter(event => event.type === 'assistant/message')
    expect(assistant).toHaveLength(2)
    // Only the last assistant message carries the usage; earlier steps omit it.
    expect(assistant[0]!.data.usage).toBeUndefined()
    expect(assistant[1]!.data.usage).toEqual({ inputTokens: 100, outputTokens: 25, cacheReadTokens: 40 })
  })

  it('mirrors the most recent session across workspaces', async () => {
    const home = tempHome('kimi-mirror-newest-')
    const olderDir = join(home, 'sessions', 'wd_old', 'session_s1')
    mkdirSync(join(olderDir, 'agents', 'main'), { recursive: true })
    writeFileSync(join(olderDir, 'agents', 'main', 'wire.jsonl'), JSON.stringify(
      { type: 'context.append_message', message: { role: 'user', content: [{ type: 'text', text: '旧任务' }] } },
    ))
    const newerDir = join(home, 'sessions', 'wd_new', 'session_s2')
    mkdirSync(join(newerDir, 'agents', 'main'), { recursive: true })
    writeFileSync(join(newerDir, 'agents', 'main', 'wire.jsonl'), JSON.stringify(
      { type: 'context.append_message', message: { role: 'user', content: [{ type: 'text', text: '新任务' }] } },
    ))

    const child = Session.create(SessionId('child-2'))
    await mirrorKimiSession(new Context(), child, home)

    const user = child.events.find(event => event.type === 'user/message')
    expect(user?.data.content).toEqual([{ type: 'text', text: '新任务' }])
  })

  it('mirrors a named session id instead of the newest', async () => {
    const { home } = wireHome('named', fullWire)
    const child = Session.create(SessionId('child-3'))
    await mirrorKimiSession(new Context(), child, home, 'named')

    const user = child.events.find(event => event.type === 'user/message')
    expect(user?.data.content).toEqual([{ type: 'text', text: '建个文件' }])
  })

  it('keeps looking for a named session past earlier empty workspaces', async () => {
    // The named session lives in the SECOND workspace; the first contains a
    // directory for another session id, whose absent wire log reads as an
    // empty transcript rather than throwing. The mirror must not stop there.
    const home = tempHome('kimi-mirror-later-')
    const emptyDir = join(home, 'sessions', 'wd_first', 'session_other')
    mkdirSync(join(emptyDir, 'agents', 'main'), { recursive: true })
    const wireHome_ = wireHome('named-later', fullWire)
    // wireHome creates its own root; reuse its session under this home instead.
    const { dir } = wireHome_
    const target = join(home, 'sessions', 'wd_second', 'session_named-later')
    mkdirSync(join(target, 'agents', 'main'), { recursive: true })
    writeFileSync(join(target, 'agents', 'main', 'wire.jsonl'), readFileSync(join(dir, 'agents', 'main', 'wire.jsonl')))

    const child = Session.create(SessionId('child-6'))
    await mirrorKimiSession(new Context(), child, home, 'named-later')

    const user = child.events.find(event => event.type === 'user/message')
    expect(user?.data.content).toEqual([{ type: 'text', text: '建个文件' }])
  })

  it('leaves the session untouched when no kimi session exists', async () => {
    const home = tempHome('kimi-mirror-empty-')
    const child = Session.create(SessionId('child-4'))
    await mirrorKimiSession(new Context(), child, home)
    expect(child.events).toEqual([])
  })

  it('leaves the session untouched when the newest session has no transcript', async () => {
    const home = tempHome('kimi-mirror-notranscript-')
    const dir = join(home, 'sessions', 'wd_x', 'session_s1')
    mkdirSync(join(dir, 'agents', 'main'), { recursive: true })
    const child = Session.create(SessionId('child-5'))
    await mirrorKimiSession(new Context(), child, home)
    expect(child.events).toEqual([])
  })
})
