// @vitest-environment jsdom
/**
 * The link view (stage ⑥): the 卡板/连线 switch, the stored-vs-auto grid, and
 * every gesture on the stage — a click that picks, a drag that places, a band
 * that picks a batch, a port drag that links a pair, the line delete, the lanes
 * (add / rename / drag-carry / resize), 「顺线扩一圈」's send set and the two
 * quote gestures — plus the read-only degrade. The pure geometry half is covered
 * by tests/layout-geometry.spec.ts; THIS file is the component, driven through
 * CanvasTab so the prop wiring (`onLayout` → the `setLayout` Remote verb,
 * `onToggleSelect`/`onAddSelection` → the tab's selection, `onTalk` → `quoteToConversation`)
 * is part of every assertion rather than a mock's word for it.
 *
 * jsdom reports 0 for every measurement, which would make each clamp collapse
 * toward `{x:0,y:0}` and every coordinate assertion vacuous. `beforeEach`
 * therefore installs the boxes this file names (STAGE / NODE) on the four
 * getters the component actually reads — see the note above `MEASURERS`. Every
 * expected number below is arithmetic on those boxes, never a magic pixel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { CanvasTabProps } from '../src/client/contract.ts'
import { CanvasImageSrcs } from '../src/client/images.ts'
import { CanvasSelectionStore } from '../src/client/space/selection.ts'
import { CanvasTab } from '../src/client/tab/CanvasTab.tsx'
import { zh } from '../src/client/locales.ts'
import { defaultCategories, makeBoardId } from '../src/types.ts'
import type {
  BoardAttachImageOutcome, BoardCategory, BoardFocusResult,
  BoardLane, BoardLink, BoardListResult, BoardMutationResult, BoardReadOutcome,
  CanvasBoard, CanvasSummary,
} from '../src/types.ts'

/**
 * Reaching the 连线 switch costs two awaited remote reads (list, then board)
 * plus the renders they cause, and `findByRole` budgets 1000 ms for that by
 * default. The repo raised vitest's own budget for the same reason
 * (build/vitest.ts: the root run starts every package at once, and CI's runner
 * is fast enough to stay under) — the async-util default is the same wall
 * crossed from the other side: under a starved event loop its 50 ms polls
 * arrive late, and the switch is genuinely absent when the last one fires.
 * A larger budget costs a passing test nothing; every assertion stays.
 */
configure({ asyncUtilTimeout: 5_000 })

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

/** One layout write as the fake host receives it (mirrors `BoardSetLayoutRequest`). */
interface LayoutWrite {
  canvasId: string
  positions?: { id: string; x: number; y: number }[]
  lanes?: BoardLane[]
  links?: BoardLink[]
}

/** A screen point — and, with the stage at the origin, a world point too. */
interface Point {
  readonly x: number
  readonly y: number
}

const NOW = '2026-09-16T08:00:00.000Z'
const CANVAS_ID = 'canvas_01234567abcdefgh'
/** One stored image's id: the digest shape a card-held pointer insists on. */
const IMG_ID = `sha256:${'0123456789abcdef'.repeat(4)}`

/* ---------------------------------------------------------------- measurement
 *
 * The stage asks for its own size through `clientWidth`/`clientHeight`
 * (`stageBox`, LinkView.tsx:322) and for each node's through
 * `offsetWidth`/`offsetHeight` (the measuring effect, :254). It reads
 * `getBoundingClientRect` only for its OFFSET inside `worldPoint` (:240), which
 * jsdom already answers with the origin — so these four getters, and not the
 * rect, are what a stub has to reach before any drag number means something.
 */

/** The visible stage this file pretends the panel is. */
const STAGE = { w: 620, h: 420 }
/** Every node's box, measured identical (the text lengths are not the subject). */
const NODE = { w: 180, h: 60 }
/** The last top-left a dragged node may hold: the far corner inside the stage. */
const INSIDE = { x: STAGE.w - NODE.w, y: STAGE.h - NODE.h }

const MEASURERS: readonly (readonly [object, string, () => number])[] = [
  [Element.prototype, 'clientWidth', () => STAGE.w],
  [Element.prototype, 'clientHeight', () => STAGE.h],
  [HTMLElement.prototype, 'offsetWidth', () => NODE.w],
  [HTMLElement.prototype, 'offsetHeight', () => NODE.h],
]

/** The pinned 8-byte draw, so a minted lane id is reproducible (`newLaneId`). */
const MINT = '0001020304050607'

let measured: readonly (readonly [object, string, PropertyDescriptor | undefined])[] = []

beforeEach(() => {
  measured = MEASURERS.map(([target, name]) => [target, name, Object.getOwnPropertyDescriptor(target, name)])
  for (const [target, name, get] of MEASURERS) {
    Object.defineProperty(target, name, { configurable: true, get })
  }
  vi.stubGlobal('crypto', {
    getRandomValues: (view: Uint8Array) => {
      for (let index = 0; index < view.length; index += 1) view[index] = index
      return view
    },
  })
})

afterEach(() => {
  cleanup()
  for (const [target, name, descriptor] of measured) {
    if (descriptor === undefined) Reflect.deleteProperty(target, name)
    else Object.defineProperty(target, name, descriptor)
  }
  vi.unstubAllGlobals()
})

/** A plain translate over the zh dictionary (the key-set source of truth). */
const t = ((key: keyof typeof zh, params?: Record<string, string>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)) as CanvasTabProps['t']

