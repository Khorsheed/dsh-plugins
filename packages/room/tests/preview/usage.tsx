/**
 * Manual UI fixture for a member reply's usage line (batch 5 S6: the real
 * RoomSpeechView fed by a scripted core reading):
 *   pnpm exec vite packages/room/tests/preview --config packages/room/tests/preview/vite.config.ts --host 127.0.0.1
 * then open /usage.html?state=<match|mismatch|kimi|legacy>[&lang=en][&dark=1][&open=1]
 * (`match` = claude-code, per-call sum equals the CLI total; `mismatch` = the
 * calls add up to 1.2K less; `kimi` = no CLI total, the per-call sum;
 * `legacy` = a run from before S6 with its stored numbers; `open=1` opens the
 * usage breakdown.)
 */
import React, { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import type { LocalAgentExecutionReading } from '@khorsheed/dsh-local-agent/types'
import { RoomSpeechView } from '../../src/client/RoomSpeechView.tsx'
import { en, zh } from '../../src/client/locales.ts'
import type { RoomExecution, RoomState } from '../../src/types.ts'

const params = new URLSearchParams(location.search)
const state = params.get('state') ?? 'match'
const dictionary: Record<string, string> = params.get('lang') === 'en' ? en : zh
const t = ((key: string, vars?: Record<string, unknown>) => (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (_m, k: string) => String(vars?.[k] ?? k))) as never
if (params.get('dark') === '1') document.documentElement.dataset['theme'] = 'dark'

const CLI = { inputTokens: 2_140, cacheReadTokens: 38_912, cacheWriteTokens: 1_024, outputTokens: 1_310 }
const reading = (over: Partial<LocalAgentExecutionReading>): LocalAgentExecutionReading => ({
  executionId: 'e1', operation: 'prompt', outcome: 'done', turns: [3], calls: 4, unrecorded: [], compactions: [], ...over,
})
const kimi = state === 'kimi'
const member = kimi ? '月之暗面' : '尼尔盖曼'
const RUN: Record<string, Partial<RoomExecution>> = {
  match: { model: 'claude-opus-5-5', reading: reading({ providerReportedUsage: CLI, callUsage: CLI }) },
  mismatch: { model: 'claude-opus-5-5', reading: reading({ providerReportedUsage: CLI, callUsage: { ...CLI, inputTokens: 940 }, unrecorded: ['internal-calls'] }) },
  kimi: { model: 'kimi-k3', reading: reading({ callUsage: { inputTokens: 3_400, cacheReadTokens: 21_504, outputTokens: 880 }, calls: 5 }) },
  legacy: { executionId: undefined, model: 'claude-opus-5-5', tokens: 29_234, usage: { inputTokens: 9_110, outputTokens: 1_180, cacheReadTokens: 18_944 } },
}
const execution: RoomExecution = { id: 'r1', memberId: 'm', member, state: 'done', startedAt: 1, executionId: 'e1', childSessionId: 'child-1' as never, ...RUN[state] }
const room: RoomState = {
  members: [
    { id: 'd', name: 'dsh', kind: 'main-agent', invitedBy: 'human' },
    { id: 'm', name: member, kind: 'cli', provider: kimi ? 'kimi-cli' : 'claude-local', invitedBy: 'human', childSessionId: 'child-1' as never },
  ],
  relays: [], tasks: [], runs: [], executions: [execution], latestSpeechSeq: 7,
}
const roomStore = { subscribe: () => () => {}, getCached: () => room }
const text = '骨架已经搭好：入口页、章节列表和设定卡三块都能跑通。下一步我会把章节计划接到大纲上，再补上目标字数的校验。'
const data = { seq: 7, time: new Date(2026, 10, 5, 0, 42).getTime(), member, text, childSessionId: 'child-1', durationMs: 84_000, runId: 'r1', messageId: 'msg-1' }

function Preview() {
  useEffect(() => {
    if (params.get('open') !== '1') return
    ;(document.querySelector('button[aria-expanded]') as HTMLButtonElement | null)?.focus()
  }, [])
  // Room above the reply for the breakdown, which opens upward.
  return <main style={{ maxWidth: 780, margin: '0 auto', padding: params.get('open') === '1' ? '360px 16px 40px' : '40px 16px' }}>
    <RoomSpeechView {...{
      node: { key: 'k', kind: 'room-speech', id: '7', target: 'chat', anchorSeq: 7, location: { kind: 'unresolved' }, visibility: 'visible', data },
      sessionId: 'room-1', roomStore, openSession: () => {}, openDetail: () => {}, t,
    } as never} />
  </main>
}
createRoot(document.getElementById('root')!).render(<Preview />)
