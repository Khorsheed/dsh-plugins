// @vitest-environment jsdom
/** TurnFileRow: the turn's compact product table — plain rows at up to three
 * products, a collapsible "N 个产物" summary row past that. A file click goes
 * through the owner's `openFile` (the canonical address route — one file, one
 * detail tab). Nothing renders before the fetch settles, for an empty turn,
 * or on failure; visibility is decided by the fetch, not the chain select. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { FilePreviewTurnFile } from '@khorsheed/dsh-file-preview/types'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { TurnFileRow } from '../src/client/TurnFileRow.tsx'
import type { FilePreviewTurnRowProps } from '../src/client/contract.ts'

const FILES: readonly FilePreviewTurnFile[] = [
  { seq: 1, path: '/work/src/agent.ts', added: 12, removed: 3 },
  { seq: 2, path: '/work/docs/guide.md', added: 4, removed: undefined },
]

/** A useSessions stand-in: the session s1 rooted at /work. */
const useSessionsFake = (selector: (state: { byId: Record<string, { cwd: string }> }) => unknown) =>
  selector({ byId: { s1: { cwd: '/work' } } })

function renderRow(overrides: Partial<FilePreviewTurnRowProps> = {}) {
  const props = {
    sessionId: 's1' as SessionId,
    turn: { turn: 3 } as TurnLocation,
    openFile: vi.fn(),
    turnFiles: vi.fn(async () => FILES),
    t: ((key: string) => key),
    useSessions: useSessionsFake,
    ...overrides,
  } as unknown as FilePreviewTurnRowProps
  return render(<TurnFileRow {...props} />)
}

afterEach(cleanup)

describe('TurnFileRow', () => {
  it('renders nothing until the host fetch settles', () => {
    const { container } = renderRow({ turnFiles: vi.fn(() => new Promise(() => {})) })
    expect(container.firstChild).toBeNull()
  })

  it('renders the product table once the fetch resolves', async () => {
    renderRow()
    await act(async () => {})
    expect(screen.getByText('agent.ts')).toBeTruthy()
    expect(screen.getByText('/work/docs')).toBeTruthy()
    expect(screen.getByText('+12')).toBeTruthy()
    expect(screen.getByText('−3')).toBeTruthy()
    expect(screen.getByText('+4')).toBeTruthy()
    expect(screen.queryByText('−0')).toBeNull()
    // Two products: no summary row, the table shows directly.
    expect(screen.queryByText('turn.count')).toBeNull()
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

  it('routes every file click through the owner openFile (one address, one tab)', async () => {
    const openFile = vi.fn()
    renderRow({ openFile })
    await act(async () => {})
    fireEvent.click(screen.getByText('agent.ts'))
    expect(openFile).toHaveBeenCalledWith('/work/src/agent.ts')
  })

  it('an outside-workspace file click also goes through openFile (our claim covers it)', async () => {
    const openFile = vi.fn()
    renderRow({
      openFile,
      turnFiles: vi.fn(async () => [{ seq: 1, path: '/tmp/artifact.html', added: 40, removed: 0 }]),
    })
    await act(async () => {})
    fireEvent.click(screen.getByText('artifact.html'))
    expect(openFile).toHaveBeenCalledWith('/tmp/artifact.html')
  })

  it('collapses to a summary row past three products and expands in place', async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ seq: 1, path: `/work/f${i}.ts`, added: 1, removed: 0 }))
    const t = vi.fn((key: string) => key)
    renderRow({ turnFiles: vi.fn(async () => many), t })
    await act(async () => {})
    // Collapsed: no rows, just the summary.
    expect(screen.queryByText('f0.ts')).toBeNull()
    const summary = screen.getByText('turn.count')
    expect(t).toHaveBeenCalledWith('turn.count', { count: 5 })
    fireEvent.click(summary)
    expect(screen.getByText('f4.ts')).toBeTruthy()
    // And folds back.
    fireEvent.click(screen.getByText('turn.count'))
    expect(screen.queryByText('f0.ts')).toBeNull()
  })

})
