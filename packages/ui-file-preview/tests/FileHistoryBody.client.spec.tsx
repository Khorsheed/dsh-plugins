// @vitest-environment jsdom
/** FileHistoryBody: the document tab's switchable change-history renderer.
 * Parses the session-scoped file address, fetches the host filePreview fold,
 * matches the entry by workspace-resolved path (the fold records the tool
 * call's spelling, often relative), and renders the diff stepper — or the
 * empty notice for files with no recorded changes. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { FilePreviewEntry, FilePreviewList } from '@khorsheed/dsh-file-preview/types'
import { FileHistoryBody, type FileHistoryBodyProps } from '../src/client/FileHistoryBody.tsx'

function entry(path: string, diffs: FilePreviewEntry['diffs'] = []): FilePreviewEntry {
  return { path, op: 'write', seq: 1, turn: 1, step: 1, diffs }
}

const LIST: FilePreviewList = {
  entries: [
    entry('docs/guide.md'),
    entry('src/agent.ts', [
      { seq: 2, turn: 1, step: 1, oldText: null, newText: 'first' },
      { seq: 3, turn: 1, step: 2, oldText: 'first', newText: 'second' },
    ]),
  ],
  asOfSeq: 3,
  truncated: false,
}

/** A useSessions stand-in: the session s1 rooted at /work. */
const useSessionsFake = (selector: (state: { byId: Record<string, { cwd: string }> }) => unknown) =>
  selector({ byId: { s1: { cwd: '/work' } } })

function renderBody(overrides: Partial<FileHistoryBodyProps> = {}) {
  const props = {
    resourceAddress: 'dsh-resource://file/session/s1/src/agent.ts',
    content: { kind: 'text', text: '', pages: [], eof: true },
    wrap: false,
    scrollportRef: () => {},
    useSessions: useSessionsFake,
    listFiles: vi.fn(async () => ({ ok: true as const, value: LIST })),
    t: (key: string) => key,
    ...overrides,
  } as unknown as FileHistoryBodyProps
  return render(<FileHistoryBody {...props} />)
}

afterEach(cleanup)

describe('FileHistoryBody', () => {
  it('renders the recorded change history for the addressed file', async () => {
    renderBody()
    await act(async () => {})
    // The stepper label: latest of two changes.
    expect(screen.getByText(/history\.step\.count/)).toBeTruthy()
    expect(screen.getByLabelText('history.step.older')).toBeTruthy()
  })

  it('matches a fold entry recorded with a relative path', async () => {
    const listFiles = vi.fn(async () => ({ ok: true as const, value: LIST }))
    renderBody({ listFiles })
    await act(async () => {})
    expect(listFiles).toHaveBeenCalledWith('s1')
    expect(screen.queryByText('history.empty')).toBeNull()
  })

  it('shows the empty notice for a file with no recorded changes', async () => {
    renderBody({ resourceAddress: 'dsh-resource://file/session/s1/docs/guide.md' })
    await act(async () => {})
    expect(screen.getByText('history.empty')).toBeTruthy()
  })

  it('shows the empty notice for a file the fold never saw', async () => {
    renderBody({ resourceAddress: 'dsh-resource://file/session/s1/src/unknown.ts' })
    await act(async () => {})
    expect(screen.getByText('history.empty')).toBeTruthy()
  })

  it('shows the empty notice for a non-session address and never fetches', async () => {
    const listFiles = vi.fn(async () => ({ ok: true as const, value: LIST }))
    renderBody({ resourceAddress: 'dsh-resource://file/absolute/tmp/x.ts', listFiles })
    await act(async () => {})
    expect(listFiles).not.toHaveBeenCalled()
    expect(screen.getByText('history.empty')).toBeTruthy()
  })

  it('shows the empty notice when the fold fails', async () => {
    renderBody({ listFiles: vi.fn(async () => ({ ok: false as const, error: { code: 'x', message: 'boom' } })) })
    await act(async () => {})
    expect(screen.getByText('history.empty')).toBeTruthy()
  })
})
