// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RelationsView } from '../src/client/RelationsView.tsx'
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

afterEach(cleanup)

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
})
