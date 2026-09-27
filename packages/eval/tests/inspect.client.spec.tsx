// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ItemDrawer, promptParts, tabFiles, type ItemInspectFaces } from '../src/client/Inspect.tsx'
import type { EvalItemMaterialsView } from '../src/types.ts'

afterEach(() => { cleanup() })

const t = (key: string, params?: Record<string, unknown>): string => (
  params === undefined ? key : `${key} ${JSON.stringify(params)}`
)

const VIEW: EvalItemMaterialsView = {
  experimentId: 'e', item: 'F2', dataset: 'ds', commit: 'abcdef0123456789', title: 'room',
  phases: ['stage1', 'stage2', 'stage3'], runStages: ['stage1', 'stage2'],
  files: [
    { tab: 'task', source: 'item', layer: 'visible', path: 'task.md' },
    { tab: 'stages', source: 'dataset', layer: 'visible', path: 'prompts/stage1.md' },
    { tab: 'probes', source: 'item', layer: 'verify', path: 'probes/a.mjs' },
    { tab: 'reference', source: 'item', layer: 'grading', path: 'oracle/notes.md' },
  ],
  rubric: {
    path: 'rubric.yml',
    rows: [
      { id: 'A1', kind: 'llm-draft', weight: 3, negative: false, veto: false, criterion: 'design', evidence: 'stage1.md', stages: ['stage1'], inScope: true },
      { id: 'C1', kind: 'objective', weight: 18, negative: false, veto: false, criterion: 'core', evidence: 'verify.json', stages: ['stage3'], inScope: false },
    ],
  },
  notes: [],
}

function faces(): ItemInspectFaces {
  return {
    materials: vi.fn(async () => ({ ok: true as const, value: VIEW })),
    file: vi.fn(async request => ({
      ok: true as const,
      value: {
        experimentId: 'e', item: request.item, layer: request.layer, path: request.path, commit: VIEW.commit,
        kind: 'text' as const, truncated: false, bytes: 10, text: `body of ${request.path}`, note: null,
      },
    })),
    preview: null,
  }
}

describe('item drawer (T84 §三)', () => {
  it('opens on 题面, names the pinned commit, and greys the leaves this run does not score', async () => {
    const f = faces()
    render(<ItemDrawer item="F2" faces={f} onClose={() => {}} t={t} />)
    expect(await screen.findByText(/inspect\.pinned.*abcdef01/)).toBeTruthy()
    expect(await screen.findByText(/inspect\.who\.task/)).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: /inspect\.tab\.stages/ }))
    expect(await screen.findByText('inspect.shared')).toBeTruthy()
    // A set-level prompt is read without an item id.
    expect(f.file).toHaveBeenLastCalledWith({ item: null, source: 'dataset', layer: 'visible', path: 'prompts/stage1.md' })
    fireEvent.click(screen.getByRole('radio', { name: /inspect\.tab\.rubric/ }))
    const out = await screen.findByText('inspect.rubric.out')
    expect(out.closest('tr')?.hasAttribute('data-out')).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: /inspect\.tab\.reference/ }))
    expect(await screen.findByText('inspect.who.reference')).toBeTruthy()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<ItemDrawer item="F2" faces={faces()} onClose={onClose} t={t} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})

describe('judge prompt parts (T84 §四)', () => {
  it('splits on the headings the judge prompt builder writes', () => {
    const parts = promptParts('# 盲评任务\nfixed\n\n## 判据（共 1 条）\n- A1\n\n## 材料\nx\n\n## 输出要求\njson')
    expect(parts.map(p => p.kind)).toEqual(['fixed', 'criteria', 'materials', 'output'])
    expect(parts[1]?.pieces).toEqual([{ kind: 'text', text: '## 判据（共 1 条）\n- A1' }])
    expect(promptParts('no headings').map(p => p.kind)).toEqual(['fixed'])
  })

  it('keeps the preview\'s material slots as slots, outside any text (T85)', () => {
    const parts = promptParts([
      { kind: 'text', text: '# 盲评任务\n\n## 材料\n\n### stage1.md\n' },
      { kind: 'material', path: 'stage1.md' },
      { kind: 'text', text: '\n## 输出要求\njson\n' },
    ])
    expect(parts.map(p => p.kind)).toEqual(['fixed', 'materials', 'output'])
    expect(parts[1]?.pieces).toEqual([
      { kind: 'text', text: '## 材料\n\n### stage1.md' },
      { kind: 'material', path: 'stage1.md' },
    ])
  })
})

describe('tab file order', () => {
  it('puts task.md first, then the item own files (markdown first) before set-level files, else stable', () => {
    const f = (path: string, source: 'item' | 'dataset' = 'item') => ({ tab: 'task' as const, source, layer: 'visible' as const, path })
    const files = [f('standards.yml'), f('notes.md', 'dataset'), f('extra.md'), f('task.md'), f('b.json')]
    expect(tabFiles(files, 'task').map(x => x.path)).toEqual(['task.md', 'extra.md', 'standards.yml', 'b.json', 'notes.md'])
  })
})
