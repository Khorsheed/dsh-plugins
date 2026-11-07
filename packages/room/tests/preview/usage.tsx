/**
 * Manual UI fixture for usage and compaction surfaces, using real components:
 *   pnpm exec vite packages/room/tests/preview --config packages/room/tests/preview/vite.config.ts --host 127.0.0.1
 * /usage.html?state=<match|mismatch|kimi|legacy>[&lang=en][&dark=1][&open=1]
 *   A member reply's usage line; open=1 focuses its breakdown button.
 * /usage.html?view=stats[&width=780][&lang=en][&dark=1]
 *   The members usage popover in a chat column of the requested CSS width.
 * /usage.html?view=compaction[&width=780][&lang=en][&dark=1]
 *   A long compaction summary with top and end collapse controls.
 */
import React, { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import type { LocalAgentExecutionReading } from '@khorsheed/dsh-local-agent/types'
import { RoomSpeechView } from '../../src/client/RoomSpeechView.tsx'
import { RoomStatsLine } from '../../src/client/RoomStatsLine.tsx'
import { RoomCompactionView } from '../../src/client/RoomCompactionView.tsx'
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
const statsRoom: RoomState = {
  members: [
    { id: 'd', name: 'dsh', kind: 'main-agent', invitedBy: 'human' },
    { id: 'gm', name: '游戏大师', kind: 'cli', provider: 'claude-local', invitedBy: 'human', childSessionId: 'child-gm' as never },
    { id: 'model', name: '人物建模大师', kind: 'cli', provider: 'kimi-cli', invitedBy: 'human', childSessionId: 'child-model' as never },
    { id: 'play', name: '游戏玩法大师', kind: 'cli', provider: 'codex-local', invitedBy: 'human', childSessionId: 'child-play' as never },
  ],
  relays: [], tasks: [], runs: [],
  executions: [
    { id: 'gm-1', memberId: 'gm', member: '游戏大师', state: 'done', startedAt: 1, elapsedMs: 6_122_000, tokens: 42_500_000, model: 'claude-opus-5-5', usage: { inputTokens: 1_400_000, cacheReadTokens: 40_948_000, outputTokens: 152_000 } },
    { id: 'model-1', memberId: 'model', member: '人物建模大师', state: 'done', startedAt: 1, elapsedMs: 23_799_000, tokens: 148_000_000, model: 'k3.1-pro', usage: { inputTokens: 2_850_000, cacheReadTokens: 145_000_000, outputTokens: 150_000 } },
    { id: 'play-1', memberId: 'play', member: '游戏玩法大师', state: 'done', startedAt: 1, elapsedMs: 3_243_000, tokens: 6_600_000, model: 'gpt-6.1-sol', usage: { inputTokens: 600_000, cacheReadTokens: 5_937_700, outputTokens: 62_300 } },
  ],
}

function MemberToolsPreview() {
  return <main style={{ padding: '360px 16px 40px' }}>
    <div data-testid="chat-column" style={{ width: Number(params.get('width') ?? 780), maxWidth: '100%', margin: '0 auto', '--dsh-chat-content-width': '100%' } as React.CSSProperties}>
      <div style={{ minHeight: 96, padding: 16, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 22, background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-tertiary)' }}>
        跟 kimi-canvas 对话；@ 指定其他成员
      </div>
      <RoomStatsLine
        useProjection={(() => undefined) as never}
        state={statsRoom}
        t={t}
        renderMemberTools={(_session, placement) => {
          if (placement === 'meter') return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}><span style={{ width: 10, height: 10, border: '2px solid currentColor', borderRadius: '50%' }} />62%</span>
          if (placement === 'row') return <button type="button" aria-label="压缩" style={{ width: 24, height: 24, padding: 0, border: '1px solid currentColor', borderRadius: '50%', background: 'transparent', color: 'var(--dsw-alias-label-warning)' }}>!</button>
          return null
        }}
      />
    </div>
  </main>
}

const SUMMARY = [
  '当前重要创作约束：',
  '- 年份统一为 2096 年；跨梦域使用不同职业外壳，外壳不赋予额外神通。',
  '- 梦域必须令人向往：自由创造、选择形态、发展兴趣、维持关系。',
  '- 用户重视自然口语、清楚的新概念首次出现方式、具体动作和感官细节。',
  '- AI 叙述者可以讽刺与误解，但人物情感场景不要嘲弄。',
  '- 已归档的旧命名事故与旧断环伏笔不应因阅读旧章节而恢复。',
  '工具与流程：',
  '- 后续写作遵循：登记计划 → 用户明确确认 → 写正文 → 对账。',
  '- 改稿后需要重新对账；不要让旧计划覆盖用户已经认可的新正文。',
  '- 对账产生的重复时间轴卡已多次归档，注意不要重复建卡。',
  'TODO List',
  '[done] 按新版计划重写第一章',
  '[done] 对账第一章并同步时间轴',
  '[pending] 将剩余创作约束带入下一次写作',
].join('\n\n')

function CompactionPreview() {
  return <main style={{ width: Number(params.get('width') ?? 780), maxWidth: '100%', margin: '0 auto', padding: '40px 16px' }}>
    <RoomCompactionView {...{
      node: { data: { seq: 1, time: 1, member: 'kimi-canvas', outcome: 'completed', beforeTokens: 560_000, afterTokens: 41_000, summary: SUMMARY } },
      t,
    } as never} />
  </main>
}

const view = params.get('view')
createRoot(document.getElementById('root')!).render(view === 'stats' ? <MemberToolsPreview /> : view === 'compaction' ? <CompactionPreview /> : <Preview />)
