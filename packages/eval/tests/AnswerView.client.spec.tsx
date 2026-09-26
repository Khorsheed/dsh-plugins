// @vitest-environment jsdom
/**
 * I5·T75 — the answer view component: the blind switch swaps names for
 * letters and folds 过程 away; a quoted paragraph carries its verdict; the
 * evidence view lists every criterion with its reasons and the script output
 * verbatim; the scoring face locks the blind on and puts its form first.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { AnswerView } from '../src/client/AnswerView.tsx'
import { rowsOfSheet } from '../src/client/answer-view.ts'
import type { EvalAnswerSheet } from '../src/types.ts'

afterEach(cleanup)

const t = (key: string, params?: Record<string, unknown>) => (
  params === undefined ? key : `${key} ${JSON.stringify(params)}`
)

const SHEET: EvalAnswerSheet = {
  runId: 'run-1',
  task: 'P0',
  criteria: [{ id: 'H1', criterion: '读得懂', evidence: null, weight: null, negative: false, veto: false, note: null }],
  criteriaNote: null,
  notes: [],
  cells: [
    {
      missionId: 'm-lean', condition: 'dsh-lean', rep: 1, cellNo: 1, attempt: 1, state: 'archived', bucket: 'done',
      reports: [{ name: 'stage1.md', text: '# 方案\n\n结论是可以合并。', truncated: false, bytes: 10, note: null }],
      verdicts: [
        { criterion: 'D1', ns: 'llm-draft', pass: true, evidence: '原文「结论是可以合并」', judge: '判官 A', sample: 1, at: 1 },
        { criterion: 'X1', ns: 'script', pass: false, evidence: 'git status 不干净', judge: null, sample: null, at: 1 },
      ],
      scripts: [{ at: 1, where: 'host', raw: '{"kind":"probes"}', probes: [] }],
      childSessionId: 'child-lean', parentSessionId: 'parent',
    },
    {
      missionId: 'm-full', condition: 'dsh-full', rep: 1, cellNo: 2, attempt: 1, state: 'archived', bucket: 'done',
      reports: [], verdicts: [], scripts: [], childSessionId: null, parentSessionId: 'parent',
    },
  ],
}

function renderView(extra: Partial<Parameters<typeof AnswerView>[0]> = {}) {
  const onOpenSession = vi.fn()
  render(
    <AnswerView
      task="P0"
      rows={rowsOfSheet(SHEET, { condition: 'dsh-full', rep: null })}
      criteria={SHEET.criteria}
      criteriaNote={null}
      notes={[]}
      scoring={null}
      rep={1}
      onOpenSession={onOpenSession}
      onBack={null}
      onRejudge={null}
      t={t as never}
      {...extra}
    />,
  )
  return { onOpenSession }
}

describe('the answer view', () => {
  it('names the groups, marks the one the entry named, and hangs the quoted verdict under its paragraph', () => {
    const { onOpenSession } = renderView()
    expect(screen.getByText('dsh-lean')).toBeTruthy()
    expect(screen.getByText('dsh-full')).toBeTruthy()
    const located = document.querySelectorAll('[data-located="true"][data-part="head"]')
    expect(located).toHaveLength(1)
    expect(within(located[0] as HTMLElement).getByText('dsh-full')).toBeTruthy()
    // The quoted paragraph carries D1; X1 quotes nothing and hangs nowhere.
    const hung = document.querySelectorAll('[class*="hung"]')
    expect(hung).toHaveLength(1)
    expect((hung[0] as HTMLElement).textContent).toContain('D1')
    // The group that did not submit keeps its stage slot.
    expect(screen.getByText(/answer.stageMissing/)).toBeTruthy()
    // The file name rides on the card head (v5), not above the text; no
    // 阶段 N line either — the report's own headings carry the stages.
    expect(within(document.querySelector('[data-part="head"]') as HTMLElement).getByText('stage1.md')).toBeTruthy()
    expect(document.querySelectorAll('[data-part="reports"] [class*="docBanner"]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-part="reports"] [class*="stageTitle"]')).toHaveLength(0)
    // 过程 is a tab (T83 · v5 subtabs), one 打开选手会话 per column.
    fireEvent.click(screen.getByRole('tab', { name: 'answer.process' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'answer.processOpen' })[0]!)
    expect(onOpenSession).toHaveBeenCalledWith('child-lean', 'parent')
  })

  it('shows 代码改动 as a tab with an empty state, never hides it (T83)', () => {
    renderView()
    const tabs = screen.getAllByRole('tab').map(node => node.textContent)
    expect(tabs).toEqual(['answer.viewReport', 'answer.viewDiff', 'answer.process', 'answer.viewEvidence'])
    fireEvent.click(screen.getByRole('tab', { name: 'answer.viewDiff' }))
    expect(screen.getByText('answer.diffNone')).toBeTruthy()
  })

  it('单份 shows one column at a time, picked from the same bar (T83)', () => {
    renderView()
    fireEvent.click(screen.getByRole('radio', { name: 'answer.single' }))
    // The located column (dsh-full) is the one it opens on.
    const heads = () => [...document.querySelectorAll('[data-part="head"]')].map(node => node.textContent)
    expect(heads()).toHaveLength(1)
    expect(heads()[0]).toContain('dsh-full')
    fireEvent.click(screen.getByRole('radio', { name: 'dsh-lean' }))
    expect(heads()).toHaveLength(1)
    expect(heads()[0]).toContain('dsh-lean')
  })

  it('blind swaps names for seeded letters and folds 过程 away', () => {
    renderView()
    fireEvent.click(screen.getByText('answer.blind'))
    expect(screen.queryByText('dsh-lean')).toBeNull()
    expect(screen.queryByText('dsh-full')).toBeNull()
    expect(screen.getByText('answer.blindName {"letter":"A"}')).toBeTruthy()
    expect(screen.getByText('answer.blindName {"letter":"B"}')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'answer.process' }))
    expect(screen.getAllByText('answer.processBlind')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'answer.processOpen' })).toBeNull()
    expect(document.querySelectorAll('[data-located="true"]')).toHaveLength(0)
    fireEvent.click(screen.getByText('answer.names'))
    expect(screen.getByText('dsh-lean')).toBeTruthy()
  })

  it('the evidence view lists each criterion with its reasons, and the script output verbatim', () => {
    renderView()
    fireEvent.click(screen.getByText('answer.viewEvidence'))
    expect(screen.getAllByText('H1')).toHaveLength(2)
    // dsh-lean was judged on D1 only, so H1 says 未判 on its own row;
    // dsh-full was judged on nothing and says so once (T80c P2-10).
    expect(screen.getAllByText('answer.unjudged')).toHaveLength(1)
    expect(screen.getByText('answer.noneJudged {"count":3}')).toBeTruthy()
    expect(screen.getByText('git status 不干净')).toBeTruthy()
    expect(screen.getByText('原文「结论是可以合并」')).toBeTruthy()
    expect(screen.getByText('answer.quoteAt {"file":"stage1.md","no":2}')).toBeTruthy()
    expect(screen.getByText('{"kind":"probes"}')).toBeTruthy()
    expect(screen.getByText('answer.noScripts')).toBeTruthy()
  })

  it('the scoring face locks the blind on and renders its form above the folded reports', () => {
    renderView({ scoring: column => <div data-testid="form">{column.letter}</div>, onOpenSession: null })
    expect(screen.queryByText('dsh-lean')).toBeNull()
    // Locked blind: no names switch and no tabs — the reports only (T83).
    expect(screen.queryByText('answer.names')).toBeNull()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.getByText('answer.blindScoring')).toBeTruthy()
    expect(screen.getAllByTestId('form').map(node => node.textContent)).toEqual(['A', 'B'])
    const parts = [...document.querySelectorAll('[data-part]')].map(node => node.getAttribute('data-part'))
    expect(parts.indexOf('scoring')).toBeLessThan(parts.indexOf('reports'))
    expect(document.querySelector('[data-part="reports"] details')).not.toBeNull()
  })

  it('a script-only column says so once and offers 补判, keeping the other column level (T80c P2-10)', () => {
    const scriptOnly: EvalAnswerSheet = {
      ...SHEET,
      cells: SHEET.cells.map(cell => cell.condition === 'dsh-full'
        ? { ...cell, verdicts: [{ criterion: 'X1', ns: 'script', pass: true, evidence: 'ok', judge: null, sample: null, at: 1 }] }
        : cell),
    }
    const onRejudge = vi.fn()
    renderView({ rows: rowsOfSheet(scriptOnly, { condition: 'dsh-full', rep: null }), onRejudge })
    fireEvent.click(screen.getByText('answer.viewEvidence'))
    const summary = screen.getByText('answer.scriptOnly {"count":2}').closest('[role="note"]') as HTMLElement
    fireEvent.click(within(summary).getByRole('button', { name: 'judge.rejudge' }))
    expect(onRejudge).toHaveBeenCalledWith(expect.objectContaining({ condition: 'dsh-full' }))
    // Its X1 verdict still shows; its other unjudged row is an empty slot.
    expect(screen.getByText('ok')).toBeTruthy()
    expect(document.querySelectorAll('[data-quiet="true"]')).toHaveLength(1)
    // Every criterion row still has one cell per column.
    expect(document.querySelectorAll('[data-part="criterion"]')).toHaveLength(6)
  })

  it('tags every cell with its column so a narrow pane can stack them (T80c P1-10)', () => {
    renderView()
    const heads = [...document.querySelectorAll<HTMLElement>('[data-part="head"]')]
    expect(heads.map(node => node.style.getPropertyValue('--col'))).toEqual(['0', '1'])
    const cells = [...document.querySelectorAll<HTMLElement>('[data-part]')]
    expect(cells.every(node => node.style.getPropertyValue('--col') !== '')).toBe(true)
  })
})
