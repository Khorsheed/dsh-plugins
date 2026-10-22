// @vitest-environment jsdom
/**
 * The 请求明细 tab body under composed-props fakes: the mount → listTurns →
 * getTurn → getRequest render chain (turn switcher defaulting to the latest
 * turn, navigation-params turn selection, scope chips incl. the failed-run
 * page, the token tab's cards + four-segment detail + legend filter, the
 * timing tab's buckets/timeline/call-row click-through, the raw view, the
 * request-local JSON toggle, and the empty states).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  seq: 101, requestNumber: 101,
  scopeId: 'main',
  sessionId: 's1',
  startedAt: 3_100,
  status: 'ok',
  config: { provider: 'deepseek', model: 'deepseek-chat', maxTokens: 131_072 },
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
  seq: 102, requestNumber: 102,
  startedAt: 8_000,
  usage: { inputTokens: 500, outputTokens: 200, cacheReadTokens: 9_500 },
  timing: { waitMs: 300, textMs: 1_500, totalMs: 2_000 },
  responseSummary: { kind: 'text' },
  segments: { ...REQ101.segments },
}

const REQ201: CapturedRequest = {
  ...REQ101,
  seq: 201, requestNumber: 201,
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
        { seq: 101, requestNumber: 101, scopeId: 'main', status: 'ok', responseSummary: { kind: 'tool', name: 'read', hint: 'a.ts' }, startedAt: 3_100, usage: REQ101.usage, totalMs: 4_200, totalChars: 126 },
        { seq: 102, requestNumber: 102, scopeId: 'main', status: 'ok', responseSummary: { kind: 'text' }, startedAt: 8_000, usage: REQ102.usage, totalMs: 2_000, totalChars: 130 },
      ],
    }),
    scope({
      scopeId: 'child-1', scopeSeq: 2, kind: 'subagent', label: '提取 JSON', startedAt: 5_000, endedAt: 5_400,
      requests: [
        { seq: 201, requestNumber: 201, scopeId: 'child-1', status: 'ok', responseSummary: { kind: 'text' }, startedAt: 5_000, usage: REQ201.usage, totalMs: 400, totalChars: 76 },
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
      { seq: 11, requestNumber: 11, scopeId: 'main', status: 'ok', responseSummary: { kind: 'text' }, startedAt: 1_100, usage: REQ101.usage, totalMs: 900, totalChars: 126 },
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
  /** Fail the FIRST listTurns call this way, succeed after (retry coverage). */
  readonly listFailFirst?: 'refusal' | 'reject' | undefined
  readonly params?: RequestInspectorTabParams | undefined
  readonly revision?: number | undefined
  /** Per-test getTurn override (replaces the turnSeq 1/2 routing). */
  readonly overview?: ((turnSeq: number) => TurnOverview | undefined) | undefined
  /** Per-test getRequest override (merged over the fixture routing). */
  readonly requests?: Record<number, CapturedRequest> | undefined
  /** The log's host-turn range (turns outside the list are not loaded). */
  readonly range?: { first: number; last: number } | undefined
}

