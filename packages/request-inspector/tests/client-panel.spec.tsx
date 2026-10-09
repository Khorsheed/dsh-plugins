// @vitest-environment jsdom
/**
 * The 请求明细 tab body under composed-props fakes: the mount → listTurns →
 * getTurn → getRequest render chain (turn switcher defaulting to the latest
 * turn, navigation-params turn selection, scope chips incl. the failed-run
 * page, the token tab's cards + four-segment detail + legend filter, the
 * timing tab's buckets/timeline/call-row click-through, the raw view, the
 * disabled wire-body seat, and the empty states).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  AgentScopeOverview, BackfillInfo, CapturedRequest, ListTurnsResult, TurnListItem, TurnOverview, TurnTiming,
} from '../src/types.ts'
import type { InspectorTabProps } from '../src/client/contract.ts'
import type { RequestInspectorTabParams } from '../src/client/definition.tsx'
import { InspectorPanel } from '../src/client/InspectorPanel.tsx'
import { zh } from '../src/client/locales.ts'

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

/** A plain translate over the zh dictionary (the key-set source of truth). */
const t = ((key: keyof typeof zh, params?: Record<string, string>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)) as InspectorTabProps['t']

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
  config: { provider: 'deepseek', model: 'deepseek-chat', maxTokens: 131_072 },
  usage: { inputTokens: 2_000, outputTokens: 100, cacheReadTokens: 8_000 },
  timing: { waitMs: 400, reasoningMs: 1_000, textMs: 800, totalMs: 4_200 },
  responseSummary: { kind: 'tool', name: 'read', hint: 'a.ts' },
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
  config: {},
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
  config: { provider: 'deepseek', model: 'deepseek-chat', maxTokens: 131_072 },
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

interface BenchOptions {
  readonly turns?: TurnListItem[] | undefined
  readonly backfill?: BackfillInfo | undefined
  readonly listError?: boolean | undefined
  readonly params?: RequestInspectorTabParams | undefined
  readonly revision?: number | undefined
}

function bench(opts: BenchOptions = {}) {
  const mocks = {
    listTurns: vi.fn(async (): Promise<Result<ListTurnsResult>> => opts.listError === true
      ? { ok: false, error: { code: 'x', message: 'boom' } }
      : { ok: true, value: { turns: opts.turns ?? TURNS, backfill: opts.backfill ?? { state: 'complete' } } }),
    getTurn: vi.fn(async (_sessionId: string, turnSeq: number): Promise<Result<TurnOverview | undefined>> => ({
      ok: true,
      value: turnSeq === 2 ? OVERVIEW2 : turnSeq === 1 ? OVERVIEW1 : undefined,
    })),
    getRequest: vi.fn(async (_sessionId: string, seq: number): Promise<Result<CapturedRequest | undefined>> => ({
      ok: true,
      value: seq === 101 ? REQ101 : seq === 102 ? REQ102 : seq === 201 ? REQ201 : undefined,
    })),
    getTurnTiming: vi.fn(async (): Promise<Result<TurnTiming | undefined>> => ({ ok: true, value: TIMING2 })),
  }
  // The signal is per tab occurrence — one controller per bench, never per render.
  const signal = new AbortController().signal
  const props = {
    sessionId: 's1',
    useTabInfo: () => ({
      sidebar: { expanded: true, fullscreen: false },
      panel: { id: 'p1' },
      tab: {
        navigation: { address: 'dsh-page://request-inspector', params: opts.params, revision: opts.revision ?? 0 },
        signal,
      },
    }),
    t,
    ...mocks,
  } as unknown as InspectorTabProps
  const { container } = render(<InspectorPanel {...props} />)
  return { mocks, container }
}

/** Expand a segment block / row by its summary text. */
function openDetails(name: string | RegExp): void {
  const summary = screen.getByText(name).closest('summary')
  if (summary === null) throw new Error(`summary not found: ${String(name)}`)
  fireEvent.click(summary)
}

afterEach(() => {
  cleanup()
})