/** One board fixture; cards land in array order, stage ⑥'s rows default empty. */
function board(id = CANVAS_ID, cards: CanvasBoard['cards'] = [], overrides: Partial<CanvasBoard> = {}): CanvasBoard {
  return {
    id,
    title: '为什么人们不愿表达异议',
    attachedWorkspaces: [],
    chat: { sessionId: null },
    cards,
    categories: defaultCategories(),
    links: [],
    lanes: [],
    manuscripts: [],
    stats: { proposed: { accepted: 0, rejected: 0 }, kindCounts: {}, lastActiveAt: NOW },
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

/** One card fixture. */
function card(id: string, overrides: Record<string, unknown> = {}): CanvasBoard['cards'][number] {
  return {
    id,
    kind: 'fragment',
    text: `卡片 ${id}`,
    status: 'kept',
    comments: [],
    createdBy: 'user',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as CanvasBoard['cards'][number]
}

/** One lane row. */
function lane(id: string, box: Point & { w: number; h: number }, label = ''): BoardLane {
  return { id, label, ...box }
}

/** One line row. */
const link = (from: string, to: string): BoardLink => ({ from, to })

/** The row the list surface reports for one board. */
function rowOf(value: CanvasBoard): CanvasSummary {
  return {
    id: value.id,
    title: value.title,
    cardCount: value.cards.filter(row => row.status !== 'archived').length,
    openQuestions: 0,
    archivedAt: value.archivedAt,
    lastActiveAt: value.stats.lastActiveAt,
  }
}

interface Harness {
  readonly store: CanvasSelectionStore
  readonly mocks: {
    listCanvases: ReturnType<typeof vi.fn>
    createCanvas: ReturnType<typeof vi.fn>
    readBoard: ReturnType<typeof vi.fn>
    putCard: ReturnType<typeof vi.fn>
    patchCard: ReturnType<typeof vi.fn>
    setCategories: ReturnType<typeof vi.fn>
    setLayout: ReturnType<typeof vi.fn>
    addComment: ReturnType<typeof vi.fn>
    archiveCanvas: ReturnType<typeof vi.fn>
    openFile: ReturnType<typeof vi.fn>
    openCardDetail: ReturnType<typeof vi.fn>
    openCardDraft: ReturnType<typeof vi.fn>
    focusCanvas: ReturnType<typeof vi.fn>
    talkAvailable: ReturnType<typeof vi.fn>
    quoteToConversation: ReturnType<typeof vi.fn>
    refreshBoards: ReturnType<typeof vi.fn>
    suggestWideMode: ReturnType<typeof vi.fn>
  }
  readonly props: CanvasTabProps
  /** The fake host's boards by id (mutations apply to them). */
  readonly boards: Map<string, CanvasBoard>
}

/** Mount the tab over a fake host holding the given boards. */
function makeHarness(options: {
  sessionId?: string | 'none'
  boards?: CanvasBoard[]
  workspaces?: readonly { workspaceId: string; path: string; title: string }[]
  chatAvailable?: boolean
} = {}): Harness {
  const boards = new Map((options.boards ?? [board()]).map(value => [value.id, value]))
  const ok = <T,>(value: T): Result<T> => ({ ok: true, value })
  // A bench starts on an empty strip, every time: the store restores the rows a
  // previous bench left in sessionStorage, and those name cards its board has not.
  sessionStorage.clear()
  const store = new CanvasSelectionStore()
  // The REAL image cache over a fake read leg (§10.3): the tab reads its feed
  // as a subscription, so the feed is exercised here rather than faked away.
  const images = new CanvasImageSrcs(async () => ({
    ok: true as const,
    value: { ok: true as const, data: 'AAEC', mediaType: 'image/png' as const },
  }))
  const mutationFor = (canvasId: string): Result<BoardMutationResult> => {
    const current = boards.get(canvasId)
    if (current === undefined) return { ok: true, value: { ok: false, error: 'missing' } }
    return ok({ ok: true, board: current, version: '2' })
  }
  const mocks = {
    listCanvases: vi.fn(async (): Promise<Result<BoardListResult>> =>
      ok({ items: [...boards.values()].map(rowOf) })),
    createCanvas: vi.fn(async (_sid: string, request: { title: string; attachedWorkspaces?: readonly string[] }): Promise<Result<BoardMutationResult>> => {
      const minted = board('canvas_new00000abcdefgh', [], {
        title: request.title,
        attachedWorkspaces: [...(request.attachedWorkspaces ?? [])],
      })
      boards.set(minted.id, minted)
      return ok({ ok: true, board: minted, version: '1' })
    }),
    readBoard: vi.fn(async (request: { canvasId: string }): Promise<Result<BoardReadOutcome>> => {
      const current = boards.get(request.canvasId)
      if (current === undefined) return ok({ ok: false, error: 'missing' })
      return ok({ ok: true, board: current, version: '1' })
    }),
    putCard: vi.fn(async (sid: string, request: { canvasId: string }): Promise<Result<BoardMutationResult>> => mutationFor(request.canvasId)),
    patchCard: vi.fn(async (sid: string, request: { canvasId: string; cardId: string; kind?: string; text?: string; status?: 'proposed' | 'kept' | 'archived'; question?: { state: 'open' | 'exploring' | 'answered' } }): Promise<Result<BoardMutationResult>> => {
      const current = boards.get(request.canvasId)
      const target = current?.cards.find(candidate => candidate.id === request.cardId)
      if (target !== undefined) {
        if (request.kind !== undefined) target.kind = request.kind as typeof target.kind
        if (request.text !== undefined) target.text = request.text
        if (request.status !== undefined) target.status = request.status
        if (request.question !== undefined && target.question !== undefined) target.question.state = request.question.state
      }
      return mutationFor(request.canvasId)
    }),
    setCategories: vi.fn(async (sid: string, request: { canvasId: string; categories: BoardCategory[]; archiveCardIds?: string[] }): Promise<Result<BoardMutationResult>> => {
      const current = boards.get(request.canvasId)
      if (current !== undefined) {
        current.categories = request.categories.map(row => ({ ...row }))
        const gone = new Set(request.archiveCardIds ?? [])
        for (const candidate of current.cards) {
          if (gone.has(candidate.id)) candidate.status = 'archived'
        }
      }
      return mutationFor(request.canvasId)
    }),
    // The stage ⑥ verb. `mutationFor` hands back the SAME board object the host
    // holds, so the writes below are exactly what the re-render shows — the
    // fake-host behaviour the real store's setLayout has.
    setLayout: vi.fn(async (sid: string, request: LayoutWrite): Promise<Result<BoardMutationResult>> => {
      const current = boards.get(request.canvasId)
      if (current !== undefined) {
        for (const position of request.positions ?? []) {
          const target = current.cards.find(candidate => candidate.id === position.id)
          if (target !== undefined) { target.x = position.x; target.y = position.y }
        }
        if (request.lanes !== undefined) current.lanes = request.lanes.map(row => ({ ...row }))
        if (request.links !== undefined) current.links = [...request.links]
      }
      return mutationFor(request.canvasId)
    }),
    addComment: vi.fn(async (sid: string, request: { canvasId: string; cardId: string; text: string }): Promise<Result<BoardMutationResult>> => {
      const target = boards.get(request.canvasId)?.cards.find(candidate => candidate.id === request.cardId)
      target?.comments.push({ id: `m_${request.text.length}`, author: 'user', text: request.text, createdAt: NOW })
      return mutationFor(request.canvasId)
    }),
    archiveCanvas: vi.fn(async (sid: string, request: { canvasId: string; archived: boolean }): Promise<Result<BoardMutationResult>> => {
      const current = boards.get(request.canvasId)
      if (current !== undefined) current.archivedAt = request.archived ? NOW : null
      return mutationFor(request.canvasId)
    }),
    openFile: vi.fn(),
    // A card's pen hands the HOST an address; it never changes what this seat
    // renders — on the link face it takes that pen or a double click.
    openCardDetail: vi.fn(),
    openCardDraft: vi.fn(),
    // The strip's own two verbs are the store's, exactly as the production face
    // wires them; the detail openings stay recorders, because these specs assert
    // what the gesture PASSES, not what the strip then renders.
    activateTab: (id: string) => { store.activate(id) },
    closeTab: (id: string) => { store.close(id) },
    openCanvas: (canvasId: string) => { store.openCanvas(canvasId) },
    focusCanvas: vi.fn(async (): Promise<Result<BoardFocusResult>> => ok({ ok: true })),
    talkAvailable: vi.fn((): boolean => options.chatAvailable ?? true),
    quoteToConversation: vi.fn((): boolean => true),
    refreshBoards: vi.fn(),
    suggestWideMode: vi.fn(),
    attachImage: vi.fn(async (): Promise<Result<BoardAttachImageOutcome>> =>
      ok({ ok: true, ref: { attachmentId: IMG_ID, mediaType: 'image/png', bytes: 3, width: 2, height: 1 } })),
    images,
  }
  const sessionId = options.sessionId === 'none' ? undefined : (options.sessionId ?? 's1')
  const props = {
    t,
    sessionId,
    ...mocks,
    useSessions: ((selector: (snapshot: { byId: Record<string, { cwd: string }> }) => unknown) =>
      selector({ byId: sessionId === undefined ? {} : { [sessionId]: { cwd: '/ws' } } })) as CanvasTabProps['useSessions'],
    useWorkspaces: ((selector: (snapshot: { items: readonly unknown[] }) => unknown) =>
      selector({ items: options.workspaces ?? [] })) as CanvasTabProps['useWorkspaces'],
    useSelection: function useSelection<S>(selector: (snapshot: ReturnType<typeof store.source.getSnapshot>) => S): S {
      return selector(useSyncExternalStore(store.source.subscribe, store.source.getSnapshot))
    } as CanvasTabProps['useSelection'],
    useImageRev: function useImageRev<S>(selector: (snapshot: number) => S): S {
      return selector(useSyncExternalStore(images.source.subscribe, images.source.getSnapshot))
    } as CanvasTabProps['useImageRev'],
  } as unknown as CanvasTabProps
  return { store, mocks, props, boards }
}

/* --------------------------------------------------------------- DOM helpers */

/** One element the stage's `data-*` hooks name, or a failing message. */
function one<T extends Element>(container: HTMLElement, selector: string): T {
  const el = container.querySelector<T>(selector)
  if (el === null) throw new Error(`no element for ${selector}`)
  return el
}

const nodeOf = (container: HTMLElement, id: string): HTMLElement => one<HTMLElement>(container, `[data-node="${id}"]`)
/** Which of a card's two handles: a card has one per side, and the tests that
 *  do not care keep using the right-hand one. */
const portOf = (container: HTMLElement, id: string, side: 'left' | 'right' = 'right'): HTMLElement =>
  one<HTMLElement>(container, `[data-port="${id}:${side}"]`)
const wireOf = (container: HTMLElement, pair: string): Element => one(container, `[data-wire="${pair}"]`)
const worldOf = (container: HTMLElement): HTMLElement => one<HTMLElement>(container, '[data-world]')
const nodesOf = (container: HTMLElement): HTMLElement[] => [...container.querySelectorAll<HTMLElement>('[data-node]')]
const wiresOf = (container: HTMLElement): number => container.querySelectorAll('[data-wire]').length
const lanesOf = (container: HTMLElement): Element[] => [...container.querySelectorAll('[data-lane]')]
const pickedOf = (container: HTMLElement): string[] =>
  nodesOf(container).filter(row => row.hasAttribute('data-picked')).map(row => row.dataset.node ?? '')
/** The nodes marked as an ADDITION (never the ones the user clicked). */
const clusteredOf = (container: HTMLElement): string[] =>
  nodesOf(container).filter(row => row.hasAttribute('data-cluster')).map(row => row.dataset.node ?? '')
/** A node's kind line: its category, plus the lane it sits in. */
const kindOf = (container: HTMLElement, id: string): string => nodeOf(container, id).querySelector('span')!.textContent ?? ''
/** The scroll host: `stageRef` is the stage div that wraps the world div. */
const stageOf = (container: HTMLElement): HTMLElement => worldOf(container).parentElement as HTMLElement
/** The info line under the stage — the one element that spells out the send set. */
const infoOf = async (): Promise<string> => (await screen.findByText(/要发出去|板上有/)).textContent ?? ''
/**
 * The ink inside a node. jsdom's selector engine lowercases attribute NAMES, so
 * an SVG element's `viewBox` can only be read back by hand — and a node always
 * carries an icon svg (the pen button), which is not the figure.
 */
const figureOf = (node: HTMLElement): SVGSVGElement | undefined => [...node.querySelectorAll('svg')]
  .find(candidate => candidate.getAttribute('viewBox') === '0 0 600 400')

/** Press and release without travelling: under the 3px threshold, so a click. */
function tap(el: Element, at: Point = { x: 10, y: 10 }): void {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: at.x, clientY: at.y, button: 0 })
  fireEvent.pointerUp(window, { pointerId: 1, clientX: at.x, clientY: at.y })
}

/** Press, travel to `end`, release (the release target is the last word:
 * `onWorldDown` only reads a press whose target IS the world div, and
 * `startWire` reads the node the release landed on). `runGesture` attaches to
 * `window`, so the move and the release are driven there. */
function drag(from: Element, start: Point, end: Point, releaseOn: Element | Window = window): void {
  fireEvent.pointerDown(from, { pointerId: 1, clientX: start.x, clientY: start.y, button: 0 })
  fireEvent.pointerMove(window, { pointerId: 1, clientX: end.x, clientY: end.y })
  fireEvent.pointerUp(releaseOn, { pointerId: 1, clientX: end.x, clientY: end.y })
}

/** Let a gesture's (refused) release settle before asserting nothing was wrote. */
const settled = async (): Promise<void> => { await new Promise(resolve => { setTimeout(resolve, 0) }) }

/** The nth `setLayout` write's request half. */
function writeAt(mocks: Harness['mocks'], index: number): LayoutWrite {
  return mocks.setLayout.mock.calls[index]![1] as LayoutWrite
}

/** Where the view's own auto grid parks an unplaced card at `index`. */
const grid = (index: number): Point => ({ x: 14 + (index % 2) * 184, y: 14 + Math.floor(index / 2) * 96 })

/**
 * The stage's scroll offset, which jsdom will not answer for: its `scrollLeft`
 * setter is inert with no layout box, so the value `worldPoint` adds has to be
 * installed as a getter. It is the only way this surface's world/screen split
 * can be tested at all, and the box-select test below leans on it.
 */
function scrollStage(container: HTMLElement, left: number): void {
  Object.defineProperty(stageOf(container), 'scrollLeft', { configurable: true, get: () => left })
}

interface Face {
  readonly container: HTMLElement
  /** Re-render over the SAME props: what the host handing back a board whose
   * card list changed looks like to a surface that is not being re-read. */
  readonly rerender: () => void
}

/** Mount the tab, switch to the link face, and wait for the stage to hold `count` nodes. */
async function openLinkFace(bench: Harness, count: number): Promise<Face> {
  const view = render(<CanvasTab {...bench.props} />)
  fireEvent.click(await screen.findByRole('button', { name: '连线' }))
  await waitFor(() => {
    expect(nodesOf(view.container)).toHaveLength(count)
  })
  return {
    container: view.container,
    rerender: () => { view.rerender(<CanvasTab {...bench.props} />) },
  }
}

const face = async (bench: Harness, count: number): Promise<HTMLElement> => (await openLinkFace(bench, count)).container

describe('LinkView — the stage mounts from the board', () => {
  it('switching to 连线 mounts one node per visible card, and none for an archived one', async () => {
    const bench = makeHarness({
      boards: [board(CANVAS_ID, [card('c_1'), card('c_2'), card('c_old', { status: 'archived', text: '归档掉的旧卡' })])],
    })
    const { container } = render(<CanvasTab {...bench.props} />)
    await screen.findByRole('button', { name: '连线' })
    expect(screen.getByRole('button', { name: '卡板' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '连线' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: '连线' }))
    await waitFor(() => {
      expect(nodesOf(container).map(row => row.dataset.node)).toEqual(['c_1', 'c_2'])
    })
    expect(screen.getByRole('button', { name: '卡板' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: '连线' }).getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('[data-node="c_old"]')).toBeNull()
    expect(screen.queryByText('归档掉的旧卡')).toBeNull()
  })

  it('honours a stored x/y, drops an unplaced card into the two-column grid, and sizes the world off measured nodes', async () => {
    const bench = makeHarness({
      boards: [board(CANVAS_ID, [card('c_1', { x: 300, y: 250 }), card('c_2'), card('c_3')])],
    })
    const container = await face(bench, 3)
    expect(nodeOf(container, 'c_1').style.left).toBe('300px')
    expect(nodeOf(container, 'c_1').style.top).toBe('250px')
    // SPOT = {x0:14, y0:14, dx:184, dy:96}, counted over the VISIBLE list.
    expect(nodeOf(container, 'c_2').style.left).toBe(`${grid(1).x}px`)
    expect(nodeOf(container, 'c_2').style.top).toBe(`${grid(1).y}px`)
    expect(nodeOf(container, 'c_3').style.left).toBe(`${grid(2).x}px`)
    expect(nodeOf(container, 'c_3').style.top).toBe(`${grid(2).y}px`)
    // The world is the furthest measured edge plus the view's own 24-unit slack.
    // On the {168,64} fallback these would read 468/314, so this pair is also
    // the proof that the node-measuring effect ran and the wires read real sizes.
    expect(worldOf(container).style.width).toBe(`${300 + NODE.w + 24}px`)
    expect(worldOf(container).style.height).toBe(`${250 + NODE.h + 24}px`)
  })

  it('draws one wire per link, and none for a link whose far end has left the board', async () => {
    const bench = makeHarness({
      boards: [board(CANVAS_ID, [card('c_1'), card('c_2'), card('c_old', { status: 'archived' })], {
        links: [link('c_1', 'c_2'), link('c_2', 'c_old')],
      })],
    })
    const container = await face(bench, 2)
    expect(wiresOf(container)).toBe(1)
    // Edge to facing edge of the MEASURED boxes: a's right edge (14+180, 44)
    // into b's left edge (198, 44). The centres would read 104/288, and the
    // unmeasured fallback would put a's edge at 182 — so this also proves the
    // node-measuring effect ran before the wires were drawn.
    expect(wireOf(container, 'c_1:c_2').getAttribute('d')).toBe('M 194 44 C 218 44, 174 44, 198 44')
    expect(container.querySelector('[data-wire="c_2:c_old"]')).toBeNull()
  })

  it('fills an empty body with the 「（空卡）」 placeholder, ghosts a proposal, and shows a drawn one as ink', async () => {
    const drawn = card('c_ink', {
      text: '',
      draw: [{ pts: [{ x: 100, y: 100, w: 5 }, { x: 300, y: 200, w: 4 }], color: 'ink' }],
    })
    const bench = makeHarness({
      boards: [board(CANVAS_ID, [card('c_1'), card('c_2', { text: '' }), card('c_ghost', { status: 'proposed' }), drawn])],
    })
    const container = await face(bench, 4)
    expect(nodeOf(container, 'c_1').textContent).toContain('卡片 c_1')
    expect(kindOf(container, 'c_2')).toBe('灵感')
    expect(nodeOf(container, 'c_2').textContent).toContain('（空卡）')
    expect(nodeOf(container, 'c_ghost').hasAttribute('data-ghost')).toBe(true)
    expect(nodeOf(container, 'c_1').hasAttribute('data-ghost')).toBe(false)
    const node = nodeOf(container, 'c_ink')
    const figure = figureOf(node)
    expect(figure).toBeTruthy()
    expect(figure!.querySelectorAll('path')).toHaveLength(1)
    // The ink rides ALONGSIDE the placeholder: a drawn-but-empty card never reads
    // as a blank one.
    expect(node.textContent).toContain('（空卡）')
    // An un-drawn card carries no figure — only its pen button, which is an icon
    // in the same node and must not be mistaken for one.
    expect(figureOf(nodeOf(container, 'c_1'))).toBeUndefined()
  })
})

describe('LinkView — press, click, drag', () => {
  it('draws the 3px line exactly: a 3px travel is still a click, 4px is a drag', async () => {
    const bench = makeHarness({ boards: [board(CANVAS_ID, [card('c_1'), card('c_2')])] })
    const container = await face(bench, 2)
    // |dx| + |dy| = 3 does not pass `> DRAG_THRESHOLD`, so nothing is written and
    // the card is picked — the flinch of a hand reaching for a card is not a move.
    drag(nodeOf(container, 'c_1'), { x: 10, y: 10 }, { x: 13, y: 10 })
    expect(pickedOf(container)).toEqual(['c_1'])
    expect(bench.mocks.setLayout).not.toHaveBeenCalled()
    // 3 + 1 = 4 crosses it: a placement now, and the pick half is gone.
    drag(nodeOf(container, 'c_2'), { x: 10, y: 10 }, { x: 13, y: 11 })
    await waitFor(() => {
      expect(bench.mocks.setLayout).toHaveBeenCalledTimes(1)
    })
    expect(writeAt(bench.mocks, 0).positions).toEqual([{ id: 'c_2', x: grid(1).x + 3, y: grid(1).y + 1 }])
    expect(pickedOf(container)).toEqual(['c_1'])
  })

  it('a press that never travels toggles the pick and calls onLayout zero times', async () => {
    const bench = makeHarness({ boards: [board(CANVAS_ID, [card('c_1'), card('c_2')])] })
    const container = await face(bench, 2)
    expect(nodeOf(container, 'c_1').hasAttribute('data-picked')).toBe(false)
    tap(nodeOf(container, 'c_1'))
    expect(pickedOf(container)).toEqual(['c_1'])
    tap(nodeOf(container, 'c_1'))
    expect(pickedOf(container)).toEqual([])
    tap(nodeOf(container, 'c_2'))
    expect(pickedOf(container)).toEqual(['c_2'])
    expect(bench.mocks.setLayout).not.toHaveBeenCalled()
    expect(bench.mocks.patchCard).not.toHaveBeenCalled()
    // A click on this face selects; it never opens. Opening is the pen or a
    // double click, and neither happened.
    expect(bench.mocks.openCardDetail).not.toHaveBeenCalled()
  })

  it('writes a drag as whole-number positions, whatever decimals the file carried', async () => {
    // A hand-edited `canvas.json` row (§11.3's tolerance): the view still has to
    // write whole units, because the state file is meant to read like text.
    const bench = makeHarness({ boards: [board(CANVAS_ID, [card('c_1', { x: 100.4, y: 55.7 }), card('c_2')])] })
    const container = await face(bench, 2)
    drag(nodeOf(container, 'c_1'), { x: 10, y: 10 }, { x: 40, y: 35 })
    await waitFor(() => {
      expect(bench.mocks.setLayout).toHaveBeenCalledTimes(1)
    })
    // 100.4 + 30 → 130, 55.7 + 25 → 81: rounded, not floored, and never a decimal.
    expect(writeAt(bench.mocks, 0)).toEqual({ canvasId: CANVAS_ID, positions: [{ id: 'c_1', x: 130, y: 81 }] })
    for (const position of writeAt(bench.mocks, 0).positions!) {
      expect(Number.isInteger(position.x)).toBe(true)
      expect(Number.isInteger(position.y)).toBe(true)
    }
    // A placement is not a pick, and it touches no other half of the patch.
    expect(pickedOf(container)).toEqual([])
    expect(writeAt(bench.mocks, 0).lanes).toBeUndefined()
    expect(writeAt(bench.mocks, 0).links).toBeUndefined()
    await waitFor(() => {
      expect(nodeOf(container, 'c_1').style.left).toBe('130px')
    })
  })

  it('clamps a drag so the node cannot leave the visible stage box, either way', async () => {
    const bench = makeHarness({ boards: [board(CANVAS_ID, [card('c_1', { x: 300, y: 250 })])] })
    const container = await face(bench, 1)
    // A throw well past the far corner. The ceiling is the last top-left where
    // the node's MEASURED width still fits the stage — which is only a real
    // number because the stage and the node were both measured.
    drag(nodeOf(container, 'c_1'), { x: 10, y: 10 }, { x: 5010, y: 5010 })
    await waitFor(() => {
      expect(bench.mocks.setLayout).toHaveBeenCalledTimes(1)
    })
    const far = writeAt(bench.mocks, 0).positions![0]!
    expect(far).toEqual({ id: 'c_1', x: INSIDE.x, y: INSIDE.y })
    expect(far.x + NODE.w).toBe(STAGE.w)
    expect(far.y + NODE.h).toBe(STAGE.h)
    await waitFor(() => {
      expect(nodeOf(container, 'c_1').style.left).toBe(`${INSIDE.x}px`)
    })
    // And back past the near corner: the low bound, never a negative coordinate.
    drag(nodeOf(container, 'c_1'), { x: 10, y: 10 }, { x: -4990, y: -4990 })
    await waitFor(() => {
      expect(bench.mocks.setLayout).toHaveBeenCalledTimes(2)
    })
    const near = writeAt(bench.mocks, 1).positions![0]!
    expect(near).toEqual({ id: 'c_1', x: 0, y: 0 })
  })

  it('pressing a card never starts a band, so a drag on a node picks nothing else', async () => {
    const bench = makeHarness({
      boards: [board(CANVAS_ID, [card('c_1'), card('c_2'), card('c_far', { x: 100, y: 100 })])],
    })
    const container = await face(bench, 3)
    // A node drag whose band would have swept the whole stage if the press had
    // reached `onWorldDown` as well.
    drag(nodeOf(container, 'c_far'), { x: 0, y: 0 }, { x: 400, y: 400 })
    await waitFor(() => {
      expect(bench.mocks.setLayout).toHaveBeenCalledTimes(1)
    })
    expect(pickedOf(container)).toEqual([])
  })

  it('shows the lane a drag entered in the node’s kind line, and drops it when the next drag leaves', async () => {
    const bench = makeHarness({
      boards: [board(CANVAS_ID, [card('c_1', { x: 10, y: 10 }), card('c_2', { x: 400, y: 300 })], {
        lanes: [lane('lane_a', { x: 300, y: 0, w: 250, h: 120 }, '论点A')],
      })],
    })
    const container = await face(bench, 2)
    expect(kindOf(container, 'c_1')).toBe('灵感')
    // +350/+20 → (360,30), whose center (450,60) is inside the lane's box.
    drag(nodeOf(container, 'c_1'), { x: 10, y: 10 }, { x: 360, y: 30 })
    await waitFor(() => {
      expect(bench.mocks.setLayout).toHaveBeenCalledTimes(1)
    })
    expect(writeAt(bench.mocks, 0)).toEqual({ canvasId: CANVAS_ID, positions: [{ id: 'c_1', x: 360, y: 30 }] })
    // The landing is announced by the node's own badge, not a toast.
    await waitFor(() => {
      expect(kindOf(container, 'c_1')).toBe('灵感 · 论点A')
    })
    // Back out: the containment is re-read on the COMMITTED position, so the
    // badge flips with it — and the lane row itself is never rewritten.
    drag(nodeOf(container, 'c_1'), { x: 10, y: 10 }, { x: -340, y: 10 })
    await waitFor(() => {
      expect(bench.mocks.setLayout).toHaveBeenCalledTimes(2)
    })
    expect(writeAt(bench.mocks, 1).positions).toEqual([{ id: 'c_1', x: 10, y: 30 }])
    expect(writeAt(bench.mocks, 1).lanes).toBeUndefined()
    expect(kindOf(container, 'c_1')).toBe('灵感')
  })
})

describe('LinkView — lines', () => {
  it('links a pair from a port drag that ends on another node, moving nothing', async () => {
    const bench = makeHarness({ boards: [board(CANVAS_ID, [card('c_1'), card('c_2')])] })
    const container = await face(bench, 2)
    drag(portOf(container, 'c_1'), { x: 180, y: 40 }, { x: 210, y: 40 }, nodeOf(container, 'c_2'))
    await waitFor(() => {
      expect(bench.mocks.setLayout).toHaveBeenCalledTimes(1)
    })
    // The new row is appended to what the board already held, in the direction it
    // was drawn: an unordered pair, deduplicated on read.
    expect(writeAt(bench.mocks, 0)).toEqual({ canvasId: CANVAS_ID, links: [link('c_1', 'c_2')] })
    // The finished wire IS the confirmation — it appears, and no toast repeats it.
    await waitFor(() => {
      expect(wiresOf(container)).toBe(1)
    })
    // The port took the press away from the node: nothing was placed or picked.
    expect(pickedOf(container)).toEqual([])
    expect(writeAt(bench.mocks, 0).positions).toBeUndefined()
    expect(nodeOf(container, 'c_1').style.left).toBe(`${grid(0).x}px`)
    expect(nodeOf(container, 'c_2').style.left).toBe(`${grid(1).x}px`)
  })

  it('从左边那个连接点起手，存的还是同一对，画出来也是同一条线', async () => {
    const bench = makeHarness({ boards: [board(CANVAS_ID, [card('c_1'), card('c_2')])] })
    const container = await face(bench, 2)
    drag(portOf(container, 'c_1', 'left'), { x: 14, y: 40 }, { x: 210, y: 40 }, nodeOf(container, 'c_2'))
    await waitFor(() => {
      expect(bench.mocks.setLayout).toHaveBeenCalledTimes(1)
    })
    // Which handle the hand found is not stored: a pair is a pair, and the side a
    // finished line leaves from is re-derived from where the two cards sit — so
    // moving a card afterwards can never strand a tail on the wrong edge.
    expect(writeAt(bench.mocks, 0)).toEqual({ canvasId: CANVAS_ID, links: [link('c_1', 'c_2')] })
    await waitFor(() => {
      expect(wireOf(container, 'c_1:c_2').getAttribute('d'))
        .toBe('M 194 44 C 218 44, 174 44, 198 44')
    })
  })

  it('每侧一个连接点：左边的邻居不用再绕到右边去连线', async () => {
    const bench = makeHarness({ boards: [board(CANVAS_ID, [card('c_1'), card('c_2')])] })
    const container = await face(bench, 2)
    expect([...container.querySelectorAll<HTMLElement>('[data-port]')]
      .map(handle => handle.dataset.port)).toEqual(['c_1:left', 'c_1:right', 'c_2:left', 'c_2:right'])
  })

  it('refuses a pair that is already linked, whichever way round the row is stored', async () => {
    const bench = makeHarness({
      boards: [board(CANVAS_ID, [card('c_1'), card('c_2')], { links: [link('c_2', 'c_1')] })],
    })
    const container = await face(bench, 2)
    expect(wiresOf(container)).toBe(1)
    drag(portOf(container, 'c_1'), { x: 180, y: 40 }, { x: 210, y: 40 }, nodeOf(container, 'c_2'))
    await settled()
    expect(bench.mocks.setLayout).not.toHaveBeenCalled()
    expect(wiresOf(container)).toBe(1)
  })

  it('refuses to link a card to itself, even though the drag began and ended on it', async () => {
    const bench = makeHarness({ boards: [board(CANVAS_ID, [card('c_1'), card('c_2')])] })
    const container = await face(bench, 2)
    drag(portOf(container, 'c_1'), { x: 180, y: 40 }, { x: 60, y: 40 }, nodeOf(container, 'c_1'))
    await settled()
    expect(bench.mocks.setLayout).not.toHaveBeenCalled()
    expect(wiresOf(container)).toBe(0)
  })

  it('drops a wire released on nothing, without a word', async () => {
    const bench = makeHarness({ boards: [board(CANVAS_ID, [card('c_1'), card('c_2')])] })
    const container = await face(bench, 2)
    drag(portOf(container, 'c_1'), { x: 180, y: 40 }, { x: 500, y: 300 })
    await settled()
    expect(bench.mocks.setLayout).not.toHaveBeenCalled()
    expect(wiresOf(container)).toBe(0)
  })

  it('deletes only the picked line, and reaches no card', async () => {
    const bench = makeHarness({
      boards: [board(CANVAS_ID, [card('c_1'), card('c_2'), card('c_3')], { links: [link('c_1', 'c_2')] })],
    })
    const container = await face(bench, 3)
    fireEvent.click(wireOf(container, 'c_1:c_2'))
    await screen.findByRole('button', { name: '删掉这条线' })
    expect(pickedOf(container)).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: '删掉这条线' }))
    await waitFor(() => {
      expect(bench.mocks.setLayout).toHaveBeenCalledWith('s1', { canvasId: CANVAS_ID, links: [] })
    })
    await screen.findByText(/断了一条线，卡还在/)
    expect(nodesOf(container)).toHaveLength(3)
    // A line is a row of `links`, never a card: 删掉这条线 must not reach patchCard.
    expect(bench.mocks.patchCard).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(wiresOf(container)).toBe(0)
    })
    expect(screen.queryByRole('button', { name: '删掉这条线' })).toBeNull()
  })

  it('keeps a picked line across a changed visible list, because it holds the row and not its slot', async () => {
    const bench = makeHarness({
      boards: [board(CANVAS_ID, [card('c_1'), card('c_2'), card('c_3'), card('c_4')], {
        links: [link('c_1', 'c_2'), link('c_3', 'c_4')],
      })],
    })
    const { container, rerender } = await openLinkFace(bench, 4)
    // Pick the SECOND line while both rows are on the board.
    fireEvent.click(wireOf(container, 'c_3:c_4'))
    await screen.findByRole('button', { name: '删掉这条线' })
    // Now the board's card list changes under it and the first row stops being
    // drawn: a selection that remembered a slot or an index would have moved onto
    // nothing (or onto another line) and taken its button with it.
    const host = bench.boards.get(CANVAS_ID)!
    host.cards = host.cards.map(row => (row.id === 'c_1' ? { ...row, status: 'archived' as const } : row))
    rerender()
    await waitFor(() => {
      expect(wiresOf(container)).toBe(1)
    })
    expect(container.querySelector('[data-wire="c_1:c_2"]')).toBeNull()
    expect(screen.getByRole('button', { name: '删掉这条线' })).toBeTruthy()
    expect(pickedOf(container)).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: '删掉这条线' }))
    await waitFor(() => {
      expect(bench.mocks.setLayout).toHaveBeenCalledTimes(1)
    })
    // The write is the whole list minus the picked row — including the line that
    // is no longer DRAWN, which a view that rebuilt the list from what it
    // rendered would have silently dropped.
    expect(writeAt(bench.mocks, 0).links).toEqual([link('c_1', 'c_2')])
    await waitFor(() => {
      expect(wiresOf(container)).toBe(0)
    })
    expect(bench.mocks.patchCard).not.toHaveBeenCalled()
  })

  it('holds a picked line against a band, and gives it up only to a click on empty ground', async () => {
    const bench = makeHarness({
      boards: [board(CANVAS_ID, [card('c_1'), card('c_2'), card('c_3')], { links: [link('c_1', 'c_2')] })],
    })
    const container = await face(bench, 3)
    fireEvent.click(wireOf(container, 'c_1:c_2'))
    await screen.findByRole('button', { name: '删掉这条线' })
    // A thin band IS a band — it missed the 8px floor on one axis only — and it
    // caught no card (the nodes start at y 14, this one stopped at y 3), so the
    // line it did not click stays picked.
    drag(worldOf(container), { x: 0, y: 0 }, { x: 210, y: 3 })
    expect(screen.getByRole('button', { name: '删掉这条线' })).toBeTruthy()
    expect(pickedOf(container)).toEqual([])
    // A sub-8px flick in BOTH dimensions is a click on empty ground: the line
    // drops, and no card is picked or dropped either way.
    drag(worldOf(container), { x: 5, y: 5 }, { x: 7, y: 7 })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '删掉这条线' })).toBeNull()
    })
    expect(pickedOf(container)).toEqual([])
    expect(bench.mocks.setLayout).not.toHaveBeenCalled()
    expect(wiresOf(container)).toBe(1)
  })
})

