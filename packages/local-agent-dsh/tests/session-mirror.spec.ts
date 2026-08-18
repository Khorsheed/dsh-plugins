/**
 * The dsh session mirror: round-scoped event copy from the sub-dsh session
 * file into the parent-side child session — caller-task filtering, verbatim
 * assistant events (usage included), resume-round incrementality, missing and
 * compressed files.
 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { zstdCompressSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { mirrorDshSession, readSubDshEvents } from '../src/session-mirror.ts'

/** A context whose sessionPersistence is absent (the mirror tolerates it). */
function fakeCtx(): Context {
  return { get: () => undefined, logger: { warn: () => undefined } } as unknown as Context
}

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-mirror-'))
}

/** One user/message event line as the sub-dsh records it. */
function userLine(text: string, kind: string): object {
  return {
    type: 'user/message',
    seq: 0,
    time: 1,
    data: {
      content: [{ type: 'text', text }],
      source: kind === 'user' ? { kind: 'user' } : { kind: 'plugin', plugin: kind },
      role: 'user',
    },
  }
}

/** One assistant/message event line with usage, as the sub-dsh records it. */
function assistantLine(turn: number, text: string): object {
  return {
    type: 'assistant/message',
    seq: 0,
    time: 1,
    data: {
      turn,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'reasoning', text: `thinking ${turn}` }, { type: 'text', text }],
        source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      }),
      usage: { inputTokens: 100 * turn, outputTokens: 10 * turn },
    },
  }
}

/** A two-round sub-dsh session: each round has a task, scaffolding, and a reply. */
function twoRoundLines(): object[] {
  return [
    { type: 'session', version: 0, id: 'x' },
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    userLine('第一轮任务', 'user'),
    userLine('<system-reminder> workspace</system-reminder>', 'agent-instructions'),
    userLine('Current runtime context…', '@deepseek-ai/dsh-system-prompt'),
    assistantLine(1, '第一轮回答'),
    { type: 'turn/end', seq: 0, time: 1, data: { turn: 1, reason: { kind: 'completed' } } },
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 2 } },
    userLine('第二轮任务', 'user'),
    assistantLine(2, '第二轮回答'),
    { type: 'turn/end', seq: 0, time: 1, data: { turn: 2, reason: { kind: 'completed' } } },
  ]
}

function writeSubDshSession(homeDir: string, id: string, lines: object[], compressed = false): void {
  const dir = join(homeDir, 'sessions', 'wd_test', id)
  mkdirSync(dir, { recursive: true })
  const text = lines.map(line => JSON.stringify(line)).join('\n') + '\n'
  if (compressed) {
    writeFileSync(join(dir, 'session.jsonl.zstd'), zstdCompressSync(text))
  } else {
    writeFileSync(join(dir, 'session.jsonl'), text)
  }
}

/** A child session pre-loaded with `rounds` turn boundaries, as the provider leaves it. */
function childWithRounds(id: string, rounds: number): Session {
  const child = Session.create(SessionId(id))
  for (let turn = 1; turn <= rounds; turn += 1) {
    child.append('turn/start', { turn })
    child.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  return child
}

describe('readSubDshEvents', () => {
  it('returns undefined when the session is absent', async () => {
    await expect(readSubDshEvents(tempHome(), 'nope')).resolves.toBeUndefined()
  })

  it('reads a zstd-compressed session log', async () => {
    const home = tempHome()
    writeSubDshSession(home, 's1', twoRoundLines(), true)
    await expect(readSubDshEvents(home, 's1')).resolves.toHaveLength(twoRoundLines().length - 1)
  })
})

describe('mirrorDshSession', () => {
  it('mirrors only the current round, filtering scaffolding user messages', async () => {
    const home = tempHome()
    writeSubDshSession(home, 'child-1', twoRoundLines())
    const child = childWithRounds('child-1', 1)
    await mirrorDshSession(fakeCtx(), child, home, 'child-1')
    const mirrored = child.events.filter(event => event.type === 'user/message' || event.type === 'assistant/message')
    // Exactly the round-1 task and reply cross; the round-2 content stays behind.
    expect(mirrored).toHaveLength(2)
    const [task, reply] = mirrored
    expect(task?.type).toBe('user/message')
    expect(JSON.stringify(task?.data)).toContain('第一轮任务')
    expect(reply?.type).toBe('assistant/message')
    expect(JSON.stringify(reply?.data)).toContain('第一轮回答')
    // Usage rides the verbatim assistant event into the projection.
    expect(JSON.stringify(reply?.data)).toContain('"inputTokens":100')
    // Scaffolding (agent-instructions / plugin context) never crosses.
    expect(JSON.stringify(child.events)).not.toContain('agent-instructions')
    expect(JSON.stringify(child.events)).not.toContain('runtime context')
  })

  it('mirrors only the resumed round incrementally on a later round', async () => {
    const home = tempHome()
    writeSubDshSession(home, 'child-2', twoRoundLines())
    const child = childWithRounds('child-2', 2)
    await mirrorDshSession(fakeCtx(), child, home, 'child-2')
    const mirrored = child.events.filter(event => event.type === 'user/message' || event.type === 'assistant/message')
    expect(mirrored).toHaveLength(2)
    expect(JSON.stringify(mirrored[1]?.data)).toContain('第二轮回答')
    expect(JSON.stringify(child.events)).not.toContain('第一轮回答')
  })

  it('is a no-op when the sub-dsh session never materialized', async () => {
    const child = childWithRounds('child-3', 1)
    await expect(mirrorDshSession(fakeCtx(), child, tempHome(), 'child-3')).resolves.toBeUndefined()
    expect(child.events.filter(event => event.type === 'assistant/message')).toHaveLength(0)
  })
})