describe('InspectorPanel · token tab', () => {
  it('mounts at the latest turn: query line, scope chips, request cards, the selected request detail', async () => {
    bench()
    await waitFor(() => expect(screen.getByText('#101 · read:a.ts')).toBeTruthy())
    // The query line and the turn switcher default to turn 2 (the latest).
    expect(screen.getByText('第二条 query')).toBeTruthy()
    expect((screen.getByRole('combobox', { name: zh['turn.switch'] }) as HTMLSelectElement).value).toBe('2')
    // Scope chips: 主对话 + one per delegation run (never merged), anchored by
    // the per-session scope ordinal — the failed 0-request run gets its #N too.
    expect(screen.getByRole('button', { name: /主对话 · 2 请求/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /#2 提取 JSON/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /#3 失败的提取/ })).toBeTruthy()
    // The detail anchor + the four blocks.
    await waitFor(() => expect(screen.getByText(/本次响应/)).toBeTruthy())
    // The anchor names the response; the selected card's title repeats it.
    expect(screen.getAllByText(/read:a\.ts/).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(zh['seg.system'])).toBeTruthy()
    expect(screen.getByText(zh['seg.tools'])).toBeTruthy()
    expect(screen.getByText(zh['seg.history'])).toBeTruthy()
    expect(screen.getByText(zh['seg.added'])).toBeTruthy()
  })

  it('keeps history collapsed and added open; rows expand to verbatim text', async () => {
    bench()
    await waitFor(() => expect(screen.getByText('#101 · read:a.ts')).toBeTruthy())
    // Added is open by default: the tool-result row is visible; history is collapsed.
    expect(screen.getByText('文件内容')).toBeTruthy()
    expect(screen.queryByText('历史用户输入')).toBeNull()
    // Expand 历史上下文 → the user row appears; expanding it shows the full text.
    openDetails(zh['seg.history'])
    await waitFor(() => expect(screen.getByText('历史用户输入')).toBeTruthy())
    openDetails('历史用户输入')
    await waitFor(() => expect(screen.getByText('历史用户输入全文')).toBeTruthy())
  })

  it('unfolds an assistant row into reasoning / text / tool_call sections', async () => {
    bench()
    await waitFor(() => expect(screen.getByText('#101 · read:a.ts')).toBeTruthy())
    openDetails('→ read')
    await waitFor(() => expect(screen.getByText('先想一下')).toBeTruthy())
    expect(screen.getByText('reasoning')).toBeTruthy()
    expect(screen.getByText('读一下文件')).toBeTruthy()
    expect(screen.getByText('tool_call · read')).toBeTruthy()
  })

  it('expands 工具定义 to the compact grid of tool cells', async () => {
    bench()
    await waitFor(() => expect(screen.getByText('#101 · read:a.ts')).toBeTruthy())
    // The tools block is collapsed: 'write' appears only in a tool cell.
    expect(screen.queryByText('write')).toBeNull()
    openDetails(zh['seg.tools'])
    await waitFor(() => expect(screen.getByText('write')).toBeTruthy())
    expect(screen.getAllByText('read').length).toBeGreaterThanOrEqual(2)
  })

  it('filters the detail rows by a legend category and clears back', async () => {
    bench()
    await waitFor(() => expect(screen.getByText('#101 · read:a.ts')).toBeTruthy())
    openDetails(zh['seg.history'])
    await waitFor(() => expect(screen.getByText('历史用户输入')).toBeTruthy())
    // Click the 用户消息 legend entry → only user rows stay in history/added.
    fireEvent.click(screen.getByRole('button', { name: new RegExp(zh['cat.user']) }))
    await waitFor(() => expect(screen.getByText(/已筛选/)).toBeTruthy())
    expect(screen.queryByText('文件内容')).toBeNull()
    expect(screen.getByText('历史用户输入')).toBeTruthy()
    // The ✕ clears the filter.
    fireEvent.click(screen.getByRole('button', { name: '✕' }))
    await waitFor(() => expect(screen.getByText('文件内容')).toBeTruthy())
  })

  it('switches the selected request from the card list', async () => {
    bench()
    await waitFor(() => expect(screen.getByText('#101 · read:a.ts')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /#102 · 直接回答/ }))
    await waitFor(() => expect(screen.getByText(/请求 #102 · 组成分类/)).toBeTruthy())
  })
})

describe('InspectorPanel · turn switcher / navigation params', () => {
  it('switches turns from the select', async () => {
    bench()
    await waitFor(() => expect(screen.getByText('第二条 query')).toBeTruthy())
    fireEvent.change(screen.getByRole('combobox', { name: zh['turn.switch'] }), { target: { value: '1' } })
    await waitFor(() => expect(screen.getByText('#11 · 直接回答')).toBeTruthy())
    expect(screen.getByText('第一条 query')).toBeTruthy()
  })

  it('applies navigation params on the first revision (the turn action entry)', async () => {
    bench({ params: { turnSeq: 1 }, revision: 1 })
    await waitFor(() => expect(screen.getByText('#11 · 直接回答')).toBeTruthy())
    expect((screen.getByRole('combobox', { name: zh['turn.switch'] }) as HTMLSelectElement).value).toBe('1')
  })
})

describe('InspectorPanel · scope chips', () => {
  it('shows the failure state page for a failed run with 0 requests', async () => {
    bench()
    await waitFor(() => expect(screen.getByRole('button', { name: /失败的提取/ })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /失败的提取/ }))
    await waitFor(() => expect(screen.getByText(zh['run.failed'])).toBeTruthy())
    expect(screen.getByText('provider timeout')).toBeTruthy()
    expect(screen.getByText(/0 次模型调用/)).toBeTruthy()
  })

  it('switches to a delegation run and renders its (honestly empty) system/tools', async () => {
    bench()
    await waitFor(() => expect(screen.getByRole('button', { name: /#2 提取 JSON/ })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /#2 提取 JSON/ }))
    await waitFor(() => expect(screen.getByText('#201 · 直接回答')).toBeTruthy())
    // The child-lane scope has no captured system/tools: the blocks render the empty states.
    openDetails(zh['seg.system'])
    await waitFor(() => expect(screen.getByText(zh['seg.systemEmpty'])).toBeTruthy())
    openDetails(zh['seg.tools'])
    await waitFor(() => expect(screen.getByText(zh['seg.toolsEmpty'])).toBeTruthy())
  })
})

describe('InspectorPanel · timing tab', () => {
  it('renders the whole-turn buckets, the per-tool breakdown and the call rows', async () => {
    const { container } = bench()
    await waitFor(() => expect(screen.getByText('#101 · read:a.ts')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: zh['view.time'] }))
    await waitFor(() => expect(screen.getByText(zh['time.byTool'])).toBeTruthy())
    expect(screen.getByText(zh['time.total'])).toBeTruthy()
    // The legend and the call-row chips share the bucket vocabulary.
    expect(screen.getAllByText(zh['time.bucket.wait']).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(zh['time.bucket.other']).length).toBeGreaterThanOrEqual(1)
    // The per-tool row.
    expect(screen.getByText('read')).toBeTruthy()
    // Three call rows (the whole turn), each clicking through to the token tab.
    const callRows = container.querySelectorAll('[class*="callRow"]')
    expect(callRows).toHaveLength(3)
    const sub = [...callRows].find(row => row.textContent?.includes('#201'))
    if (sub === undefined) throw new Error('call row for #201 missing')
    fireEvent.click(sub)
    // …landing on the token tab with the run's scope selected and #201 in detail.
    await waitFor(() => expect(screen.getByText('#201 · 直接回答')).toBeTruthy())
    expect(screen.getByRole('button', { name: zh['view.token'] }).getAttribute('aria-pressed')).toBe('true')
  })

  it('filters the timing view to the selected delegation run', async () => {
    const { container } = bench()
    await waitFor(() => expect(screen.getByText('#101 · read:a.ts')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /#2 提取 JSON/ }))
    fireEvent.click(screen.getByRole('button', { name: zh['view.time'] }))
    await waitFor(() => expect(screen.getByText(zh['time.totalScope'])).toBeTruthy())
    // Only the run's own call row remains.
    const callRows = container.querySelectorAll('[class*="callRow"]')
    expect(callRows).toHaveLength(1)
    expect(callRows[0]?.textContent).toContain('#201')
  })
})

describe('InspectorPanel · raw view and the wire-body seat', () => {
  it('serializes the selected request as 原始 JSON; wire body stays disabled with its hint', async () => {
    bench()
    await waitFor(() => expect(screen.getByText('#101 · read:a.ts')).toBeTruthy())
    const wire = screen.getByRole('button', { name: /wire body/ }) as HTMLButtonElement
    expect(wire.disabled).toBe(true)
    expect(wire.title).toBe(zh['view.wireHint'])
    fireEvent.click(screen.getByRole('button', { name: zh['view.raw'] }))
    await waitFor(() => expect(screen.getByText(/"seq": 101/)).toBeTruthy())
    expect(screen.getByText(/CapturedRequest/)).toBeTruthy()
  })
})

describe('InspectorPanel · empty and error states', () => {
  it('reports a session without captured turns', async () => {
    bench({ turns: [] })
    await waitFor(() => expect(screen.getByText(zh['state.noTurns'])).toBeTruthy())
  })

  it('distinguishes an unreadable log from a genuinely empty session', async () => {
    bench({ turns: [], backfill: { state: 'broken', reason: 'unknown event type "future/event"' } })
    await waitFor(() => expect(screen.getByText(/日志不可读/)).toBeTruthy())
    expect(screen.getByText(/future\/event/)).toBeTruthy()
    expect(screen.queryByText(zh['state.noTurns'])).toBeNull()
  })

  it('notes a budget-truncated history in the footer', async () => {
    bench({ backfill: { state: 'partial' } })
    await waitFor(() => expect(screen.getByText('#101 · read:a.ts')).toBeTruthy())
    expect(screen.getByText(zh['hint.backfillTruncated'])).toBeTruthy()
  })

  it('reports a listTurns failure', async () => {
    bench({ listError: true })
    await waitFor(() => expect(screen.getByText(/boom/)).toBeTruthy())
  })

  it('reports a turn whose capture left the buffer', async () => {
    // Turn 3 is in the list but getTurn returns undefined (evicted between reads).
    const evicted: TurnListItem = {
      sessionId: 's1', turnSeq: 3, query: '被淘汰的 turn', startedAt: 10_000,
      requestCount: 1, scopeCount: 1, failedScopeCount: 0, totalInputTokens: 1, totalOutputTokens: 1,
    }
    bench({ turns: [...TURNS, evicted], params: { turnSeq: 3 }, revision: 1 })
    await waitFor(() => expect(screen.getByText(zh['state.turnMissing'])).toBeTruthy())
  })
})