describe('LinkView — box select', () => {
  it('a band from empty ground calls onAddSelection with exactly the ids it overlaps', async () => {
    const bench = makeHarness({
      boards: [board(CANVAS_ID, [card('c_1'), card('c_2'), card('c_far', { x: 900, y: 700 })])],
    })
    const container = await face(bench, 3)
    // The two auto-parked nodes are NODE.w wide from x 14 and x 198, so a band
    // 0..210 × 0..210 covers both — just barely the second one — and lets the
    // placed one alone. The catch lights up on the spot, with no toast to repeat it.
    drag(worldOf(container), { x: 0, y: 0 }, { x: 210, y: 210 })
    expect(pickedOf(container)).toEqual(['c_1', 'c_2'])
    expect(bench.mocks.setLayout).not.toHaveBeenCalled()
    expect(nodeOf(container, 'c_far').style.left).toBe('900px')
  })

  it('adds a band to what is already picked instead of replacing it', async () => {
    const bench = makeHarness({ boards: [board(CANVAS_ID, [card('c_1'), card('c_2'), card('c_far', { x: 900, y: 700 })])] })
    const container = await face(bench, 3)
    tap(nodeOf(container, 'c_far'))
    expect(pickedOf(container)).toEqual(['c_far'])
    drag(worldOf(container), { x: 0, y: 0 }, { x: 210, y: 210 })
    expect(pickedOf(container)).toEqual(['c_1', 'c_2', 'c_far'])
  })

  it('measures a band in world units, so a scrolled stage picks what is on screen', async () => {
    const bench = makeHarness({
      boards: [board(CANVAS_ID, [card('c_1', { x: 300, y: 60 }), card('c_2', { x: 14, y: 14 })])],
    })
    const container = await face(bench, 2)
    // Scrolled 200 right: the band's screen 0..210 is world 200..410, which
    // covers c_1 (300..480) and misses c_2 (14..194). A view that read the
    // pointer as screen units would answer the exact opposite — c_2 only.
    scrollStage(container, 200)
    drag(worldOf(container), { x: 0, y: 0 }, { x: 210, y: 210 })
    expect(pickedOf(container)).toEqual(['c_1'])
  })

  it('lets go of the picked line on a click that is not a band', async () => {
    const bench = makeHarness({
      boards: [board(CANVAS_ID, [card('c_1'), card('c_2')], { links: [link('c_1', 'c_2')] })],
    })
    const container = await face(bench, 2)
    fireEvent.click(wireOf(container, 'c_1:c_2'))
    await screen.findByRole('button', { name: '删掉这条线' })
    drag(worldOf(container), { x: 30, y: 30 }, { x: 34, y: 36 })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '删掉这条线' })).toBeNull()
    })
    expect(pickedOf(container)).toEqual([])
    expect(bench.mocks.setLayout).not.toHaveBeenCalled()
  })
})