function bench(opts: BenchOptions = {}) {
  let listAttempts = 0
  const mocks = {
    getSessionTrend: vi.fn(async () => ({ ok: true, value: { turns: opts.turns ?? TURNS, backfill: { state: 'complete' }, requests: [...OVERVIEW1.scopes.flatMap(scope => scope.requests.map(request => ({ ...request, turnSeq: 1 }))), ...OVERVIEW2.scopes.flatMap(scope => scope.requests.map(request => ({ ...request, turnSeq: 2 })))] } })),
    listTurns: vi.fn(async (): Promise<Result<ListTurnsResult>> => {
      const attempt = listAttempts
      listAttempts += 1
      if (opts.listError !== true && opts.listFailFirst === 'reject' && attempt === 0) {
        // The gateway runtime's exact-arity gate rejects before any network traffic.
        throw new Error('client api: requestInspector/listTurns expected 2 argument(s), got 1')
      }
      if (opts.listError === true || (opts.listFailFirst !== undefined && attempt === 0)) {
        return { ok: false, error: { code: 'x', message: 'boom' } }
      }
      return { ok: true, value: { turns: opts.turns ?? TURNS, backfill: opts.backfill ?? { state: 'complete' }, ...opts.range === undefined ? {} : { range: opts.range } } }
    }),
    loadTurns: vi.fn(async (): Promise<Result<ListTurnsResult>> => ({ ok: true, value: { turns: opts.turns ?? TURNS, backfill: { state: 'complete' }, ...opts.range === undefined ? {} : { range: opts.range } } })),
    getTurn: vi.fn(async (_sessionId: string, turnSeq: number): Promise<Result<TurnOverview | undefined>> => ({
      ok: true,
      value: opts.overview !== undefined
        ? opts.overview(turnSeq)
        : turnSeq === 2 ? OVERVIEW2 : turnSeq === 1 ? OVERVIEW1 : undefined,
    })),
    getRequest: vi.fn(async (_sessionId: string, seq: number): Promise<Result<CapturedRequest | undefined>> => ({
      ok: true,
      value: opts.requests?.[seq] ?? (seq === 101 ? REQ101 : seq === 102 ? REQ102 : seq === 201 ? REQ201 : seq === 11 ? { ...REQ101, seq: 11, requestNumber: 11, responseSummary: { kind: 'text' } } : undefined),
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
        navigation: { address: 'dsh-page://context-lens', params: opts.params, revision: opts.revision ?? 0 },
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
    const trigger = screen.getByRole('button', { name: zh['turn.switch'] })
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.textContent).toContain('2 / 2')
    expect(screen.getByText('第二条 query')).toBeTruthy()
    // Scope chips: 主对话 + one per delegation run (never merged), anchored by
    // the per-session scope ordinal — the failed 0-request run gets its #N too.
    expect(screen.getByRole('tab', { name: /主对话\s*2/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /提取 JSON/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /失败的提取/ })).toBeTruthy()
    // The detail anchor + the four blocks.
    expect(screen.getByRole('region', { name: zh['lens.exchange'] })).toBeTruthy()
    // The anchor names the response; the selected card's title repeats it.
    expect(screen.getByRole('button', { name: '#101 · read:a.ts' })).toBeTruthy()
    expect(screen.getByText(zh['lens.layerSystem'])).toBeTruthy()
    expect(screen.getByText(zh['lens.layerTools'])).toBeTruthy()
    expect(screen.getByText(zh['lens.layerHistory'])).toBeTruthy()
    expect(screen.getAllByText(new RegExp(zh['lens.layerAdded'])).length).toBeGreaterThan(0)
  })

  it('keeps history collapsed and added open; rows expand to verbatim text', async () => {
    bench()
    await waitFor(() => expect(screen.getByText('#101 · read:a.ts')).toBeTruthy())
    // Added is open by default: the tool-result row is visible; history is collapsed.
    await waitFor(() => expect(screen.getByText('文件内容')).toBeTruthy())
    expect(screen.queryByText('历史用户输入')).toBeNull()
    // Expand 历史上下文 → the user row appears; expanding it shows the full text.
    openDetails(zh['lens.layerHistory'])
    await waitFor(() => expect(screen.getByText('历史用户输入')).toBeTruthy())
    openDetails('历史用户输入')
    await waitFor(() => expect(screen.getByText('历史用户输入全文')).toBeTruthy())
  })

  it('unfolds an assistant row into reasoning / text / tool_call sections', async () => {
    bench()
    await waitFor(() => expect(screen.getByText('#101 · read:a.ts')).toBeTruthy())
    const row = screen.getByText('→ read').closest('details')
    if (row === null) throw new Error('assistant row not found')
    openDetails('→ read')
    // The 输出 block renders its own reasoning/text/tool_call labels — scope to the row.
    await waitFor(() => expect(within(row).getByText('先想一下')).toBeTruthy())
    expect(within(row).getByText('reasoning')).toBeTruthy()
    expect(within(row).getByText('读一下文件')).toBeTruthy()
    expect(within(row).getByText('tool_call · read')).toBeTruthy()
  })

  it('expands 工具定义 to the compact grid of tool cells', async () => {
    bench()
    await waitFor(() => expect(screen.getByText('#101 · read:a.ts')).toBeTruthy())
    // The tools block is collapsed: 'write' appears only in a tool cell.
    expect(screen.queryByText('write')).toBeNull()
    openDetails(zh['lens.layerTools'])
    await waitFor(() => expect(screen.getByText('write')).toBeTruthy())
    expect(screen.getAllByText('read').length).toBeGreaterThanOrEqual(2)
  })

  it('filters the detail rows by a legend category and clears back', async () => {
    bench()
    await waitFor(() => expect(screen.getByText('#101 · read:a.ts')).toBeTruthy())
    openDetails(zh['lens.layerHistory'])
    await waitFor(() => expect(screen.getByText('历史用户输入')).toBeTruthy())
    // Click the 用户消息 legend entry → only user rows stay in history/added.
    fireEvent.click(screen.getByRole('button', { name: new RegExp(zh['cat.user']) }))
    expect(screen.getByRole('button', { name: new RegExp(zh['cat.user']) }).getAttribute('aria-pressed')).toBe('true')
    // Exchange is independent of the composition filter.
    expect(within(screen.getByRole('region', { name: zh['lens.exchange'] })).getByText('文件内容全文')).toBeTruthy()
    expect(screen.getByText('历史用户输入')).toBeTruthy()
    // Clicking the same legend entry clears the filter.
    fireEvent.click(screen.getByRole('button', { name: new RegExp(zh['cat.user']) }))
    await waitFor(() => expect(screen.getByText('文件内容')).toBeTruthy())
  })

  it('switches the selected request from the card list', async () => {
    bench()
    await waitFor(() => expect(screen.getByText('#101 · read:a.ts')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /#102 · 助手回复/ }))
    await waitFor(() => expect(screen.getByText('#102 · 助手回复', { selector: 'b' })).toBeTruthy())
  })
})

describe('InspectorPanel · turn switcher / navigation params', () => {
  it('switches turns from the menu', async () => {
    bench()
    await waitFor(() => expect(screen.getByText('第二条 query')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: zh['turn.switch'] }))
    // Newest first; rows carry the request count and token totals.
    const items = screen.getAllByRole('menuitem')
    expect(items[0]?.textContent).toContain('turn 2')
    expect(items[1]?.textContent).toContain('turn 1')
    expect(items[1]?.textContent).toContain('1 请求')
    expect(items[1]?.textContent).toContain('输入 1.0k')
    expect(items[1]?.textContent).toContain('输出 50')
    fireEvent.click(items[1] as HTMLElement)
    await waitFor(() => expect(screen.getByText('#11 · 助手回复')).toBeTruthy())
    expect(screen.getByText('第一条 query')).toBeTruthy()
    expect(screen.getByRole('button', { name: zh['turn.switch'] }).textContent).toContain('1 / 2')
  })

  it('applies navigation params on the first revision (the turn action entry)', async () => {
    bench({ params: { turnSeq: 1 }, revision: 1 })
    await waitFor(() => expect(screen.getByText('#11 · 助手回复')).toBeTruthy())
    expect(screen.getByRole('button', { name: zh['turn.switch'] }).textContent).toContain('1 / 2')
  })
})

describe('InspectorPanel · scope chips', () => {
  it('shows the failure state page for a failed run with 0 requests', async () => {
    bench()
    await waitFor(() => expect(screen.getByRole('tab', { name: /失败的提取/ })).toBeTruthy())
    fireEvent.click(screen.getByRole('tab', { name: /失败的提取/ }))
    await waitFor(() => expect(screen.getByText(zh['run.failed'])).toBeTruthy())
    expect(screen.getByText('provider timeout')).toBeTruthy()
    expect(screen.getByText(/0 次模型调用/)).toBeTruthy()
  })

  it('switches to a delegation run and renders its (honestly empty) system/tools', async () => {
    bench()
    await waitFor(() => expect(screen.getByRole('tab', { name: /提取 JSON/ })).toBeTruthy())
    fireEvent.click(screen.getByRole('tab', { name: /提取 JSON/ }))
    await waitFor(() => expect(screen.getByText('#201 · 助手回复')).toBeTruthy())
    // The child-lane scope has no captured system/tools: the blocks render the empty states.
    openDetails(zh['lens.layerSystem'])
    await waitFor(() => expect(screen.getByText(zh['seg.systemEmpty'])).toBeTruthy())
    openDetails(zh['lens.layerTools'])
    await waitFor(() => expect(screen.getByText(zh['seg.toolsEmpty'])).toBeTruthy())
  })
})

describe('InspectorPanel · timing tab', () => {
  it('renders the whole-turn buckets, the per-tool breakdown and the call rows', async () => {
    const { container } = bench()
    await waitFor(() => expect(screen.getByText('#101 · read:a.ts')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: zh['view.time'] }))
    await waitFor(() => expect(screen.getByText(new RegExp('^' + zh['lens.toolTime']))).toBeTruthy())
    expect(screen.getByText(zh['time.total'])).toBeTruthy()
    // The legend and the call-row chips share the bucket vocabulary.
    expect(screen.getAllByText(zh['time.bucket.wait']).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(zh['time.bucket.other']).length).toBeGreaterThanOrEqual(1)
    // The per-tool row.
    expect(screen.getByText('read')).toBeTruthy()
    // Every agent remains visible on the timeline, including the child.
    const sub = screen.getByRole('button', { name: '#201 ' + zh['time.bucket.wait'] })
    fireEvent.click(sub)
    // …landing on the token tab with the run's scope selected and #201 in detail.
    await waitFor(() => expect(screen.getByText('#201 · 助手回复')).toBeTruthy())
    expect(screen.getByRole('button', { name: zh['view.token'] }).getAttribute('aria-pressed')).toBe('true')
  })

  it('filters the timing view to the selected delegation run', async () => {
    const { container } = bench()
    await waitFor(() => expect(screen.getByText('#101 · read:a.ts')).toBeTruthy())
    fireEvent.click(screen.getByRole('tab', { name: /提取 JSON/ }))
    fireEvent.click(screen.getByRole('button', { name: zh['view.time'] }))
    await waitFor(() => expect(screen.getByText(zh['time.totalScope'])).toBeTruthy())
    // Non-tool details contain only this run, while the shared timeline keeps all scopes.
    const rows = container.querySelectorAll('[class*="nonRow"]')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.textContent).toContain('#201')
    expect(screen.queryByText('read', { selector: 'td' })).toBeNull()
  })
})

