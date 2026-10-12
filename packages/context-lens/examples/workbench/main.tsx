/** Synthetic fixtures only. Run pnpm exec tsx packages/context-lens/examples/workbench/serve.mts. */
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import type { AgentScopeOverview, CapturedRequest, TurnListItem, TurnOverview, TurnTiming } from '../../src/types.ts'
import type { InspectorTabProps } from '../../src/client/contract.ts'
import { InspectorPanel } from '../../src/client/InspectorPanel.tsx'
import { prefixTextChange } from '../../src/prefix-diff.ts'
import { zh } from '../../src/client/locales.ts'
import './preview.css'
const t = ((key: keyof typeof zh, params?: Record<string, string>) => zh[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)) as InspectorTabProps['t']
const TURNS: TurnListItem[] = [
  {
    sessionId: 's1', turnSeq: 1, hostTurn: 1, query: '第一条 query', startedAt: 1_000, endedAt: 2_000,
    requestCount: 1, scopeCount: 1, failedScopeCount: 0,
    totalInputTokens: 1_000, totalOutputTokens: 50, closingMessageId: 'm-1',
  },
  {
    sessionId: 's1', turnSeq: 2, hostTurn: 2, query: '第二条 query', startedAt: 3_000, endedAt: 9_000,
    requestCount: 3, scopeCount: 3, failedScopeCount: 1,
    totalInputTokens: 5_000, totalOutputTokens: 300, closingMessageId: 'm-2',
  },
]

const REQ101: CapturedRequest = {
  seq: 101,
  scopeId: 'main',
  sessionId: 's1',
  startedAt: 3_100,
  status: 'ok',
  config: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high', maxTokens: 131_072, temperature: 0.6 },
  usage: { inputTokens: 2_000, outputTokens: 100, cacheReadTokens: 8_000 },
  timing: { waitMs: 400, reasoningMs: 1_000, textMs: 800, totalMs: 4_200 },
  responseSummary: { kind: 'tool', name: 'read', hint: 'a.ts' },
  response: {
    reasoning: '本轮先把第二章结尾读进来，确认接续位置。',
    text: '好的，先读第二章结尾。',
    toolCalls: [{ name: 'read', arguments: '{"path":"a.ts"}' }],
  },
  segments: {
    system: [
      { index: 0, category: 'system', source: 'identity', preview: '你是…', full: '你是 Kimi，一个助手。', chars: 12, freshness: 'history' },
    ],
    tools: [
      { name: 'read', description: '读文件', parameters: '{\n "path": "string"\n}', chars: 40, added: false },
      { name: 'write', description: '写文件', parameters: '{}', chars: 60, added: true },
    ],
    history: [
      { index: 1, category: 'user', source: 'user', preview: '历史用户输入', full: '历史用户输入全文', chars: 8, freshness: 'history' },
    ],
    added: [
      {
        index: 2, category: 'assistant', source: 'model', toolCalls: ['read'], preview: '→ read',
        full: JSON.stringify({ reasoning: '先想一下', text: '读一下文件', calls: [{ id: 'c1', name: 'read', arguments: '{"path":"a.ts"}' }] }),
        chars: 70, durationMs: 900, freshness: 'new',
      },
      { index: 3, category: 'tool-result', source: 'read', preview: '文件内容', full: '文件内容全文', chars: 6, freshness: 'new' },
    ],
  },
}

const REQ102: CapturedRequest = {
  ...REQ101,
  seq: 102,
  config: { provider: 'example', model: 'second-model', reasoningEffort: 'low', maxTokens: 16_384 },
  startedAt: 8_000,
  usage: { inputTokens: 500, outputTokens: 200, cacheReadTokens: 9_500 },
  timing: { waitMs: 300, textMs: 1_500, totalMs: 2_000 },
  responseSummary: { kind: 'text' },
  segments: { ...REQ101.segments },
}

const REQ201: CapturedRequest = {
  ...REQ101,
  seq: 201,
  scopeId: 'child-1',
  config: { provider: 'example', model: 'child-model', reasoningEffort: 'medium', maxTokens: 8_192 },
  startedAt: 5_000,
  usage: { inputTokens: 100, outputTokens: 20 },
  timing: { waitMs: 100, textMs: 200, totalMs: 400 },
  responseSummary: { kind: 'text' },
  segments: { system: [], tools: [], history: [], added: REQ101.segments.added },
}