describe('LinkView — lanes', () => {
  it('adds a lane as one write, unnamed, already open for its name, with an id the shared factory mints', async () => {
    const bench = makeHarness({
      boards: [board(CANVAS_ID, [card('c_1')], { lanes: [lane('lane_first', { x: 20, y: 40, w: 200, h: 200 }, '已有')] })],
    })
    const container = await face(bench, 1)
    expect(lanesOf(container)).toHaveLength(1)
    const before = Date.now()
    fireEvent.click(screen.getByRole('button', { name: '新分区' }))
    await waitFor(() => {
      expect(bench.mocks.setLayout).toHaveBeenCalledTimes(1)
    })
    const request = writeAt(bench.mocks, 0)
    expect(request.canvasId).toBe(CANVAS_ID)
    expect(request.positions).toBeUndefined()
    expect(request.links).toBeUndefined()
    expect(request.lanes).toHaveLength(2)
    expect(request.lanes![0]!.id).toBe('lane_first')
    const added = request.lanes![1]!
    expect(added.label).toBe('')
    // Born in the corner of what the user is looking at (jsdom: scrolled nowhere).
    expect(added).toMatchObject({ x: 24, y: 24, w: 190, h: 120 })
    // `makeBoardId('lane', …)`, not a hand-built string: the prefix, the 9-char
    // base36 time stamp (this minute), and the randomness the client drew — the
    // pinned 8 bytes, so the tail is exactly the mapped form the factory takes.
    expect(added.id.slice(0, 5)).toBe('lane_')
    const stamp = Number.parseInt(added.id.slice(5, 14), 36)
    expect(stamp).toBeGreaterThanOrEqual(before)
    expect(stamp).toBeLessThanOrEqual(Date.now())
    expect(added.id.slice(14)).toBe(MINT)
    expect(added.id).toBe(makeBoardId('lane', stamp, MINT))
    await waitFor(() => {
      expect(lanesOf(container)).toHaveLength(2)
    })
    expect(one(container, `[data-lane="${added.id}"]`)).toBeTruthy()
    // A brand-new lane is named right away: its rename field is already open —
    // that focus is the announcement, so no toast follows the gesture.
    expect((screen.getByRole('textbox', { name: '点标题改名' }) as HTMLInputElement).value).toBe('')
  })

  it('renames a lane through its title, as a lanes patch that moves no box and no card', async () => {
    const bench = makeHarness({
      boards: [board(CANVAS_ID, [card('c_1')], { lanes: [lane('lane_a', { x: 10, y: 30, w: 200, h: 200 }, '论点')] })],
    })
    const container = await face(bench, 1)
    expect(one(container, '[data-lane-title="lane_a"]').textContent).toBe('论点')
    fireEvent.click(one(container, '[data-lane-title="lane_a"]'))
    const input = screen.getByRole('textbox', { name: '点标题改名' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: '  反方论点  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => {
      expect(bench.mocks.setLayout).toHaveBeenCalledWith('s1', {
        canvasId: CANVAS_ID,
        lanes: [lane('lane_a', { x: 10, y: 30, w: 200, h: 200 }, '反方论点')],
      })
    })
    expect(bench.mocks.setLayout.mock.calls).toHaveLength(1)
    const request = writeAt(bench.mocks, 0)
    expect(request.positions).toBeUndefined()
    expect(request.links).toBeUndefined()
    expect(bench.mocks.patchCard).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(one(container, '[data-lane-title="lane_a"]').textContent).toBe('反方论点')
    })
    // The words the view shows are the trimmed ones, not what was typed.
    fireEvent.click(one(container, '[data-lane-title="lane_a"]'))
    const again = screen.getByRole('textbox', { name: '点标题改名' }) as HTMLInputElement
    expect(again.value).toBe('反方论点')
    // Blur commits too, but only when the words changed: this write must not happen.
    fireEvent.focusOut(again)
    expect(bench.mocks.setLayout.mock.calls).toHaveLength(1)
  })

  it('drags a lane and carries the cards it holds in the same write', async () => {
    const bench = makeHarness({
      boards: [board(CANVAS_ID, [card('c_1', { x: 60, y: 60 }), card('c_out', { x: 400, y: 300 })], {
        lanes: [lane('lane_a', { x: 10, y: 30, w: 220, h: 200 }, '论点A')],
      })],
    })
    const container = await face(bench, 2)
    // Membership is the card's CENTER: c_1's (150,90) is in the box, c_out's
    // (490,330) is not — so only one of them is the lane's to carry.
    expect(kindOf(container, 'c_1')).toBe('灵感 · 论点A')
    expect(kindOf(container, 'c_out')).toBe('灵感')
    drag(one(container, '[data-lane="lane_a"]'), { x: 20, y: 20 }, { x: 60, y: 50 })
    await waitFor(() => {
      expect(bench.mocks.setLayout).toHaveBeenCalledTimes(1)
    })
    const request = writeAt(bench.mocks, 0)
    // One write, both halves, and the carried card by the SAME +40/+30 delta.
    expect(request.lanes).toEqual([lane('lane_a', { x: 50, y: 60, w: 220, h: 200 }, '论点A')])
    expect(request.positions).toEqual([{ id: 'c_1', x: 100, y: 90 }])
    expect(request.links).toBeUndefined()
    await waitFor(() => {
      expect(nodeOf(container, 'c_out').style.left).toBe('400px')
    })
    expect(kindOf(container, 'c_1')).toBe('灵感 · 论点A')
  })

  it('tightens a lane drag on the group it carries, so nothing is left outside the stage', async () => {
    const bench = makeHarness({
      boards: [board(CANVAS_ID, [card('c_1', { x: 60, y: 60 })], {
        lanes: [lane('lane_a', { x: 10, y: 30, w: 220, h: 200 }, '论点A')],
      })],
    })
    const container = await face(bench, 1)
    // A shove up-left: the lane alone could only reach (0, 24) — its title band's
    // floor — while its card could only reach (0, 0). The tighter of the two wins
    // for the WHOLE group, so the pair moves as one and nothing is torn out.
    drag(one(container, '[data-lane="lane_a"]'), { x: 20, y: 20 }, { x: -980, y: -980 })
    await waitFor(() => {
      expect(bench.mocks.setLayout).toHaveBeenCalledTimes(1)
    })
    const request = writeAt(bench.mocks, 0)
    expect(request.lanes).toEqual([lane('lane_a', { x: 0, y: 24, w: 220, h: 200 }, '论点A')])
    expect(request.positions).toEqual([{ id: 'c_1', x: 50, y: 54 }])
    for (const position of request.positions!) {
      expect(position.x).toBeGreaterThanOrEqual(0)
      expect(position.y).toBeGreaterThanOrEqual(0)
      expect(position.x + NODE.w).toBeLessThanOrEqual(STAGE.w)
    }
    // And the carried card is still the lane's, by the emitted numbers themselves.
    await waitFor(() => {
      expect(kindOf(container, 'c_1')).toBe('灵感 · 论点A')
    })
  })

  it('pulls a lane corner as a lanes-only write, tracked at the top and floored at the minimum', async () => {
    const bench = makeHarness({
      boards: [board(CANVAS_ID, [card('c_1', { x: 60, y: 60 })], {
        lanes: [lane('lane_a', { x: 10, y: 30, w: 220, h: 200 }, '论点A')],
      })],
    })
    const container = await face(bench, 1)
    drag(one(container, '[data-lane-size="lane_a"]'), { x: 200, y: 200 }, { x: 250, y: 260 })
    await waitFor(() => {
      expect(bench.mocks.setLayout).toHaveBeenCalledTimes(1)
    })
    // +50/+60 on a 220×200 box, with the stage's ceiling (620-10 × 420-30) still
    // far away: a resize tracks the pointer.
    expect(writeAt(bench.mocks, 0).lanes).toEqual([lane('lane_a', { x: 10, y: 30, w: 270, h: 260 }, '论点A')])
    // A resize is its own gesture: it never carries the cards it uncovered.
    expect(writeAt(bench.mocks, 0).positions).toBeUndefined()
    await waitFor(() => {
      expect(one(container, '[data-lane="lane_a"]').style.width).toBe('270px')
    })
    // And a hard pull in cannot shrink it under the box where its title fits.
    drag(one(container, '[data-lane-size="lane_a"]'), { x: 200, y: 200 }, { x: -600, y: -600 })
    await waitFor(() => {
      expect(bench.mocks.setLayout).toHaveBeenCalledTimes(2)
    })
    expect(writeAt(bench.mocks, 1).lanes).toEqual([lane('lane_a', { x: 10, y: 30, w: 150, h: 80 }, '论点A')])
    expect(writeAt(bench.mocks, 1).positions).toBeUndefined()
  })

  it('answers a press on a lane title with no write at all', async () => {
    const bench = makeHarness({
      boards: [board(CANVAS_ID, [card('c_1', { x: 60, y: 60 })], {
        lanes: [lane('lane_a', { x: 10, y: 30, w: 220, h: 200 }, '论点A')],
      })],
    })
    const container = await face(bench, 1)
    // The title is the rename handle even under a drag: a press that travels from
    // it must neither move the lane nor write anything.
    drag(one(container, '[data-lane-title="lane_a"]'), { x: 20, y: 40 }, { x: 120, y: 140 })
    await settled()
    expect(bench.mocks.setLayout).not.toHaveBeenCalled()
    // And the same handle, clicked, opens the name field.
    fireEvent.click(one(container, '[data-lane-title="lane_a"]'))
    expect(screen.getByRole('textbox', { name: '点标题改名' })).toBeTruthy()
  })
})

