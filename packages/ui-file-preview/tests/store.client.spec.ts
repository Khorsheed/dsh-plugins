import { describe, expect, it } from 'vitest'
import { createFilePreviewStore } from '../src/client/file-preview-store.ts'

function makeStore() {
  const instance = createFilePreviewStore().create()
  return { actions: instance.actions, getState: () => instance.getSnapshot() }
}

describe('file-preview view store', () => {
  it('starts closed with no data', () => {
    const { getState } = makeStore()
    expect(getState()).toMatchObject({
      open: false, selectedPath: null, list: null, listAsOfSeq: -1, listRequestRev: 0,
      listLoading: false, listError: null, preview: null, previewLoading: false, previewError: null,
    })
  })

  it('open, close, and toggle flip the open flag', () => {
    const { actions, getState } = makeStore()
    actions.open()
    expect(getState().open).toBe(true)
    actions.open()
    expect(getState().open).toBe(true)
    actions.close()
    expect(getState().open).toBe(false)
    actions.toggle()
    expect(getState().open).toBe(true)
    actions.toggle()
    expect(getState().open).toBe(false)
  })

  it('select clears the previous preview', () => {
    const { actions, getState } = makeStore()
    actions.setPreview({ path: 'a.md', kind: 'text', content: 'x' })
    actions.select('b.md')
    expect(getState().selectedPath).toBe('b.md')
    expect(getState().preview).toBeNull()
    expect(getState().previewError).toBeNull()
  })

  it('openPath opens the view at the given file', () => {
    const { actions, getState } = makeStore()
    actions.setPreview({ path: 'a.md', kind: 'text', content: 'x' })
    actions.openPath('notes.md')
    expect(getState().open).toBe(true)
    expect(getState().selectedPath).toBe('notes.md')
    expect(getState().preview).toBeNull()
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

  it('preview lifecycle actions clear errors on success', () => {
    const { actions, getState } = makeStore()
    actions.setPreviewError('boom')
    actions.setPreviewLoading(true)
    actions.setPreview({ path: 'a.md', kind: 'text', content: 'x' })
    actions.setPreviewLoading(false)
    expect(getState().previewError).toBeNull()
    expect(getState().previewLoading).toBe(false)
    expect(getState().preview).toMatchObject({ path: 'a.md', kind: 'text' })
  })
})