const scope = (over: Partial<AgentScopeOverview>): AgentScopeOverview => ({
  scopeId: 'main',
  scopeSeq: 1,
  kind: 'main',
  status: 'ok',
  config: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high', maxTokens: 131_072, temperature: 0.6 },
  startedAt: 3_000,
  endedAt: 9_000,
  requests: [],
  ...over,
})

const OVERVIEW2: TurnOverview = {
  turn: TURNS[1] as TurnListItem,
  scopes: [
    scope({
      scopeId: 'main',
      requests: [
        { seq: 101, scopeId: 'main', status: 'ok', responseSummary: { kind: 'tool', name: 'read', hint: 'a.ts' }, startedAt: 3_100, usage: REQ101.usage, totalMs: 4_200, totalChars: 126 },
        { seq: 102, scopeId: 'main', status: 'ok', responseSummary: { kind: 'text' }, startedAt: 8_000, usage: REQ102.usage, totalMs: 2_000, totalChars: 130 },
      ],
    }),
    scope({
      scopeId: 'child-1', scopeSeq: 2, kind: 'subagent', label: '提取 JSON', startedAt: 5_000, endedAt: 5_400,
      requests: [
        { seq: 201, scopeId: 'child-1', status: 'ok', responseSummary: { kind: 'text' }, startedAt: 5_000, usage: REQ201.usage, totalMs: 400, totalChars: 76 },
      ],
    }),
    scope({
      scopeId: 'child-2', scopeSeq: 3, kind: 'subagent', label: '失败的提取', status: 'failed',
      error: 'provider timeout', startedAt: 6_000, endedAt: 7_500, requests: [],
    }),
  ],
}

const OVERVIEW1: TurnOverview = {
  turn: TURNS[0] as TurnListItem,
  scopes: [scope({
    requests: [
      { seq: 11, scopeId: 'main', status: 'ok', responseSummary: { kind: 'text' }, startedAt: 1_100, usage: REQ101.usage, totalMs: 900, totalChars: 126 },
    ],
  })],
}

const TIMING2: TurnTiming = {
  turnSeq: 2,
  totalMs: 6_000,
  buckets: { waitMs: 700, reasoningMs: 1_000, toolArgsMs: 300, textMs: 2_500, toolExecMs: 700, otherMs: 1_900 },
  lanes: [
    { kind: 'wait', requestSeq: 101, scopeId: 'main', startedAt: 3_100, durationMs: 400 },
    { kind: 'reasoning', requestSeq: 101, scopeId: 'main', startedAt: 3_500, durationMs: 1_000 },
    { kind: 'tool-args', requestSeq: 101, scopeId: 'main', startedAt: 4_500, durationMs: 300, tool: 'read' },
    { kind: 'text', requestSeq: 101, scopeId: 'main', startedAt: 4_800, durationMs: 300 },
    { kind: 'tool-exec', requestSeq: 101, scopeId: 'main', startedAt: 5_100, durationMs: 700, tool: 'read' },
    { kind: 'wait', requestSeq: 201, scopeId: 'child-1', startedAt: 5_000, durationMs: 100 },
    { kind: 'text', requestSeq: 201, scopeId: 'child-1', startedAt: 5_100, durationMs: 200 },
    { kind: 'wait', requestSeq: 102, scopeId: 'main', startedAt: 8_000, durationMs: 200 },
    { kind: 'text', requestSeq: 102, scopeId: 'main', startedAt: 8_200, durationMs: 1_500 },
  ],
  tools: [{ tool: 'read', calls: 1, totalMs: 700, argsMs: 300 }],
}


