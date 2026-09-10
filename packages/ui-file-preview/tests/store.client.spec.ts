import { describe, expect, it } from 'vitest'
import { createFilePreviewStore } from '../src/client/file-preview-store.ts'
import type { TabId } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

const tab = (id: string): TabId => id as TabId

function makeStore() {
  const instance = createFilePreviewStore().create()
  return { actions: instance.actions, getState: () => instance.getSnapshot() }
}

describe('file-preview tab store', () => {
  it('starts empty with no data', () => {
    const { getState } = makeStore()
    expect(getState()).toMatchObject({
      list: null, listAsOfSeq: -1, listRequestRev: 0, listLoading: false, listError: null, selected: {},
    })
  })

  it('selects per tab, independently', () => {
    const { actions, getState } = makeStore()
    actions.select(tab('t1'), 'a.md')
    actions.select(tab('t2'), 'b.md')
    expect(getState().selected).toEqual({ t1: 'a.md', t2: 'b.md' })
    actions.select(tab('t1'), 'c.md')
    expect(getState().selected['t1']).toBe('c.md')
    expect(getState().selected['t2']).toBe('b.md')
  })

  it('list lifecycle actions replace the whole value', () => {
    const { actions, getState } = makeStore()
    actions.setListLoading(true)
    expect(getState().listLoading).toBe(true)
    actions.setList({ entries: [{ path: 'a.md', op: 'write', seq: 1, turn: 1, step: 1, diffs: [] }], asOfSeq: 1, truncated: false })
    actions.setListLoading(false)
    expect(getState().listLoading).toBe(false)
    expect(getState().list).toHaveLength(1)
    expect(getState().listAsOfSeq).toBe(1)
    expect(getState().listError).toBeNull()
    actions.setListError('boom')
    expect(getState().listError).toBe('boom')
  })

  it('refreshList bumps the request revision', () => {
    const { actions, getState } = makeStore()
    actions.refreshList()
    expect(getState().listRequestRev).toBe(1)
  })
})