describe('InspectorPanel · request-local JSON view', () => {
  it('keeps navigation and metrics while JSON replaces only the request sections, with no footer', async () => {
    bench()
    await screen.findByText('#101 · read:a.ts')
    expect(screen.queryByRole('button', { name: /wire body/ })).toBeNull()
    expect(screen.queryByRole('button', { name: zh['view.structured'] })).toBeNull()
    const toggle = screen.getByRole('button', { name: zh['view.raw'] })
    fireEvent.click(toggle)
    expect(screen.getByText(/"seq": 101/)).toBeTruthy()
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('navigation', { name: zh['view.token'] })).toBeTruthy()
    expect(screen.getByText('196 字符')).toBeTruthy()
    expect(screen.queryByRole('region', { name: zh['lens.exchange'] })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '#102 · 助手回复' }))
    await screen.findByText(/"seq": 102/)
    fireEvent.click(screen.getByRole('button', { name: zh['view.raw'] }))
    expect(screen.getByRole('region', { name: zh['lens.exchange'] })).toBeTruthy()
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

  it('shows turns the log holds but the panel has not loaded as a cell that loads them', async () => {
    const { mocks } = bench({ range: { first: 1, last: 40 } })
    await waitFor(() => expect(screen.getByText('#101 · read:a.ts')).toBeTruthy())
    const cell = await screen.findByRole('button', { name: '第 3–40 轮未载入 · 载入更新 30 轮' })
    fireEvent.click(cell)
    // A newer run loads the 30 turns starting at its first turn.
    await waitFor(() => expect(mocks.loadTurns).toHaveBeenCalledWith('s1', 32))
    // The switcher counts against the whole log.
    expect(screen.getByRole('button', { name: zh['turn.switch'] }).textContent).toContain('/ 40')
  })

  it('reports a listTurns failure', async () => {
    bench({ listError: true })
    await waitFor(() => expect(screen.getByText(/boom/)).toBeTruthy())
  })

  it('a refused listTurns shows the error with a retry action; the retry refetches and recovers', async () => {
    const { mocks } = bench({ listFailFirst: 'refusal' })
    await waitFor(() => expect(screen.getByText(/boom/)).toBeTruthy())
    // The failure is an explicit error state — never the spinner.
    expect(screen.queryByText(zh['state.loading'])).toBeNull()
    const callsBefore = mocks.listTurns.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: zh['state.retry'] }))
    await waitFor(() => expect(screen.getByText('#101 · read:a.ts')).toBeTruthy())
    expect(mocks.listTurns.mock.calls.length).toBeGreaterThan(callsBefore)
    expect(screen.queryByText(/boom/)).toBeNull()
  })

  it('a call rejected before any network traffic (the arity gate shape) lands in the error state, not loading', async () => {
    const { mocks } = bench({ listFailFirst: 'reject' })
    await waitFor(() => expect(screen.getByText(/expected 2 argument\(s\), got 1/)).toBeTruthy())
    expect(screen.queryByText(zh['state.loading'])).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['state.retry'] }))
    await waitFor(() => expect(screen.getByText('#101 · read:a.ts')).toBeTruthy())
    expect(mocks.listTurns.mock.calls.length).toBeGreaterThanOrEqual(2)
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