const repeat = '工具执行失败：目标内容已变更，请先重新读取文件，再使用当前内容重试这次编辑。此消息用于重复筛选的合成验收。'
REQ101.segments.history = Array.from({ length: 24 }, (_, i) => {
  const full = i % 6 === 0 ? repeat : `第 ${i + 1} 条历史消息。` + '这是用于界面验收的合成上下文。'.repeat(i % 5 * 5 + 1)
  return { index: i + 1, category: i % 6 === 0 ? 'tool-result' : i % 2 === 0 ? 'user' : 'assistant', source: 'synthetic', full, preview: full.slice(0,80), chars: full.length, freshness: 'history' }
})
REQ101.response = {
  reasoning: '检查输入与输出是否保持清楚的层次。长思考内容默认显示两行，展开以后可以独立滚动。'.repeat(12),
  text: '这段内容可以更直接一些。我会保留叙事顺序，调整其中的描述。',
  toolCalls: [{ name: 'edit', arguments: JSON.stringify({ file_path: '/home/user/project/chapter.md', new_string: '调整后的内容，使用直接的表达。'.repeat(20), old_string: '原来的内容。'.repeat(30) }) }],
}
const priorSystem = 'You are an AI agent powered by DeepSeek Harness. You are a coding agent powered by the current model.'
const currentSystem = 'You are an AI agent powered by DeepSeek Harness.'
REQ101.segments.system = [{ index: 0, category: 'system', source: 'identity', preview: currentSystem, full: currentSystem, chars: currentSystem.length, freshness: 'history' }]
REQ101.prefix = { previousSeq: 11, gapMs: 0, toolsChanged: false, changed: { index: 0, before: priorSystem, after: currentSystem, beforeCategory: 'system', afterCategory: 'system', text: prefixTextChange(priorSystem, currentSystem) } }
for (const s of OVERVIEW2.scopes) for (const r of s.requests) r.config = r.seq === 101 ? REQ101.config : r.seq === 102 ? REQ102.config : REQ201.config

const previousAssistant = { text: '前一段已改完。下一步检查第二章里表达含混的句子，保留人物当时能够观察到的事实。', calls: [] }
REQ101.segments.added = [
  { index: 25, category: 'assistant', source: 'model', full: JSON.stringify(previousAssistant), preview: previousAssistant.text, chars: JSON.stringify(previousAssistant).length, freshness: 'new' },
  { index: 26, category: 'user', source: 'user', full: '继续看下一段，删掉抽象的判断，改成具体动作。', preview: '继续看下一段，删掉抽象的判断，改成具体动作。', chars: 25, freshness: 'new' },
]
REQ102.segments = { ...REQ101.segments }
const signal = new AbortController().signal
const success = <T,>(value: T) => Promise.resolve({ ok: true as const, value })
const props = {
  sessionId: 's1', t,
  useTabInfo: () => ({ sidebar: { expanded: true, fullscreen: false }, panel: { id: 'demo' }, tab: { navigation: { address: 'dsh-page://context-lens', revision: 0 }, signal } }),
  listTurns: () => success({ turns: TURNS, backfill: { state: 'partial' } }),
  getTurn: (_: string, turn: number) => success(turn === 2 ? OVERVIEW2 : OVERVIEW1),
  getRequest: (_: string, seq: number) => success(seq === 101 ? REQ101 : seq === 102 ? REQ102 : seq === 201 ? REQ201 : { ...REQ101, seq: 11, prefix: undefined }),
  getTurnTiming: () => success(TIMING2),
  getSessionTrend: () => success({ turns: TURNS, backfill: { state: 'complete' }, requests: [...OVERVIEW1.scopes.flatMap(s => s.requests.map(r => ({ ...r, turnSeq: 1 }))), ...OVERVIEW2.scopes.flatMap(s => s.requests.map(r => ({ ...r, turnSeq: 2 })))] }),
} as unknown as InspectorTabProps
function Preview() {
  const [dark, setDark] = useState(false)
  const [narrow, setNarrow] = useState(false)
  return <main data-theme={dark ? 'dark' : 'light'}><header className="preview-controls"><span>合成数据预览</span><button onClick={() => setDark(v => !v)}>深浅主题</button><button onClick={() => setNarrow(v => !v)}>宽窄面板</button></header><div className="preview-panel" style={{ width: narrow ? '390px' : '100%' }}><InspectorPanel {...props} /></div></main>
}
createRoot(document.getElementById('app')!).render(<Preview />)
