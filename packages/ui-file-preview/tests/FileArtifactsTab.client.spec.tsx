// @vitest-environment jsdom
/** FileArtifactsTab: the rc.1 line's session-products LIST SHELL — the fold's
 * written/edited files latest-first, with the name filter and the refresh
 * gesture carried over from the retired page. A row click opens the file
 * through the injected official route (`openArtifact` → openResource on the
 * canonical file address); the shell itself draws no content. */

import { useEffect, useReducer, useRef, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { FilePreviewEntry, FilePreviewList } from '@khorsheed/dsh-file-preview/types'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { SidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { FileArtifactsTab } from '../src/client/FileArtifactsTab.tsx'
import { createFilePreviewStore } from '../src/client/file-preview-store.ts'
import type { FileArtifactsTabProps } from '../src/client/contract.ts'

function entry(path: string, seq: number, op: FilePreviewEntry['op'] = 'write'): FilePreviewEntry {
  return { path, op, seq, turn: 1, step: 1, diffs: [] }
}

const LIST: FilePreviewList = {
  entries: [
    entry('docs/guide.md', 1),
    entry('src/agent.ts', 2),
    entry('README.md', 3, 'read'),
  ],
  asOfSeq: 3,
  truncated: false,
}

interface HarnessOptions {
  readonly listFiles?: FileArtifactsTabProps['listFiles']
  readonly openArtifact?: FileArtifactsTabProps['openArtifact']
  readonly cwd?: string | undefined
}

/** Render the shell over a real store instance, re-rendering on store commits. */
function renderShell(opts: HarnessOptions = {}) {
  const cwd = 'cwd' in opts ? opts.cwd : '/work'
  const listFiles = opts.listFiles ?? vi.fn(async () => ({ ok: true as const, value: LIST }))
  const openArtifact = opts.openArtifact ?? vi.fn()
  const useSessionsFake = (selector: (state: { byId: Record<string, { cwd: string | undefined }> }) => unknown) =>
    selector({ byId: { s1: { cwd } } })
  // Stable per mount, as the slot runtime guarantees: a fresh signal per call
  // would re-arm the fetch effect on every render.
  const signal = new AbortController().signal
  const useTabInfo = (): SidebarRightTabInfo => ({
    sidebar: { expanded: true, fullscreen: false },
    panel: { id: 'p1' as SidebarRightTabInfo['panel']['id'] },
    tab: {
      id: 'tab1' as SidebarRightTabInfo['tab']['id'],
      kind: 'file-artifacts',
      contentId: 'sidebar://file-artifacts',
      title: 'Session products',
      visible: true,
      navigation: { address: 'sidebar://file-artifacts', params: undefined, revision: 0 },
      signal,
      actions: { openResource: vi.fn(), openTab: vi.fn(), close: vi.fn() },
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
      openArtifact,
      t: (key: string) => key,
    } as unknown as FileArtifactsTabProps
    return <FileArtifactsTab {...props} />
  }
  return { listFiles, openArtifact, ...render(<Harness />) }
}

afterEach(cleanup)

describe('FileArtifactsTab', () => {
  it('fetches the list on mount and shows the products latest-first, reads excluded', async () => {
    const { listFiles } = renderShell()
    await act(async () => {})
    expect(listFiles).toHaveBeenCalledWith('s1')
    const rows = screen.getAllByRole('button').map(b => b.textContent ?? '')
    const agent = rows.findIndex(text => text.includes('agent.ts'))
    const guide = rows.findIndex(text => text.includes('guide.md'))
    expect(agent).toBeGreaterThanOrEqual(0)
    expect(agent).toBeLessThan(guide)
    // Pure reads never appear in the products list.
    expect(rows.some(text => text.includes('README.md'))).toBe(false)
  })

  it('a row click opens the official route; the shell renders no content itself', async () => {
    const { openArtifact } = renderShell()
    await act(async () => {})
    fireEvent.click(screen.getByText('agent.ts'))
    expect(openArtifact).toHaveBeenCalledWith('src/agent.ts')
    // The list stays — navigation happens in the official document tab.
    expect(screen.getByText('guide.md')).toBeTruthy()
    expect(screen.queryByLabelText('detail.back')).toBeNull()
  })

  it('shows the empty line when the session wrote nothing', async () => {
    renderShell({ listFiles: vi.fn(async () => ({ ok: true as const, value: { entries: [], asOfSeq: 0, truncated: false } })) })
    await act(async () => {})
    expect(screen.getByText('list.empty')).toBeTruthy()
  })

  it('shows the failure line when the fetch fails', async () => {
    renderShell({ listFiles: vi.fn(async () => ({ ok: false as const, error: { code: 'x', message: 'boom' } })) })
    await act(async () => {})
    expect(screen.getByText('list.error')).toBeTruthy()
  })

  it('narrows the list by the search term', async () => {
    const { container } = renderShell()
    await act(async () => {})
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'guide' } })
    expect(container.querySelector('[title="src/agent.ts"]')).toBeNull()
    expect(container.querySelector('[title="docs/guide.md"]')).not.toBeNull()
  })

  it('refresh re-fetches the list', async () => {
    const listFiles = vi.fn(async () => ({ ok: true as const, value: LIST }))
    renderShell({ listFiles })
    await act(async () => {})
    expect(listFiles).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'list.refresh' }))
    await act(async () => {})
    expect(listFiles).toHaveBeenCalledTimes(2)
  })

  it('marks outside-workspace rows with the globe but keeps them openable', async () => {
    const openArtifact = vi.fn()
    renderShell({
      openArtifact,
      listFiles: vi.fn(async () => ({
        ok: true as const,
        value: { entries: [entry('/tmp/artifact.html', 1)], asOfSeq: 1, truncated: false },
      })),
    })
    await act(async () => {})
    fireEvent.click(screen.getByText('artifact.html'))
    expect(openArtifact).toHaveBeenCalledWith('/tmp/artifact.html')
  })
})
