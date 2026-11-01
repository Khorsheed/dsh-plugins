// @vitest-environment jsdom
/**
 * The one conversation card: the model reads an answer's destination and hides
 * the line; the compact line opens the destination; a mode's body takes over
 * when it has one; the Turn tail folds a Turn's writes, latest per place.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { destinationLine } from '../src/destination.ts'
import { DestinationToolRow, DestinationTurnTail, destinationTurnDefinition, registerDestinationCards, SummaryCard, toolCardModel, turnCardItems, type CardCopy } from '../src/client/card.tsx'
import { act } from '@testing-library/react'
import { navRegistry, updateCards } from '../src/client/follow.ts'

afterEach(() => { cleanup() })

const dest = { id: 'd1', kind: 'library', params: { projectId: 'p1', nodeId: 'n1', view: 'lesson' }, label: '第 2 站讲义' }
const answer = (text: string) => ({ kind: 'tool-result', content: [{ type: 'text', text: `${text}\n${destinationLine(dest)}` }] })
const copy: CardCopy = { kind: '图书馆', running: '进行中…', failed: '没写成', open: '查看 →' }

describe('toolCardModel', () => {
  it('is running until settled, failed on an error, and otherwise names its destination without showing the line', () => {
    expect(toolCardModel({}).state).toBe('running')
    expect(toolCardModel({ kind: 'tool-result', content: [{ type: 'text', text: '失败：没有这一站' }] }).state).toBe('failed')
    expect(toolCardModel({ kind: 'tool-result', isError: true, content: [{ type: 'text', text: 'x' }] }).state).toBe('failed')
    const model = toolCardModel(answer('讲义已写好'))
    expect(model).toEqual({ state: 'done', text: '讲义已写好', destination: dest })
  })
})

describe('DestinationToolRow', () => {
  it('is one line whose door opens the destination', () => {
    const go = vi.fn()
    render(<DestinationToolRow block={answer('讲义已写好')} copy={() => copy} go={() => go} />)
    expect(screen.getByText('第 2 站讲义')).toBeTruthy()
    fireEvent.click(screen.getByText('查看 →'))
    expect(go).toHaveBeenCalledWith(dest)
    cleanup()
    render(<DestinationToolRow block={{}} phase="preparing" copy={() => copy} go={() => go} />)
    expect(screen.getByText('进行中…')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('the Turn tail', () => {
  it('folds a Turn\'s writes of its tools, latest per place, and renders them as cards', () => {
    const definition = destinationTurnDefinition('lib/cards', ['library_notes'])
    const ev = (type: string, seq: number, data: unknown, surfaceOp?: string) => ({ type, seq, data, ...(surfaceOp === undefined ? {} : { surfaceOp }) })
    let state = definition.start(undefined, { event: ev('turn/start', 1, { turn: 3 }) })
    const step = (event: ReturnType<typeof ev>) => { if (definition.match(event) !== null) state = definition.update({ state }, { event }) }
    step(ev('tool/call', 2, { turn: 3, callId: 'a', name: 'library_notes' }))
    step(ev('tool/result', 3, { turn: 3, message: { source: { callId: 'a' }, content: answer('第一版').content } }, 'append'))
    step(ev('tool/call', 4, { turn: 3, callId: 'b', name: 'other_tool' }))
    step(ev('tool/result', 5, { turn: 3, message: { source: { callId: 'b' }, content: answer('别人').content } }, 'append'))
    step(ev('tool/call', 6, { turn: 3, callId: 'c', name: 'library_notes' }))
    step(ev('tool/result', 7, { turn: 3, message: { source: { callId: 'c' }, content: answer('第二版').content } }, 'append'))
    const data = definition.buildLocationData({ state }, 'turn', null)!
    const owner = { turn: { data: { get: (key: string) => key === 'lib/cards' ? data.value : undefined }, end: { seq: 20 } } }
    expect(turnCardItems(owner, 'lib/cards').map(item => item.model.text)).toEqual(['第二版'])
    const go = vi.fn()
    render(<DestinationTurnTail {...owner} turnKey="lib/cards" copy={() => copy} go={() => go} />)
    fireEvent.click(screen.getByText('查看 →'))
    expect(go).toHaveBeenCalledWith(dest)
  })
})

describe('registerDestinationCards', () => {
  it('seats a row per tool and the Turn tail, or the rows only when the mode has its own Turn summary', () => {
    const seen: string[] = []
    const slots = {
      inject: (key: string, callback: () => () => void) => { seen.push(key); callback(); return () => {} },
      register: () => () => {},
    }
    const conversation = () => ({ events: { register: () => () => {} } })
    const face = () => ({ copy: () => copy, go: () => undefined })
    registerDestinationCards(body => { body() }, slots, conversation, { owner: 'o', tools: ['a', 'b'], face })
    expect(seen).toEqual(['tool.call.toolview', 'tool.call.toolview', 'conversation.chat.turnTail'])
    seen.length = 0
    registerDestinationCards(body => { body() }, slots, conversation, { owner: 'o', tools: ['a'], face, turnTail: false })
    expect(seen).toEqual(['tool.call.toolview'])
  })
})

describe('the card data a plugin hands', () => {
  const plan = { id: 'p3', kind: 'canvas', params: { canvasId: 'c1', face: 'manuscripts', item: '3', focus: 'plan' }, label: '第 3 章《雨夜》计划',
    card: { status: '等你确认', awaiting: true, door: '查看并确认计划 →' } }
  const block = { kind: 'tool-result', content: [{ type: 'text', text: `已登记\n${destinationLine(plan)}` }] }

  it('a replayed card shows only its label and the plain door; a live one shows the status, and updateCards moves it', () => {
    const registry = navRegistry()
    registry.live.clear(); registry.patches.clear()
    render(<DestinationToolRow block={block} copy={() => copy} go={() => vi.fn()} />)
    expect(screen.queryByText('等你确认')).toBeNull()
    expect(screen.getByText('查看 →')).toBeTruthy()
    // What the follower does when the write arrives live (then any no-op update re-renders).
    act(() => { registry.live.set(plan.id, plan as never); updateCards('canvas', {}, {}) })
    expect(screen.getByText('等你确认')).toBeTruthy()
    expect(screen.getByText('查看并确认计划 →')).toBeTruthy()
    act(() => { expect(updateCards('canvas', { canvasId: 'c1', item: '3', focus: 'plan' }, { status: '已确认', awaiting: false, door: '查看计划 →' })).toBe(1) })
    expect(screen.getByText('已确认')).toBeTruthy()
    expect(screen.getByText('查看计划 →')).toBeTruthy()
    expect(updateCards('canvas', { item: '4' }, { status: 'x' })).toBe(0)
  })

  it('a summary card is one line per change, each with its door', () => {
    const go = vi.fn()
    render(<SummaryCard copy={copy} go={go} summary={{ title: '本轮改动 · 《灯塔》', rows: [{ label: '元素「九尾狐」外观', destination: dest }, { label: '测试通过' }] }} />)
    expect(screen.getByText('本轮改动 · 《灯塔》')).toBeTruthy()
    expect(screen.getAllByText('查看 →')).toHaveLength(1)
    fireEvent.click(screen.getByText('查看 →'))
    expect(go).toHaveBeenCalledWith(dest)
  })
})
