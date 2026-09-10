// @vitest-environment jsdom
/** FilePreviewTab: the right-Sidebar page body — the session's touched
 * files as one full-height list. List fetch rides the injected Remote face;
 * an in-workspace row click selects the file AND hands its content preview to
 * the official document tab through the tab's `openResource`; an
 * outside-workspace row only selects (no resource address exists) and carries
 * the outside marker; navigation params select on arrival. The change history
 * lives in the document tab's switchable renderer (FileHistoryBody), not here. */

import { useEffect, useReducer, useRef, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { FilePreviewEntry, FilePreviewList } from '@khorsheed/dsh-file-preview/types'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { SidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { FilePreviewTab } from '../src/client/FilePreviewTab.tsx'
import { createFilePreviewStore } from '../src/client/file-preview-store.ts'
import type { FilePreviewTabProps } from '../src/client/contract.ts'

function entry(path: string, seq: number, diffs: FilePreviewEntry['diffs'] = []): FilePreviewEntry {
  return { path, op: 'write', seq, turn: 1, step: 1, diffs }
}

const LIST: FilePreviewList = {
  entries: [
    entry('docs/guide.md', 1),
    entry('src/agent.ts', 2, [
      { seq: 2, turn: 1, step: 1, oldText: null, newText: 'first' },
      { seq: 3, turn: 1, step: 2, oldText: 'first', newText: 'second' },
    ]),
  ],
  asOfSeq: 3,
  truncated: false,
}

interface HarnessOptions {
  readonly listFiles?: FilePreviewTabProps['listFiles']
  readonly openResource?: (address: string) => void
  readonly navigation?: { readonly params?: { readonly path?: string } | undefined; readonly revision: number }
  readonly cwd?: string | undefined
}

/** Render the body over a real store instance, re-rendering on store commits. */
function renderTab(opts: HarnessOptions = {}) {
  const openResource = opts.openResource ?? vi.fn()
  const navigation = opts.navigation ?? { params: undefined, revision: 0 }
  const cwd = 'cwd' in opts ? opts.cwd : '/work'
  const listFiles = opts.listFiles ?? vi.fn(async () => ({ ok: true as const, value: LIST }))
  const useSessionsFake = (selector: (state: { byId: Record<string, { cwd: string | undefined }> }) => unknown) =>
    selector({ byId: { s1: { cwd } } })
  // Stable per mount, as the slot runtime guarantees: a fresh signal per call
  // would re-arm the fetch effect on every render.
  const signal = new AbortController().signal
  const tabActions = { openResource, openTab: vi.fn(), close: vi.fn() }
  const useTabInfo = (): SidebarRightTabInfo => ({
    sidebar: { expanded: true, fullscreen: false },
    panel: { id: 'p1' as SidebarRightTabInfo['panel']['id'] },
    tab: {
      id: 'tab1' as SidebarRightTabInfo['tab']['id'],
      kind: 'file-preview',
      contentId: 'sidebar://file-preview',
      title: 'Produced',
      visible: true,
      navigation: { address: 'sidebar://file-preview', params: navigation.params, revision: navigation.revision },
      signal,
      actions: tabActions,
    },
  })
  function Harness(): ReactNode {
    const instanceRef = useRef<ReturnType<ReturnType<typeof createFilePreviewStore>['create']>>(null)
    if (instanceRef.current === null) instanceRef.current = createFilePreviewStore().create()
    const instance = instanceRef.current
    const [, force] = useReducer((x: number) => x + 1, 0)
    useEffect(() => instance.subscribe(force), [instance])
    const props = {
      useTabInfo,
      sessionId: 's1' as SessionId,
      useSessions: useSessionsFake,
      useStore: <T,>(selector: (state: never) => T): T => selector(instance.getSnapshot() as never),
      actions: instance.actions,
      listFiles,
      t: (key: string) => key,
    } as unknown as FilePreviewTabProps
    return <FilePreviewTab {...props} />
  }
  return { openResource, listFiles, ...render(<Harness />) }
}

afterEach(cleanup)

describe('FilePreviewTab', () => {
  it('fetches the list on mount and shows the products latest-first', async () => {
    const { listFiles } = renderTab()
    await act(async () => {})
    expect(listFiles).toHaveBeenCalledWith('s1')
    const rows = screen.getAllByRole('button').map(b => b.textContent ?? '')
    const agent = rows.findIndex(text => text.includes('agent.ts'))
    const guide = rows.findIndex(text => text.includes('guide.md'))
    expect(agent).toBeGreaterThanOrEqual(0)
    expect(agent).toBeLessThan(guide)
  })

  it('shows the empty line when the session wrote nothing', async () => {
    renderTab({ listFiles: vi.fn(async () => ({ ok: true as const, value: { entries: [], asOfSeq: 0, truncated: false } })) })
    await act(async () => {})
    expect(screen.getByText('list.empty')).toBeTruthy()
  })

  it('click selects the file and opens the official document tab', async () => {
    const openResource = vi.fn()
    const { container } = renderTab({ openResource })
    await act(async () => {})
    fireEvent.click(screen.getByText('agent.ts'))
    expect(openResource).toHaveBeenCalledWith('dsh-resource://file/session/s1/src/agent.ts')
    // The row carries the selected styling.
    expect(container.querySelector('[title="src/agent.ts"]')?.className).toContain('rowSelected')
  })

  it('an outside-workspace row only selects — no resource address exists', async () => {
    const openResource = vi.fn()
    const { container } = renderTab({
      openResource,
      listFiles: vi.fn(async () => ({
        ok: true as const,
        value: { entries: [entry('/tmp/artifact.html', 1)], asOfSeq: 1, truncated: false },
      })),
    })
    await act(async () => {})
    fireEvent.click(screen.getByText('artifact.html'))
    expect(openResource).not.toHaveBeenCalled()
    // The row is marked with the outside hint and shows selected styling.
    const row = container.querySelector('[title^="/tmp/artifact.html"]')
    expect(row?.getAttribute('title')).toContain('list.outsideWorkspace')
    expect(row?.className).toContain('rowSelected')
  })

  it('navigation params select the carried path on arrival', async () => {
    const { container } = renderTab({ navigation: { params: { path: 'src/agent.ts' }, revision: 1 } })
    await act(async () => {})
    expect(container.querySelector('[title="src/agent.ts"]')?.className).toContain('rowSelected')
  })

  it('narrows the list by the search term', async () => {
    const { container } = renderTab()
    await act(async () => {})
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'guide' } })
    // The matched name renders split around a <mark>, so query by the row's title.
    expect(container.querySelector('[title="src/agent.ts"]')).toBeNull()
    expect(container.querySelector('[title="docs/guide.md"]')).not.toBeNull()
  })

  it('refresh re-fetches the list', async () => {
    const listFiles = vi.fn(async () => ({ ok: true as const, value: LIST }))
    renderTab({ listFiles })
    await act(async () => {})
    expect(listFiles).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'list.refresh' }))
    await act(async () => {})
    expect(listFiles).toHaveBeenCalledTimes(2)
  })
})
