// @vitest-environment jsdom
/**
 * The type page (card types, P1a), over injected Remote mocks: the brief, the
 * pending proposal drawn as the card it would make with 采用 / 不采用 under
 * it, the adopted definition's field table, 「交给 Agent 设计」 quoting the
 * request into the input, and a rejected draft category sending the row back
 * to the board.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { CanvasTypeViewProps } from '../src/client/contract.ts'
import { CanvasSelectionStore } from '../src/client/space/selection.ts'
import { TypeView } from '../src/client/type/TypeView.tsx'
import { zh } from '../src/client/locales.ts'
import type { TypeDefinition } from '../src/card-types.ts'
import type { BoardCategory, BoardMutationResult, BoardReadOutcome, CanvasBoard } from '../src/types.ts'
import { defaultCategories } from '../src/types.ts'

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

const NOW = '2026-09-30T08:00:00.000Z'
const CANVAS_ID = 'canvas_01234567abcdefgh'
const KIND = 'cat_person'

const t = ((key: keyof typeof zh, params?: Record<string, string>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)) as CanvasTypeViewProps['t']

const V1: TypeDefinition = {
  version: 1,
  layout: 'profile',
  fields: [{ key: 'name', label: '姓名', type: 'line', hint: '全名', required: true }],
  example: { name: '林澈' },
}
const V2: TypeDefinition = {
  version: 2,
  layout: 'profile',
  fields: [
    { key: 'name', label: '姓名', type: 'line', hint: '全名', required: true },
    { key: 'goal', label: '想要什么', type: 'line', hint: '一句话', face: true },
  ],
  example: { name: '苏晚', goal: '找回哥哥' },
}

function board(category: Partial<BoardCategory>): CanvasBoard {
  return {
    id: CANVAS_ID,
    title: '长夜',
    attachedWorkspaces: [],
    chat: { sessionId: null },
    cards: [{
      id: 'c_a', kind: KIND, text: '', fields: { name: '林澈' }, status: 'kept', comments: [],
      createdBy: 'user', createdAt: NOW, updatedAt: NOW,
    }] as CanvasBoard['cards'],
    categories: [...defaultCategories(), { id: KIND, label: '人物', order: 100, enabled: true, ...category }],
    links: [],
    lanes: [],
    manuscripts: [],
    stats: { proposed: { accepted: 0, rejected: 0 }, kindCounts: {}, lastActiveAt: NOW },
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  } as CanvasBoard
}

function harness(start: CanvasBoard, afterDecide?: CanvasBoard) {
  const ok = <T,>(value: T): Result<T> => ({ ok: true, value })
  sessionStorage.clear()
  const store = new CanvasSelectionStore()
  const mocks = {
    readBoard: vi.fn(async (): Promise<Result<BoardReadOutcome>> => ok({ ok: true, board: start, version: '1' })),
    setTypeBrief: vi.fn(async (): Promise<Result<BoardMutationResult>> => ok({ ok: true, board: start, version: '2' })),
    decideType: vi.fn(async (): Promise<Result<BoardMutationResult>> =>
      ok({ ok: true, board: afterDecide ?? start, version: '2' })),
    openTypePage: vi.fn(),
    openCardDetail: vi.fn(),
    talkAvailable: vi.fn(() => true),
    quoteToConversation: vi.fn(() => true),
    attachImage: vi.fn(),
  }
  const crumbs = { canvasTitle: '长夜', heading: '人物', siblings: [], onBack: vi.fn(), onStep: vi.fn() }
  const props = {
    t,
    sessionId: 's1',
    canvasId: CANVAS_ID,
    kind: KIND,
    crumbs,
    ...mocks,
    useSelection: function useSelection<S>(selector: (snapshot: ReturnType<typeof store.source.getSnapshot>) => S): S {
      return selector(useSyncExternalStore(store.source.subscribe, store.source.getSnapshot))
    },
  } as unknown as CanvasTypeViewProps
  return { props, mocks, crumbs }
}

afterEach(() => { cleanup() })

describe('TypeView', () => {
  it('shows the brief, the proposal as the card it would make, and adopts it', async () => {
    const { props, mocks } = harness(board({
      brief: '人物卡要一眼看出他想要什么。',
      definition: V1,
      proposal: { definition: V2, rationale: '加上动机，写对手戏时好查。', createdAt: NOW },
    }))
    render(<TypeView {...props} />)
    expect(await screen.findByText('人物卡要一眼看出他想要什么。')).toBeTruthy()
    expect(screen.getByText('加上动机，写对手戏时好查。')).toBeTruthy()
    // The preview is the example filled into the proposed face.
    expect(screen.getByText('找回哥哥')).toBeTruthy()
    expect(screen.getAllByText('想要什么').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: zh['type.adopt'] }))
    await waitFor(() => {
      expect(mocks.decideType).toHaveBeenCalledWith('s1', { canvasId: CANVAS_ID, kind: KIND, decision: 'adopt' })
    })
  })

  it('quotes the design request into the input without sending it', async () => {
    const { props, mocks } = harness(board({}))
    render(<TypeView {...props} />)
    expect(await screen.findByText(zh['type.briefEmpty'])).toBeTruthy()
    expect(screen.getByText(zh['type.definitionNone'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(zh['type.askAgent']) }))
    expect(mocks.quoteToConversation).toHaveBeenCalledWith('s1', t('type.quote', { canvas: '长夜', label: '人物', kind: KIND }))
  })

  it('goes back to the board when rejecting removes a draft category', async () => {
    const drafted = board({ draft: true, proposal: { definition: V2, rationale: '', createdAt: NOW } })
    drafted.cards = []
    const gone = { ...drafted, categories: defaultCategories() } as CanvasBoard
    const { props, crumbs } = harness(drafted, gone)
    render(<TypeView {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: zh['type.reject'] }))
    await waitFor(() => { expect(crumbs.onBack).toHaveBeenCalled() })
  })
})