describe('InspectorPanel · scroll-sync + 最新', () => {
  const scrollIntoView = vi.fn()
  const scrollTo = vi.fn()
  let port: HTMLElement | null = null

  beforeEach(() => {
    scrollIntoView.mockClear()
    scrollTo.mockClear()
    // jsdom implements neither primitive.
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true })
    Object.defineProperty(Element.prototype, 'scrollTo', { value: scrollTo, configurable: true })
  })

  afterEach(() => {
    port?.remove()
    port = null
  })

  /** Append a fake conversation scrollport with the given host turns. */
  function mountConversation(turns: number[]): void {
    port = document.createElement('div')
    port.setAttribute('data-conversation-scroll', '')
    for (const n of turns) {
      const row = document.createElement('div')
      row.setAttribute('data-chat-turn', String(n))
      port.appendChild(row)
    }
    document.body.appendChild(port)
  }

  it('switching turns scrolls the conversation to that turn anchor', async () => {
    mountConversation([1, 2])
    bench()
    await waitFor(() => expect(screen.getByText('第二条 query')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: zh['turn.switch'] }))
    fireEvent.click(screen.getByRole('menuitem', { name: /turn 1/ }))
    await waitFor(() => expect(screen.getByText('第一条 query')).toBeTruthy())
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    expect(scrollIntoView.mock.instances[0]).toBe(port?.querySelector('[data-chat-turn="1"]'))
  })

  it('opening from the action row scroll-syncs to the navigated turn', async () => {
    mountConversation([1, 2])
    bench({ params: { turnSeq: 1 }, revision: 1 })
    await waitFor(() => expect(screen.getByText('#11 · 助手回复')).toBeTruthy())
    expect(scrollIntoView.mock.instances[0]).toBe(port?.querySelector('[data-chat-turn="1"]'))
  })

  it('no conversation mounted → silent no-op, the panel still switches', async () => {
    bench()
    await waitFor(() => expect(screen.getByText('第二条 query')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: zh['turn.switch'] }))
    fireEvent.click(screen.getByRole('menuitem', { name: /turn 1/ }))
    await waitFor(() => expect(screen.getByText('第一条 query')).toBeTruthy())
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('the 最新 button hides at the latest turn and, from an older turn, jumps and bottoms out', async () => {
    mountConversation([1, 2])
    bench()
    await waitFor(() => expect(screen.getByText('第二条 query')).toBeTruthy())
    expect(screen.queryByRole('button', { name: zh['turn.latest'] })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['turn.switch'] }))
    fireEvent.click(screen.getByRole('menuitem', { name: /turn 1/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: zh['turn.latest'] })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: zh['turn.latest'] }))
    await waitFor(() => expect(screen.getByText('第二条 query')).toBeTruthy())
    expect(scrollTo).toHaveBeenCalledTimes(1)
  })

  it('the 最新 button targets the latest REAL turn, skipping a trailing pseudo-turn', async () => {
    mountConversation([1, 2])
    const pseudo: TurnListItem = {
      sessionId: 's1', turnSeq: -1, query: 'compaction', startedAt: 10_000,
      requestCount: 1, scopeCount: 1, failedScopeCount: 0, totalInputTokens: 10, totalOutputTokens: 5,
    }
    bench({ turns: [...TURNS, pseudo] })
    // The default selection is the pseudo-turn (last in the list) — the button shows.
    await waitFor(() => expect(screen.getByRole('button', { name: zh['turn.latest'] })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: zh['turn.latest'] }))
    await waitFor(() => expect(screen.getByText('第二条 query')).toBeTruthy())
    expect(scrollTo).toHaveBeenCalledTimes(1)
  })
})

