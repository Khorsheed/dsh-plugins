// @vitest-environment jsdom
/**
 * The tree keeps its view across unmounts: the right sidebar unmounts a tab's
 * body whenever another tab or page takes over, and coming back used to find
 * every folder collapsed and the scroll at the top. Under a memoryKey the
 * expansion, the loaded children and the scroll offset come back, and the
 * open folders are re-listed so changes made meanwhile show up.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FileTree, type FileTreeItem } from '../src/client/FileTree.tsx'

const t = ((key: string) => key) as never
const groups = [{ key: 'local', title: '', items: [{ path: 'alpha', isDir: true }, { path: 'beta', isDir: true }] satisfies FileTreeItem[] }]

/** Mount the tree inside a scrolling column, as the split layout does. */
function mount(memoryKey: string | undefined, loadChildren: (dir: string) => Promise<FileTreeItem[]>) {
  return render(
    <div data-testid="column" style={{ overflowY: 'auto', height: '100px' }}>
      <FileTree groups={groups} selectedPath={null} onSelect={() => {}} loadChildren={loadChildren} rootPath="/w" memoryKey={memoryKey} t={t} />
    </div>,
  )
}

describe('FileTree memory', () => {
  afterEach(() => { cleanup() })

  it('restores expanded folders, their children and the scroll offset after an unmount, then re-lists them', async () => {
    let listing: FileTreeItem[] = [{ path: 'note.md' }]
    const loadChildren = vi.fn(async () => listing)
    mount('sess\u0000/w', loadChildren)
    await act(async () => { fireEvent.click(screen.getByText('alpha')) })
    expect(screen.getByText('note.md')).toBeTruthy()
    fireEvent.scroll(Object.assign(screen.getByTestId('column'), { scrollTop: 140 }))
    cleanup()

    // Away: a new file lands in alpha.
    listing = [{ path: 'note.md' }, { path: 'added.md' }]
    mount('sess\u0000/w', loadChildren)
    // First paint is the remembered tree: alpha open with its old children, scroll restored.
    expect(screen.getByText('note.md')).toBeTruthy()
    expect(screen.getByTestId('column').scrollTop).toBe(140)
    await act(async () => {})
    expect(loadChildren).toHaveBeenLastCalledWith('/w/alpha')
    expect(screen.getByText('added.md')).toBeTruthy()
  })

  it('keeps each key separate, and remembers nothing without a key', async () => {
    const loadChildren = vi.fn(async () => [{ path: 'note.md' }])
    mount('sess\u0000/w', loadChildren)
    await act(async () => { fireEvent.click(screen.getByText('beta')) })
    cleanup()
    mount('other-session\u0000/w', loadChildren)
    expect(screen.queryByText('note.md')).toBeNull()
    cleanup()
    mount(undefined, loadChildren)
    await act(async () => { fireEvent.click(screen.getByText('alpha')) })
    cleanup()
    mount(undefined, loadChildren)
    expect(screen.queryByText('note.md')).toBeNull()
  })
})
