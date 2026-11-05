// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RelationsView } from '../src/client/RelationsView.tsx'
import { relationViewBox } from '../src/client/relation-history.ts'
import type { NovelCodexResult } from '../src/types.ts'
import { zh } from '../src/client/locales.ts'
import type { NovelSurfaceProps } from '../src/client/contract.ts'

const t = ((key: keyof typeof zh, params?: Record<string, string | number>) => zh[key].replace(/\{(\w+)\}/g, (match, name) => String(params?.[name] ?? match))) as NovelSurfaceProps['t']
const data: NovelCodexResult = {
  ok: true, current: 3,
  characters: [
    { cardId: 'c1', name: '霍赢', factions: [], homes: [], beliefs: [], secrets: [], chapters: [1] },
    { cardId: 'c2', name: '于心', factions: [], homes: [], beliefs: [], secrets: [], chapters: [1] },
    { cardId: 'c3', name: '林澜', factions: [], homes: [], beliefs: [], secrets: [], chapters: [2] },
  ],
  relations: [
    { cardId: 'r1', pair: ['c1', 'c2'], type: '同盟', stage: '合作', steps: [
      { chapter: 1, kind: 'stage', event: 'start', stage: '接触', level: 1, label: '确立', evidence: '一起创业。' },
      { chapter: 2, kind: 'stage', event: 'up', stage: '合作', level: 2, label: '进入合作', evidence: '完成分工。' },
    ] },
    { cardId: 'r2', pair: ['c2', 'c3'], type: '友情', stage: '信任', steps: [
      { chapter: 2, kind: 'stage', event: 'start', stage: '信任', level: 2, label: '确立' },
    ] },
  ],
}

afterEach(() => { cleanup(); window.localStorage.clear() })

function mockSvgCoordinates(svg: SVGSVGElement): void {
  Object.defineProperty(svg, 'getScreenCTM', { value: () => ({ inverse: () => ({}) }) })
  Object.defineProperty(svg, 'createSVGPoint', { value: () => {
    const point = { x: 0, y: 0, matrixTransform: () => ({ x: point.x, y: point.y }) }
    return point
  } })
  Object.defineProperty(svg, 'setPointerCapture', { value: vi.fn() })
}

function circleOf(name: string): SVGCircleElement {
  return screen.getByRole('button', { name }).querySelector('circle')!
}