describe('LinkView — the send set', () => {
  /** A two-card board with one line between them, and `c_1` clicked. */
  async function pickedPair(): Promise<{ bench: Harness; container: HTMLElement }> {
    const bench = makeHarness({
      boards: [board(CANVAS_ID, [card('c_1'), card('c_2')], { links: [link('c_1', 'c_2')] })],
    })
    const container = await face(bench, 2)
    tap(nodeOf(container, 'c_1'))
    return { bench, container }
  }

  it('sends what was clicked while 顺线扩一圈 is off, and marks nobody as an addition', async () => {
    const { container } = await pickedPair()
    // The whole info line, so a count landing in the wrong slot fails it.
    expect(await infoOf()).toBe(t('link.infoPlain', { count: '1' }))
    // Off means OFF: the graph adds nothing to the send set, and the cluster
    // marker — which exists to make an addition the user did not click visible —
    // is on nothing at all, least of all the card that was clicked.
    expect(clusteredOf(container)).toEqual([])
    expect(nodeOf(container, 'c_1').hasAttribute('data-picked')).toBe(true)
    expect(screen.queryByRole('button', { name: '与 Agent 对谈 · 2 张' })).toBeNull()
    expect(screen.getByRole('button', { name: '与 Agent 对谈 · 1 张' })).toBeTruthy()
  })

  it('closes the cluster over lines, takes one hop of lane mates, and stops at a lane mate reached through a line', async () => {
    const bench = makeHarness({
      boards: [board(CANVAS_ID, [
        card('c_1', { x: 10, y: 10 }), card('c_2', { x: 300, y: 10 }), card('c_3', { x: 30, y: 20 }),
        card('c_4', { x: 500, y: 10 }), card('c_5', { x: 700, y: 10 }),
      ], {
        // c_1 — c_2 — c_5: two lines, so the closure has to travel to reach c_5.
        links: [link('c_1', 'c_2'), link('c_2', 'c_5')],
        lanes: [
          lane('lane_a', { x: 0, y: 0, w: 250, h: 120 }, '甲'),
          lane('lane_b', { x: 250, y: 0, w: 400, h: 120 }, '乙'),
        ],
      })],
    })
    const { container } = await openLinkFace(bench, 5)
    tap(nodeOf(container, 'c_1'))
    expect(clusteredOf(container)).toEqual([])
    expect(await infoOf()).toBe(t('link.infoPlain', { count: '1' }))
    fireEvent.click(screen.getByRole('button', { name: '顺线扩一圈 关' }))
    // c_2 and c_5 join along the chain (c_5 only transitively) and c_3 joins as
    // the SEED's lane mate. c_4 — a lane mate of c_2, i.e. reachable only THROUGH
    // a line — does not: the one lane hop is counted from what the user clicked,
    // never from what the lines brought in, or one line would swallow a chapter.
    await waitFor(() => {
      expect(clusteredOf(container)).toEqual(['c_2', 'c_3', 'c_5'])
    })
    expect(nodeOf(container, 'c_1').hasAttribute('data-cluster')).toBe(false)
    expect(nodeOf(container, 'c_4').hasAttribute('data-cluster')).toBe(false)
    expect(nodeOf(container, 'c_4').hasAttribute('data-picked')).toBe(false)
    expect(await infoOf()).toBe(
      t('link.infoExpanded', { count: '4', seeds: '1', lines: '2', lanes: '1' }),
    )
    expect(screen.getByRole('button', { name: '顺线扩一圈 开' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '与 Agent 对谈 · 4 张' })).toBeTruthy()
  })

  /** The card ids a quote block names, in the order it names them. */
  const quotedIds = (block: string): string[] => [...block.matchAll(/\bc_\d+\b/g)].map(match => match[0])

  it('quotes the whole cluster into the input as one group, over the cards the line joined', async () => {
    const { bench } = await pickedPair()
    fireEvent.click(screen.getByRole('button', { name: '顺线扩一圈 关' }))
    fireEvent.click(await screen.findByRole('button', { name: '与 Agent 对谈 · 2 张' }))
    const [sessionId, block] = bench.mocks.quoteToConversation.mock.calls[0] as [string, string]
    expect(sessionId).toBe('s1')
    expect(new Set(quotedIds(block))).toEqual(new Set(['c_1', 'c_2']))
    expect(bench.mocks.setLayout).not.toHaveBeenCalled()
  })

  it('quotes the same set the bar counted for 开始写作, with the writing ask after it', async () => {
    const { bench, container } = await pickedPair()
    fireEvent.click(screen.getByRole('button', { name: '顺线扩一圈 关' }))
    await waitFor(() => {
      expect(clusteredOf(container)).toEqual(['c_2'])
    })
    fireEvent.click(await screen.findByRole('button', { name: '开始写作' }))
    const block = bench.mocks.quoteToConversation.mock.calls[0]?.[1] as string
    expect(new Set(quotedIds(block))).toEqual(new Set(['c_1', 'c_2']))
    expect(block).toContain(t('talk.writeText'))
  })

  it('writes over exactly the clicked card, while the line stays out of it', async () => {
    const { bench } = await pickedPair()
    fireEvent.click(await screen.findByRole('button', { name: '开始写作' }))
    const block = bench.mocks.quoteToConversation.mock.calls[0]?.[1] as string
    expect(new Set(quotedIds(block))).toEqual(new Set(['c_1']))
  })

  it('offers no send button with nothing picked, and none at all without the chat seam', async () => {
    const bench = makeHarness({ boards: [board(CANVAS_ID, [card('c_1')])], chatAvailable: false })
    const container = await face(bench, 1)
    // Nothing picked: the info line falls back to what the board itself holds.
    expect(await infoOf()).toContain('板上有')
    expect(screen.queryByRole('button', { name: /开始写作/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /与 Agent 对谈/ })).toBeNull()
    // The cards still pick on a board with no chat to send them to.
    tap(nodeOf(container, 'c_1'))
    expect(pickedOf(container)).toEqual(['c_1'])
    expect(screen.queryByRole('button', { name: /开始写作/ })).toBeNull()
  })

  it('forgets the expansion with the selection, and retires the clear button with nothing left to clear', async () => {
    const { container } = await pickedPair()
    fireEvent.click(screen.getByRole('button', { name: '顺线扩一圈 关' }))
    await waitFor(() => {
      expect(clusteredOf(container)).toEqual(['c_2'])
    })
    fireEvent.click(screen.getByRole('button', { name: '取消选择' }))
    // The highlight went, nothing else: the line is still on the board, the
    // info line falls back to the board's own totals, and with nothing left to
    // clear the button itself is gone.
    expect(await infoOf()).toContain('板上有')
    expect(screen.getByRole('button', { name: '顺线扩一圈 关' })).toBeTruthy()
    expect(clusteredOf(container)).toEqual([])
    expect(wiresOf(container)).toBe(1)
    expect(screen.queryByRole('button', { name: '取消选择' })).toBeNull()
  })
})

