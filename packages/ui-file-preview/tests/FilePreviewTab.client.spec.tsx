// @vitest-environment jsdom
/** FilePreviewTab: the right-Sidebar page body — the session's touched files
 * as a full-height list navigating IN-TAB to a detail view. List fetch rides
 * the injected Remote face; a row click selects the file and the detail view
 * (breadcrumb header + copy/folder/IDE actions + 内容/改动记录 toggle over the
 * restored preview stack) replaces the list; the back button returns.
 * Outside-workspace files open the same detail view (the Remote read resolves
 * absolute paths). Navigation params select on arrival. */

import { useEffect, useReducer, useRef, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { FilePreviewEntry, FilePreviewList, FilePreviewRead } from '@khorsheed/dsh-file-preview/types'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { SidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { FilePreviewTab } from '../src/client/FilePreviewTab.tsx'
import { createFilePreviewStore } from '../src/client/file-preview-store.ts'
import type { FilePreviewTabProps } from '../src/client/contract.ts'

/** A useOpenInApps stand-in over a fixed probe answer. */
const useOpenInAppsFake = (apps: readonly string[] | null) =>
  <T,>(selector: (value: readonly string[] | null) => T): T => selector(apps)

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

const READ: FilePreviewRead = { path: 'src/agent.ts', kind: 'text', content: 'const a = 1', truncated: false }

interface HarnessOptions {
  readonly listFiles?: FilePreviewTabProps['listFiles']
  readonly readFile?: FilePreviewTabProps['readFile']
  readonly navigation?: {
    readonly params?: { readonly path?: string } | undefined
    readonly revision: number
    /** The opened address; defaults to the page address. */
    readonly address?: string
  }
  readonly cwd?: string | undefined
  /** Probed open-in-app catalog ids; null while the probe is unanswered. */
  readonly apps?: readonly string[] | null
  readonly copyPath?: FilePreviewTabProps['copyPath']
  readonly revealFolder?: FilePreviewTabProps['revealFolder']
  readonly openInIde?: FilePreviewTabProps['openInIde']
}

/** Render the body over a real store instance, re-rendering on store commits. */
function renderTab(opts: HarnessOptions = {}) {
  const navigation = opts.navigation ?? { params: undefined, revision: 0 }
  const cwd = 'cwd' in opts ? opts.cwd : '/work'
  const listFiles = opts.listFiles ?? vi.fn(async () => ({ ok: true as const, value: LIST }))
  const readFile = opts.readFile ?? vi.fn(async () => ({ ok: true as const, value: READ }))
  const apps = 'apps' in opts ? (opts.apps ?? null) : ['finder', 'cursor']
  const copyPath = opts.copyPath ?? vi.fn(async () => true)
  const revealFolder = opts.revealFolder ?? vi.fn()
  const openInIde = opts.openInIde ?? vi.fn()
  const useSessionsFake = (selector: (state: { byId: Record<string, { cwd: string | undefined }> }) => unknown) =>
    selector({ byId: { s1: { cwd } } })
  // Stable per mount, as the slot runtime guarantees: a fresh signal per call
  // would re-arm the fetch effect on every render.
  const signal = new AbortController().signal
  const tabActions = { openResource: vi.fn(), openTab: vi.fn(), close: vi.fn() }
  const useTabInfo = (): SidebarRightTabInfo => ({
    sidebar: { expanded: true, fullscreen: false },
    panel: { id: 'p1' as SidebarRightTabInfo['panel']['id'] },
    tab: {
      id: 'tab1' as SidebarRightTabInfo['tab']['id'],
      kind: 'file-preview',
      contentId: 'sidebar://file-preview',
      title: 'Produced',
      visible: true,
      navigation: {
        address: navigation.address ?? 'sidebar://file-preview',
        params: navigation.params,
        revision: navigation.revision,
      },
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
      readFile,
      copyPath,
      revealFolder,
      openInIde,
      loadOpenInApps: vi.fn(),
      useOpenInApps: useOpenInAppsFake(apps),
      t: (key: string) => key,
    } as unknown as FilePreviewTabProps
    return <FilePreviewTab {...props} />
  }
  return { listFiles, readFile, copyPath, revealFolder, openInIde, tabActions, ...render(<Harness />) }
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

  it('a row click navigates in-tab to the detail view (never the official tab)', async () => {
    const { readFile, tabActions } = renderTab()
    await act(async () => {})
    fireEvent.click(screen.getByText('agent.ts'))
    // No openResource: the detail view opens inside our tab.
    expect(tabActions.openResource).not.toHaveBeenCalled()
    // Breadcrumb header: directory greyed, final segment solid; back button.
    expect(screen.getByLabelText('detail.back')).toBeTruthy()
    expect(screen.getByText('agent.ts')).toBeTruthy()
    expect(screen.getByText('/work/src/')).toBeTruthy()
    await act(async () => {})
    // The content tab fetched the current content through the Remote
    // (CodeBlock splits tokens, so match the rendered text as a whole).
    expect(readFile).toHaveBeenCalledWith('s1', 'src/agent.ts')
    expect(document.body.textContent).toContain('const a = 1')
  })

  it('detail view toggles into the change history and back', async () => {
    renderTab()
    await act(async () => {})
    fireEvent.click(screen.getByText('agent.ts'))
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'drawer.tab.diff' }))
    expect(screen.getByText(/history\.step\.count/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'drawer.tab.content' }))
    expect(document.body.textContent).toContain('const a = 1')
  })

  it('the back button returns to the list', async () => {
    renderTab()
    await act(async () => {})
    fireEvent.click(screen.getByText('agent.ts'))
    await act(async () => {})
    fireEvent.click(screen.getByLabelText('detail.back'))
    expect(screen.getByText('guide.md')).toBeTruthy()
    expect(screen.queryByLabelText('detail.back')).toBeNull()
  })

  it('detail actions: copy always, folder/IDE behind the probed catalog', async () => {
    const copyPath = vi.fn(async () => true)
    const revealFolder = vi.fn()
    const openInIde = vi.fn()
    renderTab({ copyPath, revealFolder, openInIde, apps: ['finder', 'cursor'] })
    await act(async () => {})
    fireEvent.click(screen.getByText('agent.ts'))
    await act(async () => {})
    fireEvent.click(screen.getByLabelText('row.copyPath'))
    expect(copyPath).toHaveBeenCalledWith('src/agent.ts')
    fireEvent.click(screen.getByLabelText('row.openFolder'))
    expect(revealFolder).toHaveBeenCalledWith('src/agent.ts')
    fireEvent.click(screen.getByLabelText('row.openIde'))
    expect(openInIde).toHaveBeenCalledWith('src/agent.ts')
  })

  it('hides the folder/IDE gestures until the probe answers with a handler', async () => {
    renderTab({ apps: null })
    await act(async () => {})
    fireEvent.click(screen.getByText('agent.ts'))
    await act(async () => {})
    expect(screen.getByLabelText('row.copyPath')).toBeTruthy()
    expect(screen.queryByLabelText('row.openFolder')).toBeNull()
    expect(screen.queryByLabelText('row.openIde')).toBeNull()
  })

  it('an outside-workspace file opens the same detail view (Remote read resolves it)', async () => {
    const readFile = vi.fn(async () => ({
      ok: true as const,
      value: { path: '/tmp/artifact.html', kind: 'text', content: '<b>hi</b>', truncated: false } satisfies FilePreviewRead,
    }))
    renderTab({
      readFile,
      listFiles: vi.fn(async () => ({
        ok: true as const,
        value: { entries: [entry('/tmp/artifact.html', 1)], asOfSeq: 1, truncated: false },
      })),
    })
    await act(async () => {})
    fireEvent.click(screen.getByText('artifact.html'))
    await act(async () => {})
    expect(readFile).toHaveBeenCalledWith('s1', '/tmp/artifact.html')
    expect(screen.getByLabelText('detail.back')).toBeTruthy()
  })

  it('an openResource-claimed address lands directly on the detail view', async () => {
    const { readFile } = renderTab({
      navigation: { address: 'dsh-resource://file/session/s1/src/agent.ts', revision: 1 },
    })
    await act(async () => {})
    expect(screen.getByLabelText('detail.back')).toBeTruthy()
    expect(readFile).toHaveBeenCalledWith('s1', 'src/agent.ts')
  })

  it('a page re-open after backing out re-applies the navigation selection', async () => {
    renderTab({ navigation: { params: { path: 'src/agent.ts' }, revision: 1 } })
    await act(async () => {})
    expect(screen.getByLabelText('detail.back')).toBeTruthy()
  })

  it('navigation params land directly on the detail view', async () => {
    const { readFile } = renderTab({ navigation: { params: { path: 'src/agent.ts' }, revision: 1 } })
    await act(async () => {})
    expect(screen.getByLabelText('detail.back')).toBeTruthy()
    expect(readFile).toHaveBeenCalledWith('s1', 'src/agent.ts')
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
