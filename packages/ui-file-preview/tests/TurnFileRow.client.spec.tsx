// @vitest-environment jsdom
/** TurnFileRow (async shell): renders the turn's mutated files as a summary
 * card after the host turn-files fetch settles — "N files changed" header,
 * per-file name + directory + line deltas — and a file click opens the drawer
 * through the injected opener. Nothing renders before the fetch resolves, for
 * an empty turn, or on failure; visibility is decided by the fetch, not the
 * chain select. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { FilePreviewTurnFile } from '@khorsheed/dsh-file-preview/types'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { TurnLocation } from '@deepseek-ai/dsh-client-runtime/client'
import { TurnFileRow, type FilePreviewTurnRowProps } from '../src/client/TurnFileRow.tsx'

const FILES: readonly FilePreviewTurnFile[] = [
  { seq: 1, path: '/work/src/agent.ts', added: 12, removed: 3 },
  { seq: 2, path: '/work/docs/guide.md', added: 4, removed: undefined },
]

function renderRow(overrides: Partial<FilePreviewTurnRowProps> = {}) {
  const props: FilePreviewTurnRowProps = {
    sessionId: 's1' as SessionId,
    turn: { turn: 3 } as TurnLocation,
    openDrawer: vi.fn(),
    turnFiles: vi.fn(async () => FILES),
    t: ((key: string) => key),
    ...overrides,
  }
  return render(<TurnFileRow {...props} />)
}

afterEach(cleanup)

describe('TurnFileRow', () => {
  it('renders nothing until the host fetch settles', () => {
    const { container } = renderRow({ turnFiles: vi.fn(() => new Promise(() => {})) })
    expect(container.firstChild).toBeNull()
  })

  it('renders the summary header and files once the fetch resolves', async () => {
    const t = vi.fn((key: string) => key)
    const turnFiles = vi.fn(async () => FILES)
    renderRow({ t, turnFiles })
    await act(async () => {})
    expect(screen.getByText('turn.summary')).toBeTruthy()
    expect(t).toHaveBeenCalledWith('turn.summary', { count: 2 })
    expect(screen.getByText('agent.ts')).toBeTruthy()
    expect(screen.getByText('/work/src')).toBeTruthy()
    expect(screen.getByText('+12')).toBeTruthy()
    expect(screen.getByText('−3')).toBeTruthy()
    expect(screen.getByText('+4')).toBeTruthy()
    expect(screen.queryByText('−0')).toBeNull()
  })

  it('uses the singular header for one file', async () => {
    renderRow({ turnFiles: vi.fn(async () => FILES.slice(0, 1)) })
    await act(async () => {})
    expect(screen.getByText('turn.summaryOne')).toBeTruthy()
  })

  it('renders nothing for an empty turn or a failed fetch', async () => {
    const empty = renderRow({ turnFiles: vi.fn(async () => []) })
    await act(async () => {})
    expect(empty.container.firstChild).toBeNull()
    cleanup()
    const failed = renderRow({ turnFiles: vi.fn(async () => []) })
    await act(async () => {})
    expect(failed.container.firstChild).toBeNull()
  })

  it('omits the directory segment for a rootless path', async () => {
    const { container } = renderRow({
      turnFiles: vi.fn(async () => [{ seq: 1, path: 'notes.md', added: 1, removed: 0 }]),
    })
    await act(async () => {})
    expect(screen.getByText('notes.md')).toBeTruthy()
    expect(container.querySelectorAll('[class*="dir"]')).toHaveLength(0)
  })

  it('opens the drawer with the full path on file click', async () => {
    const openDrawer = vi.fn()
    renderRow({ openDrawer })
    await act(async () => {})
    fireEvent.click(screen.getByText('agent.ts'))
    expect(openDrawer).toHaveBeenCalledWith('/work/src/agent.ts')
  })

  it('caps the visible rows behind an overflow toggle', async () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ seq: 1, path: `/work/f${i}.ts`, added: 1, removed: 0 }))
    const t = vi.fn((key: string) => key)
    renderRow({ turnFiles: vi.fn(async () => many), t })
    await act(async () => {})
    expect(screen.getByText('f0.ts')).toBeTruthy()
    expect(screen.queryByText('f5.ts')).toBeNull()
    expect(screen.getByText('turn.expand')).toBeTruthy()
    expect(t).toHaveBeenCalledWith('turn.expand', { count: 2 })
    fireEvent.click(screen.getByText('turn.expand'))
    expect(screen.getByText('f6.ts')).toBeTruthy()
    expect(screen.getByText('turn.collapse')).toBeTruthy()
    fireEvent.click(screen.getByText('turn.collapse'))
    expect(screen.queryByText('f5.ts')).toBeNull()
  })

  it('collapses the whole card from the header chevron', async () => {
    renderRow()
    await act(async () => {})
    const header = screen.getByRole('button', { name: /turn\.summary/ })
    expect(screen.getByText('agent.ts')).toBeTruthy()
    fireEvent.click(header)
    expect(screen.queryByText('agent.ts')).toBeNull()
    fireEvent.click(header)
    expect(screen.getByText('agent.ts')).toBeTruthy()
  })
})