describe('LinkView — the detail openings', () => {
  it('opens on the pen button and on a double click, never on a plain press', async () => {
    const bench = makeHarness({ boards: [board(CANVAS_ID, [card('c_1'), card('c_2')])] })
    const container = await face(bench, 2)
    // The pen sits inside the node: pressing it must not become a drag, and
    // clicking it must open without picking.
    const pen = one<HTMLElement>(container, '[data-open="c_1"]')
    fireEvent.pointerDown(pen, { pointerId: 1, clientX: 10, clientY: 10, button: 0 })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 400, clientY: 400 })
    fireEvent.click(pen)
    expect(bench.mocks.openCardDetail.mock.calls.map(call => call.slice(0, 2))).toEqual([[CANVAS_ID, 'c_1']])
    expect(pickedOf(container)).toEqual([])
    expect(bench.mocks.setLayout).not.toHaveBeenCalled()
    fireEvent.doubleClick(nodeOf(container, 'c_2'))
    await waitFor(() => {
      expect(bench.mocks.openCardDetail.mock.calls.map(call => call.slice(0, 2))).toEqual([
        [CANVAS_ID, 'c_1'], [CANVAS_ID, 'c_2'],
      ])
    })
    expect(bench.mocks.setLayout).not.toHaveBeenCalled()
    // A plain press on the body still only picks, however far it travels.
    tap(nodeOf(container, 'c_2'))
    expect(pickedOf(container)).toEqual(['c_2'])
    expect(bench.mocks.openCardDetail.mock.calls).toHaveLength(2)
  })
})

