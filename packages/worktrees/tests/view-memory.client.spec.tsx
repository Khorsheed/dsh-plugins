// @vitest-environment jsdom
/**
 * The worktrees tab keeps its views across unmounts: the right sidebar
 * unmounts a tab's body whenever another tab or page takes over, and coming
 * back used to find every folder collapsed and every list at the top. Under a
 * memoryKey the tree's expanded folders and the tree's / commit list's scroll
 * offsets come back, each key separately.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FileTree, type FileTreeGroup } from '../src/client/FileTree.tsx'
import { CommitList } from '../src/client/CommitList.tsx'
import { forgetViewMemory } from '../src/client/scroll-memory.ts'
import type { CommitInfo } from '../src/types.ts'

const t = ((key: string) => key) as never
const groups: FileTreeGroup[] = [{ key: 'pending', title: '', count: 2, items: [{ path: 'alpha/sub/note.md', status: 'M' }, { path: 'beta/readme.md', status: 'M' }] }]

/** Mount inside a scrolling column, as the tab's tree column does. */
function column(child: React.ReactNode) {
  return render(<div data-testid="column" style={{ overflowY: 'auto', height: '100px' }}>{child}</div>)
}
const tree = (memoryKey: string | undefined) => column(
  <FileTree groups={groups} selectedPath={null} onSelect={() => {}} memoryKey={memoryKey} t={t} />)

describe('worktrees view memory', () => {
  afterEach(() => { cleanup(); forgetViewMemory() })

  it('restores the expanded folders and the scroll offset of a tree after an unmount', () => {
    tree('s\u0000/repo\u0000worktree')
    fireEvent.click(screen.getByText('alpha'))
    fireEvent.click(screen.getByText('sub'))
    expect(screen.getByText('note.md')).toBeTruthy()
    fireEvent.scroll(Object.assign(screen.getByTestId('column'), { scrollTop: 75 }))
    cleanup()
    tree('s\u0000/repo\u0000worktree')
    expect(screen.getByText('note.md')).toBeTruthy()
    expect(screen.getByTestId('column').scrollTop).toBe(75)
  })

  it('keeps each mode and worktree separate, and remembers nothing without a key', () => {
    tree('s\u0000/repo\u0000worktree')
    fireEvent.click(screen.getByText('beta'))
    cleanup()
    tree('s\u0000/repo\u0000repo')
    expect(screen.queryByText('readme.md')).toBeNull()
    cleanup()
    tree(undefined)
    fireEvent.click(screen.getByText('beta'))
    cleanup()
    tree(undefined)
    expect(screen.queryByText('readme.md')).toBeNull()
  })

  it('restores the commit list scroll offset after an unmount', () => {
    const commits = Array.from({ length: 5 }, (_, i) => ({
      sha: `${i}`.repeat(40), subject: `change ${i}`, author: 'T', time: 0, branches: '', files: 1,
    })) satisfies CommitInfo[]
    const list = () => column(<CommitList commits={commits} selectedCommit={null} onSelectCommit={() => {}} memoryKey="s\u0000/repo\u0000commits" t={t} />)
    list()
    fireEvent.scroll(Object.assign(screen.getByTestId('column'), { scrollTop: 40 }))
    cleanup()
    list()
    expect(screen.getByTestId('column').scrollTop).toBe(40)
  })
})