describe('InspectorPanel · 输出 section', () => {
  /** A one-scope, one-request turn-2 overview routing to the given capture. */
  function singleBench(detail: CapturedRequest) {
    const item = {
      seq: detail.seq, ...detail.requestNumber === undefined ? {} : { requestNumber: detail.requestNumber }, scopeId: 'main', status: detail.status, responseSummary: detail.responseSummary,
      startedAt: detail.startedAt,
      ...(detail.usage === undefined ? {} : { usage: detail.usage }),
      ...(detail.timing.totalMs === undefined ? {} : { totalMs: detail.timing.totalMs }),
      totalChars: 100,
    }
    const overview: TurnOverview = { turn: TURNS[1] as TurnListItem, scopes: [scope({ requests: [item] })] }
    return bench({ overview: seq => (seq === 2 ? overview : undefined), requests: { [detail.seq]: detail } })
  }

  it('renders the response verbatim — reasoning, text, and one row per tool call — expanded by default', async () => {
    bench()
    await waitFor(() => expect(screen.getByText('#101 · read:a.ts')).toBeTruthy())
    const out = screen.getByRole('region', { name: zh['out.title'] })
    expect(within(out).getByText('100 tok')).toBeTruthy()
    expect(within(out).getByText('本轮先把第二章结尾读进来，确认接续位置。')).toBeTruthy()
    expect(within(out).getByText('好的，先读第二章结尾。')).toBeTruthy()
    expect(within(out).getByText('read')).toBeTruthy()
    const value = within(out).getByRole('button', { name: 'path' })
    expect(value.textContent).toBe('a.ts')
    fireEvent.click(value)
    expect(value.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(value)
    expect(value.getAttribute('aria-expanded')).toBe('false')
  })

  it('shows 进行中 while the response is still streaming', async () => {
    const { usage: _usage, response: _response, ...rest } = REQ101
    singleBench({ ...rest, seq: 109, status: 'streaming' })
    await waitFor(() => expect(screen.getByText(zh['out.streaming'])).toBeTruthy())
  })

  it('shows the error text when the call failed before any block', async () => {
    const { response: _response, ...rest } = REQ101
    singleBench({ ...rest, seq: 110, status: 'failed', error: 'provider timeout' })
    await waitFor(() => expect(screen.getByText('provider timeout')).toBeTruthy())
    // Nothing fabricated in place of the absent response.
    expect(screen.queryByText('本轮先把第二章结尾读进来，确认接续位置。')).toBeNull()
  })

  it('renders the inert header with no body when an ok call has no captured response', async () => {
    const { response: _response, ...rest } = REQ101
    singleBench({ ...rest, seq: 111, status: 'ok' })
    await waitFor(() => expect(screen.getByText(zh['out.title'])).toBeTruthy())
    const block = screen.getByText(zh['out.title']).closest('div')
    if (block === null) throw new Error('输出 header not found')
    expect(block.textContent).toContain('100 tok')
    expect(screen.getByText(zh['lens.noResponse'])).toBeTruthy()
    // Inert: not a <details>, nothing expanded, nothing invented.
    expect(screen.getByText(zh['out.title']).closest('details')).toBeNull()
    expect(screen.queryByText('本轮先把第二章结尾读进来，确认接续位置。')).toBeNull()
  })
})

describe('InspectorPanel · 新增 provenance label', () => {
  it('labels the added assistant rows with the previous request in the same scope (within a turn)', async () => {
    bench()
    await waitFor(() => expect(screen.getByText('#101 · read:a.ts')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /#102 · 助手回复/ }))
    await waitFor(() => expect(screen.getByText('← #101 的响应')).toBeTruthy())
  })

  it('resolves the previous request across turns for a turn’s first request in the scope', async () => {
    bench()
    // Default: turn 2, first main request #101 → previous = turn 1’s last main request (#11).
    await waitFor(() => expect(screen.getByText('← #11 的响应')).toBeTruthy())
  })

  it('labels nothing for the first request ever in a scope', async () => {
    bench()
    await waitFor(() => expect(screen.getByText('#101 · read:a.ts')).toBeTruthy())
    // Turn 1's only main request (#11): no previous turn exists.
    fireEvent.click(screen.getByRole('button', { name: zh['turn.switch'] }))
    fireEvent.click(screen.getByRole('menuitem', { name: /turn 1/ }))
    await waitFor(() => expect(screen.getByText('#11 · 助手回复')).toBeTruthy())
    expect(screen.queryByText(/← #\d+ 的响应/)).toBeNull()
  })
})

describe('Context Lens session trend', () => {
  it('keeps the session map on the main conversation while a participant is selected', async () => {
    bench()
    await screen.findByText('#101 · read:a.ts')
    const mainBars = () => screen.getAllByRole('button', { name: /^turn \d+ #\d+ · / }).map(bar => bar.getAttribute('aria-label'))
    const before = mainBars()
    expect(before).not.toContain('turn 2 #201 · 0%')
    fireEvent.click(screen.getByRole('tab', { name: /提取 JSON/ }))
    await waitFor(() => expect(screen.getByRole('tab', { name: /提取 JSON/ }).getAttribute('aria-selected')).toBe('true'))
    // The map does not switch to the participant; the tabs below do.
    expect(mainBars()).toEqual(before)
    expect(screen.queryByRole('button', { name: 'turn 2 #201 · 0%' })).toBeNull()
  })
})


describe('Context Lens composition filters', () => {
  it('counts only excess copies, exposes every duplicate, and leaves totals and exchange unchanged', async () => {
    const full = 'identical repeated tool failure message, longer than forty characters'
    const repeated = (index: number) => ({ index, category: 'tool-result' as const, source: 'read', full, preview: 'repeated failure', chars: full.length, freshness: 'history' as const })
    const history = [repeated(4), { ...repeated(5), full: full + 'different tail', preview: 'same prefix, different tail', chars: full.length + 14 }, repeated(6), repeated(7)]
    const detail = { ...REQ101, segments: { ...REQ101.segments, history } }
    bench({ requests: { 101: detail } })
    await screen.findByText('#101 · read:a.ts')
    const composition = screen.getByRole('region', { name: zh['lens.composition'] })
    const duplicate = within(composition).getByRole('button', { name: /只看重复/ })
    expect(duplicate.textContent).toContain(String(full.length * 2))
    const layer = within(composition).getByText(zh['lens.layerHistory']).closest('summary')!
    const original = layer.textContent?.slice(1)
    fireEvent.click(duplicate)
    expect(layer.parentElement?.hasAttribute('open')).toBe(true)
    expect(layer.textContent?.slice(1)).toBe(original)
    expect(within(composition).getAllByText('repeated failure')).toHaveLength(3)
    expect(within(composition).getAllByText('×3')).toHaveLength(3)
    expect(within(composition).queryByText('same prefix, different tail')).toBeNull()
    expect(within(screen.getByRole('region', { name: zh['lens.exchange'] })).getByText('文件内容全文')).toBeTruthy()
    // Category and duplicates are one exclusive filter, not two hidden constraints.
    fireEvent.click(within(composition).getByRole('button', { name: /工具结果/ }))
    expect(duplicate.getAttribute('aria-pressed')).toBe('false')
    expect(within(composition).getByText('same prefix, different tail')).toBeTruthy()
    fireEvent.click(duplicate)
    fireEvent.click(screen.getByRole('button', { name: '#102 · 助手回复' }))
    await screen.findByText('#102 · 助手回复', { selector: 'b' })
    expect(screen.queryByRole('button', { name: /只看重复/ })).toBeNull()
    expect(screen.getByText('文件内容')).toBeTruthy()
  })
})


describe('agent-local display numbers', () => {
  it('shows ordinals while selection and JSON retain internal query IDs; removes trend prose', async () => {
    const overview = structuredClone(OVERVIEW2)
    overview.scopes[0]!.requests[0]!.requestNumber = 2
    overview.scopes[0]!.requests[1]!.requestNumber = 3
    const { mocks, container } = bench({
      overview: () => overview,
      requests: { 101: { ...REQ101, requestNumber: 2 }, 102: { ...REQ102, requestNumber: 3 } },
    })
    await screen.findByRole('button', { name: '#2 · read:a.ts' })
    expect(screen.queryByRole('button', { name: '#101 · read:a.ts' })).toBeNull()
    expect(container.textContent).not.toContain('输入走势')
    expect(container.textContent).not.toContain('高度＝输入 tokens')
    fireEvent.click(screen.getByRole('button', { name: '#3 · 助手回复' }))
    await waitFor(() => expect(mocks.getRequest.mock.calls.some(call => call[1] === 102)).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: zh['view.raw'] }))
    await screen.findByText(/"seq": 102/)
  })

  it('does not fall back to internal seq when historical numbering is unknown', async () => {
    const overview = structuredClone(OVERVIEW1)
    delete overview.scopes[0]!.requests[0]!.requestNumber
    const { requestNumber: _number, ...unknown } = REQ101
    bench({ turns: [TURNS[0]!], overview: () => overview, requests: { 11: { ...unknown, seq: 11 } } })
    await screen.findByRole('button', { name: '#— · 助手回复' })
    expect(screen.queryByRole('button', { name: '#11 · 助手回复' })).toBeNull()
    expect(screen.getAllByTitle(zh['req.numberUnknown']).length).toBeGreaterThan(0)
  })
})

describe('compression provenance navigation', () => {
  it('opens an auxiliary compaction across turns, then returns to the exact source request', async () => {
    const auxiliaryTurn: TurnListItem = { ...TURNS[0]!, turnSeq: -1, hostTurn: undefined, query: 'compaction', startedAt: 2500 }
    const auxiliary: CapturedRequest = { ...REQ101, seq: 301, requestNumber: undefined, purpose: 'compaction', responseSummary: { kind: 'compaction' }, compaction: { id: 'c', inputPartial: true, replacedCount: 2, before: { turnSeq: 1, scopeId: 'main', seq: 11 } } }
    const source: CapturedRequest = { ...REQ101, segments: { ...REQ101.segments, added: [{ index: 5, category: 'compaction', source: 'compact-checkpoint', full: 'Summary body', preview: 'Summary body', chars: 12, freshness: 'new', compactionId: 'c', compactionRequest: { turnSeq: -1, scopeId: 'main', seq: 301 } }] } }
    bench({ turns: [TURNS[0]!, auxiliaryTurn, TURNS[1]!], requests: { 101: source, 301: auxiliary }, overview: seq => seq === -1 ? { turn: auxiliaryTurn, scopes: [{ ...OVERVIEW1.scopes[0]!, requests: [{ ...OVERVIEW1.scopes[0]!.requests[0]!, seq: 301, requestNumber: undefined, responseSummary: { kind: 'compaction' } }] }] } : seq === 1 ? OVERVIEW1 : OVERVIEW2 })
    fireEvent.click(await screen.findByRole('button', { name: '查看压缩调用及原历史 ↗' }))
    await screen.findByText('日志恢复 · 压缩指令未记录 ⓘ')
    expect(screen.getByText('记录间隔')).toBeTruthy()
    expect(screen.getByText('日志未保留完整输入，不比较缓存前缀。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '← 返回来源请求' }))
    await screen.findByRole('button', { name: '查看压缩调用及原历史 ↗' })
    expect(screen.getByRole('button', { name: '#101 · read:a.ts' }).getAttribute('aria-pressed')).toBe('true')
  })
})