describe('LinkView — read-only', () => {
  /** A board with no session to fence writes, wired for the whole stage. */
  function readOnly(): Harness {
    return makeHarness({
      sessionId: 'none',
      boards: [board(CANVAS_ID, [card('c_1'), card('c_2')], {
        links: [link('c_1', 'c_2')],
        lanes: [lane('lane_a', { x: 10, y: 30, w: 220, h: 200 }, '论点')],
      })],
    })
  }

  it('offers no handle that could ask for a write', async () => {
    const bench = readOnly()
    const container = await face(bench, 2)
    expect(one(container, '[data-readonly]')).toBeTruthy()
    // No port on a node, no corner on a lane, no ＋分区 — and the board still
    // reads, lane words and all.
    expect(container.querySelectorAll('[data-port]')).toHaveLength(0)
    expect(container.querySelectorAll('[data-lane-size]')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: '新分区' })).toBeNull()
    expect(kindOf(container, 'c_1')).toBe('灵感 · 论点')
    // A line can still be looked at, but there is no delete button to press, so
    // there is no way to ask for the write.
    fireEvent.click(wireOf(container, 'c_1:c_2'))
    expect(screen.queryByRole('button', { name: '删掉这条线' })).toBeNull()
    // Renaming is a write too: the title answers with nothing.
    fireEvent.click(one(container, '[data-lane-title="lane_a"]'))
    expect(screen.queryByRole('textbox', { name: '点标题改名' })).toBeNull()
    expect(bench.mocks.setLayout).not.toHaveBeenCalled()
  })

  it('mutes every write path, and keeps the picking that a read needs', async () => {
    const bench = readOnly()
    const container = await face(bench, 2)
    // A card drag: no placement, and the stage hands the press to the pick —
    // 「与 Agent 对谈」 needs a selection even on a board that cannot be written.
    drag(nodeOf(container, 'c_1'), { x: 10, y: 10 }, { x: 90, y: 90 })
    expect(pickedOf(container)).toEqual(['c_1'])
    drag(one(container, '[data-lane="lane_a"]'), { x: 20, y: 40 }, { x: 80, y: 120 })
    drag(one(container, '[data-lane-title="lane_a"]'), { x: 20, y: 40 }, { x: 80, y: 120 })
    drag(worldOf(container), { x: 0, y: 0 }, { x: 210, y: 210 })
    expect(pickedOf(container)).toEqual(['c_1', 'c_2'])
    expect(nodeOf(container, 'c_1').style.left).toBe(`${grid(0).x}px`)
    expect(one(container, '[data-lane="lane_a"]').style.left).toBe('10px')
    await settled()
    expect(bench.mocks.setLayout).not.toHaveBeenCalled()
    expect(bench.mocks.patchCard).not.toHaveBeenCalled()
    // Nothing was moved and nothing was deleted: 取消选择 is still only a highlight.
    fireEvent.click(screen.getByRole('button', { name: '取消选择' }))
    await waitFor(() => {
      expect(pickedOf(container)).toEqual([])
    })
    expect(wiresOf(container)).toBe(1)
    // The read side is untouched: the pen still hands the host an address.
    fireEvent.doubleClick(nodeOf(container, 'c_1'))
    await waitFor(() => {
      expect(bench.mocks.openCardDetail).toHaveBeenCalled()
    })
  })
})
