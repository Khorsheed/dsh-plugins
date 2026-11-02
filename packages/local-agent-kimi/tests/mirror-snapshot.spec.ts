/**
 * Behavior lock for the wire fold: one fixed `wire.jsonl` → the exact
 * child-session event sequence. The live driver's locks (stream finalization,
 * orphan tool) sit beside its fake ACP server in live-driver.spec.ts.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { mirrorKimiSessionDelta } from '../src/session-mirror.ts'
import { expectValidReleasedLog } from './expect-valid-log.ts'
import { fakeSessionPersistence } from './fake-persistence.ts'
import { mirrorSnapshot, SNAPSHOT_NOW } from './mirror-snapshot.ts'

const loop = (time: number, event: Record<string, unknown>) => ({ type: 'context.append_loop_event', time, event })

/** Two wire steps (a mixed think/text/tool step, a failed-free reply step), then an unanswered call the settle pass folds. */
const wire = [
  { type: 'turn.prompt', time: 1000, input: [{ type: 'text', text: '建个文件' }] },
  loop(1000, { type: 'step.begin', turnId: 0, step: 1 }),
  { type: 'llm.request', time: 1000, turnStep: '1.1', model: 'k3', thinkingEffort: 'high', maxTokens: 1_048_576 },
  loop(1100, { type: 'content.part', turnId: 0, step: 1, part: { type: 'think', think: '先写文件' } }),
  loop(1200, { type: 'content.part', turnId: 0, step: 1, part: { type: 'text', text: '我开始了。' } }),
  loop(1300, { type: 'tool.call', turnId: 0, step: 1, toolCallId: 'call_1', toolCall: { name: 'Write', args: { path: 'a.txt' } } }),
  loop(1650, { type: 'tool.result', toolCallId: 'call_1', result: { output: 'Wrote 10 bytes' } }),
  { type: 'usage.record', time: 1650, model: 'kimi-code/k3', usage: { inputOther: 100, output: 25, inputCacheRead: 40, inputCacheCreation: 0 } },
  loop(1650, { type: 'step.end', turnId: 0, step: 1, llmFirstTokenLatencyMs: 50 }),
  loop(1700, { type: 'step.begin', turnId: 0, step: 2 }),
  { type: 'llm.request', time: 1700, turnStep: '1.2', model: 'k3', thinkingEffort: 'high', maxTokens: 1_048_576 },
  loop(1800, { type: 'content.part', turnId: 0, step: 2, part: { type: 'text', text: '文件建好了。' } }),
  loop(1850, { type: 'tool.call', turnId: 0, step: 2, toolCallId: 'call_2', toolCall: { name: 'Bash', args: { command: 'sleep 9' } } }),
  { type: 'usage.record', time: 1900, model: 'kimi-code/k3', usage: { inputOther: 20, output: 5, inputCacheRead: 140, inputCacheCreation: 0 } },
  loop(1900, { type: 'step.end', turnId: 0, step: 2, llmFirstTokenLatencyMs: 30 }),
]

describe('kimi mirror snapshot (wire fold)', () => {
  it('one fixed wire.jsonl, folded at settle → the exact child-session event sequence', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: SNAPSHOT_NOW })
    try {
      const home = mkdtempSync(join(tmpdir(), 'kimi-snapshot-'))
      const dir = join(home, 'sessions', 'wd_tmp_abc', 'session_snap', 'agents', 'main')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'wire.jsonl'), wire.map(line => JSON.stringify(line)).join('\n') + '\n')
      const child = Session.create(SessionId('child-kimi-snapshot'))
      const ctx = new Context()
      ctx.provide('sessionPersistence', fakeSessionPersistence())
      child.append('turn/start', { turn: 1 })
      await mirrorKimiSessionDelta(ctx, child, home, 'snap', 0, { settle: true })
      expectValidReleasedLog(child)
      expect(mirrorSnapshot(child)).toMatchSnapshot()
    } finally {
      vi.useRealTimers()
    }
  })
})