describe('relations view', () => {
  it('filters around a person and replays the selected chapter in graph, list and detail', () => {
    render(<RelationsView data={data} del={() => null} openCard={vi.fn()} canvasId="canvas" t={t} />)
    expect(screen.getByText('确立', { selector: 'ol b' })).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('button', { name: '霍赢' }), { key: 'Enter' })
    expect(screen.getByText(zh['relation.centered'].replace('{name}', '霍赢').replace('{count}', '1'))).toBeTruthy()
    expect(screen.queryByText('于心 × 林澜')).toBeNull()
    fireEvent.change(screen.getByRole('slider'), { target: { value: '1' } })
    expect(screen.getAllByText('同盟 · 接触').length).toBeGreaterThan(0)
    expect(screen.queryByText('同盟 · 合作')).toBeNull()
    expect(screen.getByText('一起创业。')).toBeTruthy()
    expect(screen.queryByText('完成分工。')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['relation.list'] }))
    expect(document.querySelector('svg')).toBeNull()
    fireEvent.change(screen.getByRole('slider'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: zh['relation.clear'] }))
    expect(screen.getByText('于心 × 林澜')).toBeTruthy()
  })

  it('defaults to the list for a crowded graph', () => {
    const crowded: NovelCodexResult = {
      ...data,
      characters: Array.from({ length: 13 }, (_, index) => ({ cardId: `p${index}`, name: `人物${index}`, factions: [], homes: [], beliefs: [], secrets: [], chapters: [1] })),
      relations: Array.from({ length: 12 }, (_, index) => ({ cardId: `r${index}`, pair: [`p${index}`, `p${index + 1}`], type: '同盟', stage: '接触', steps: [{ chapter: 1, kind: 'stage' as const, event: 'start' as const, stage: '接触', level: 1, label: '确立' }] })),
    }
    render(<RelationsView data={crowded} del={() => null} openCard={vi.fn()} canvasId="crowded" t={t} />)
    expect(document.querySelector('svg')).toBeNull()
    expect(screen.getByRole('button', { name: zh['relation.list'], pressed: true })).toBeTruthy()
  })

  it('drags a node, saves its position and restores it after a remount', async () => {
    const first = render(<RelationsView data={data} del={() => null} openCard={vi.fn()} canvasId="canvas" t={t} />)
    const svg = document.querySelector('svg')!
    mockSvgCoordinates(svg)
    expect(circleOf('霍赢').getAttribute('cx')).toBe('100')
    fireEvent.pointerDown(screen.getByRole('button', { name: '霍赢' }), { pointerId: 1, clientX: 100, clientY: 160 })
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 140, clientY: 190 })
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 140, clientY: 190 })
    expect(circleOf('霍赢').getAttribute('cx')).toBe('140')
    expect(Number(circleOf('霍赢').getAttribute('cy'))).toBeCloseTo(190, 8)
    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem('novel-relations:canvas')!)
      expect(saved.c1.x).toBe(140)
      expect(saved.c1.y).toBeCloseTo(190, 8)
    })
    first.unmount()
    render(<RelationsView data={data} del={() => null} openCard={vi.fn()} canvasId="canvas" t={t} />)
    expect(circleOf('霍赢').getAttribute('cx')).toBe('140')
    expect(Number(circleOf('霍赢').getAttribute('cy'))).toBeCloseTo(190, 8)
  })

  it('pans the background, zooms on wheel and resets both view and saved layout', () => {
    render(<RelationsView data={data} del={() => null} openCard={vi.fn()} canvasId="canvas" t={t} />)
    const svg = document.querySelector('svg')!
    mockSvgCoordinates(svg)
    fireEvent.pointerDown(svg, { pointerId: 2, clientX: 200, clientY: 160 })
    fireEvent.pointerMove(svg, { pointerId: 2, clientX: 220, clientY: 170 })
    fireEvent.pointerUp(svg, { pointerId: 2, clientX: 220, clientY: 170 })
    expect(svg.getAttribute('viewBox')).toBe(relationViewBox(1, { x: 260, y: 150 }))
    fireEvent.wheel(svg, { deltaY: -100 })
    expect(svg.getAttribute('viewBox')).toBe(relationViewBox(1.15, { x: 260, y: 150 }))
    fireEvent.click(screen.getByRole('button', { name: zh['relation.reset'] }))
    expect(svg.getAttribute('viewBox')).toBe('0 0 560 320')
    expect(circleOf('霍赢').getAttribute('cx')).toBe('100')
    expect(JSON.parse(window.localStorage.getItem('novel-relations:canvas')!)).toEqual({})
  })

  it('keeps labels on hover / selection, the graph sticky and the relation list independently scrollable', () => {
    render(<RelationsView data={data} del={() => null} openCard={vi.fn()} canvasId="canvas" t={t} />)
    const first = screen.getByText('同盟 · 合作', { selector: 'svg text' }).parentElement!
    const second = screen.getByText('友情 · 信任', { selector: 'svg text' }).parentElement!
    expect(first.getAttribute('data-picked')).toBe('true')
    expect(second.getAttribute('data-picked')).toBeNull()
    fireEvent.click(second)
    expect(first.getAttribute('data-picked')).toBeNull()
    expect(second.getAttribute('data-picked')).toBe('true')
    fireEvent.keyDown(screen.getByRole('button', { name: '霍赢' }), { key: 'Enter' })
    expect(screen.getByRole('button', { name: '霍赢' }).getAttribute('data-center')).toBe('true')
    expect(screen.queryByText('于心 × 林澜')).toBeNull()
    const css = readFileSync('src/client/codex.module.css', 'utf8')
    expect(css).toContain('.edge:hover .edgeLabel, .edge[data-picked] .edgeLabel { opacity: 1; }')
    expect(css).toMatch(/\.graphPane \{ position: sticky;/)
    expect(css).toMatch(/\.relList \{[^}]*max-height: 430px; overflow-y: auto;/)
  })
})
