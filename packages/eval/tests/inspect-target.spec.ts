import { describe, expect, it } from 'vitest'
import {
  INSPECT_STACK_CAP, isInspectTarget, pushTarget, rememberTarget, stackForNavigation, type InspectTarget,
} from '../src/client/inspect-target.ts'

const item = (id: string, tab?: 'task' | 'rubric'): InspectTarget => ({ page: 'item', experimentId: 'e1', item: id, ...(tab === undefined ? {} : { tab }) })

describe('inspect targets (T86)', () => {
  it('accepts only the shapes a page can draw', () => {
    expect(isInspectTarget(item('F1'))).toBe(true)
    expect(isInspectTarget({ page: 'item', experimentId: 'e1' })).toBe(false)
    expect(isInspectTarget({ page: 'item', experimentId: 'e1', item: 'F1', tab: 'nope' })).toBe(false)
    expect(isInspectTarget({ page: 'other' })).toBe(false)
    expect(isInspectTarget(null)).toBe(false)
    expect(isInspectTarget({ page: 'report-part', runId: 'r', part: 'audit' })).toBe(true)
    expect(isInspectTarget({ page: 'report-part', runId: 'r', part: 'x' })).toBe(false)
  })

  it('pushes, replaces a repeat of the top, and caps the stack', () => {
    const a = pushTarget([], item('F1'))
    const b = pushTarget(a, item('F1', 'rubric'))
    expect(b).toEqual([item('F1', 'rubric')])
    let s: InspectTarget[] = []
    for (let i = 0; i < INSPECT_STACK_CAP + 5; i++) s = pushTarget(s, item(`F${String(i)}`))
    expect(s).toHaveLength(INSPECT_STACK_CAP)
    expect(s[0]).toEqual(item('F5'))
  })

  it('remembers newest first without repeats', () => {
    expect(rememberTarget([item('F1'), item('F2')], item('F2'))).toEqual([item('F2'), item('F1')])
  })

  it('restores, keeps, pushes or starts fresh by tab and revision', () => {
    const memory = { tabId: 't1', revision: 2, stack: [item('F1')], recent: [] }
    expect(stackForNavigation(memory, 't1', 5, null)).toEqual([item('F1')])
    expect(stackForNavigation(memory, 't2', 5, null)).toEqual([])
    expect(stackForNavigation(memory, 't1', 2, item('F2'))).toEqual([item('F1')])
    expect(stackForNavigation(memory, 't1', 3, item('F2'))).toEqual([item('F1'), item('F2')])
    expect(stackForNavigation(memory, 't2', 3, item('F2'))).toEqual([item('F2')])
    expect(stackForNavigation(null, 't1', 1, item('F2'))).toEqual([item('F2')])
  })
})
