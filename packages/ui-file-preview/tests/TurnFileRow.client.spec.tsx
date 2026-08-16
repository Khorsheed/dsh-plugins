// @vitest-environment jsdom
/** TurnFileRow: renders the turn's mutated files as a summary card — a
 * "N files changed" header, per-file name + directory + line deltas — and a
 * file click opens the drawer through the injected opener. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TurnFileRow, type TurnFileRowProps } from '../src/client/TurnFileRow.tsx'
import type { TurnFilePath } from '../src/client/turn-files.ts'

const FILES: readonly TurnFilePath[] = [
  { seq: 1, path: '/work/src/agent.ts', added: 12, removed: 3 },
  { seq: 2, path: '/work/docs/guide.md', added: 4, removed: undefined },
]

function renderRow(overrides: Partial<TurnFileRowProps> = {}) {
  const props: TurnFileRowProps = {
    matched: FILES,
    openDrawer: vi.fn(),
    t: ((key: string) => key),
    ...overrides,
  }
  return render(<TurnFileRow {...props} />)
}

afterEach(cleanup)

describe('TurnFileRow', () => {
  it('renders the summary header with the file count', () => {
    const t = vi.fn((key: string) => key)
    renderRow({ t })
    expect(screen.getByText('turn.summary')).toBeTruthy()
    expect(t).toHaveBeenCalledWith('turn.summary', { count: 2 })
  })

  it('uses the singular header for one file', () => {
    renderRow({ matched: FILES.slice(0, 1) })
    expect(screen.getByText('turn.summaryOne')).toBeTruthy()
  })

  it('renders name, directory, and line deltas per file', () => {
    renderRow()
    expect(screen.getByText('agent.ts')).toBeTruthy()
    expect(screen.getByText('/work/src')).toBeTruthy()
    expect(screen.getByText('+12')).toBeTruthy()
    expect(screen.getByText('−3')).toBeTruthy()
    // The create (removed unknown) shows no minus badge.
    expect(screen.getByText('+4')).toBeTruthy()
    expect(screen.queryByText('−0')).toBeNull()
  })

  it('omits the directory segment for a rootless path', () => {
    const { container } = renderRow({ matched: [{ seq: 1, path: 'notes.md', added: 1, removed: 0 }] })
    expect(screen.getByText('notes.md')).toBeTruthy()
    expect(container.querySelectorAll('[class*="dir"]')).toHaveLength(0)
  })

  it('opens the drawer with the full path on file click', () => {
    const openDrawer = vi.fn()
    renderRow({ openDrawer })
    fireEvent.click(screen.getByText('agent.ts'))
    expect(openDrawer).toHaveBeenCalledWith('/work/src/agent.ts')
  })

  it('caps the visible rows behind an overflow toggle', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ seq: 1, path: `/work/f${i}.ts`, added: 1, removed: 0 }))
    const t = vi.fn((key: string) => key)
    renderRow({ matched: many, t })
    // Five rows visible; the overflow row offers the remaining two.
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

  it('collapses the whole card from the header chevron', () => {
    renderRow()
    const header = screen.getByRole('button', { name: /turn\.summary/ })
    expect(screen.getByText('agent.ts')).toBeTruthy()
    fireEvent.click(header)
    expect(screen.queryByText('agent.ts')).toBeNull()
    fireEvent.click(header)
    expect(screen.getByText('agent.ts')).toBeTruthy()
  })
})
