// @vitest-environment jsdom
/** FileContentBody: the official document tab's default content renderer
 * (rc.1 line). Parses the session-scoped file address, reads through the
 * plugin's own Remote (outside-workspace capable), renders the shared content
 * pane, and settles the owner's renderer-mode revision through
 * `loaded(version)` / `failed()` — the version token comes from the standard
 * `useResource` file metadata so the owner's change detection keeps working.
 * The copy-path gesture copies the workspace-resolved absolute spelling. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { FilePreviewRead } from '@khorsheed/dsh-file-preview/types'
import { FileContentBody, type FileContentBodyProps } from '../src/client/FileContentBody.tsx'

const READ: FilePreviewRead = { path: 'src/agent.ts', kind: 'text', content: 'const a = 1', truncated: false }

/** A useSessions stand-in: the session s1 rooted at /work. */
const useSessionsFake = (selector: (state: { byId: Record<string, { cwd: string }> }) => unknown) =>
  selector({ byId: { s1: { cwd: '/work' } } })

/** A useResource stand-in over one file-metadata frame (NO_VERSION models a file without metadata). */
const NO_VERSION = Symbol('no-version')
const useResourceFake = (version: string | typeof NO_VERSION = 'v1') => () =>
  ({ status: 'live', value: version === NO_VERSION ? undefined : { version, absolutePath: '/work/src/agent.ts' }, failure: undefined })

function renderBody(overrides: Partial<FileContentBodyProps> = {}) {
  const request = { kind: 'renderer' as const, revision: 0, loaded: vi.fn(), failed: vi.fn(), reload: vi.fn() }
  const props = {
    resourceAddress: 'dsh-resource://file/session/s1/src/agent.ts',
    content: request,
    wrap: false,
    addResource: vi.fn(),
    setResources: vi.fn(),
    scrollportRef: () => {},
    useSessions: useSessionsFake,
    useResource: useResourceFake('v1'),
    readFile: vi.fn(async () => ({ ok: true as const, value: READ })),
    copyPath: vi.fn(async () => true),
    t: (key: string) => key,
    ...overrides,
  } as unknown as FileContentBodyProps
  return { request, props, ...render(<FileContentBody {...props} />) }
}

afterEach(cleanup)

describe('FileContentBody', () => {
  it('reads through the Remote and renders the content, reporting the resource version', async () => {
    const readFile = vi.fn(async () => ({ ok: true as const, value: READ }))
    const { request } = renderBody({ readFile })
    await act(async () => {})
    expect(readFile).toHaveBeenCalledWith('s1', 'src/agent.ts')
    expect(document.body.textContent).toContain('const a = 1')
    expect(request.loaded).toHaveBeenCalledWith('v1')
    expect(request.failed).not.toHaveBeenCalled()
  })

  it('copies the workspace-resolved absolute path', async () => {
    const copyPath = vi.fn(async () => true)
    renderBody({ copyPath })
    await act(async () => {})
    fireEvent.click(screen.getByLabelText('action.copyPath'))
    await act(async () => {})
    expect(copyPath).toHaveBeenCalledWith('/work/src/agent.ts')
  })

  it('reports a synthetic version when the file has no resource metadata', async () => {
    const { request } = renderBody({ useResource: useResourceFake(NO_VERSION) })
    await act(async () => {})
    expect(request.loaded).toHaveBeenCalledWith('file-preview')
  })

  it('surfaces a read failure and settles the revision as failed', async () => {
    const readFile = vi.fn(async () => ({ ok: false as const, error: { code: 'x', message: 'boom' } }))
    const { request } = renderBody({ readFile })
    await act(async () => {})
    expect(request.failed).toHaveBeenCalledTimes(1)
    expect(request.loaded).not.toHaveBeenCalled()
    // The key-echo t stands in for '加载失败：{message}'.
    expect(screen.getByText('state.error')).toBeTruthy()
  })

  it('settles a rejected read as failed instead of throwing', async () => {
    const readFile = vi.fn(async () => { throw new Error('wire down') })
    const { request } = renderBody({ readFile })
    await act(async () => {})
    expect(request.failed).toHaveBeenCalledTimes(1)
    expect(screen.getByText('state.error')).toBeTruthy()
  })

  it('refetches when the owner starts a new revision', async () => {
    const readFile = vi.fn(async () => ({ ok: true as const, value: READ }))
    const { props, rerender } = renderBody({ readFile })
    await act(async () => {})
    expect(readFile).toHaveBeenCalledTimes(1)
    const next = { kind: 'renderer' as const, revision: 1, loaded: vi.fn(), failed: vi.fn(), reload: vi.fn() }
    rerender(<FileContentBody {...props} content={next} />)
    await act(async () => {})
    expect(readFile).toHaveBeenCalledTimes(2)
    expect(next.loaded).toHaveBeenCalledWith('v1')
  })

  it('renders the empty placeholder for a non-session address and never fetches', async () => {
    const readFile = vi.fn(async () => ({ ok: true as const, value: READ }))
    renderBody({ resourceAddress: 'dsh-resource://file/absolute/tmp/x.ts', readFile })
    await act(async () => {})
    expect(readFile).not.toHaveBeenCalled()
    expect(screen.getByText('detail.noSelection')).toBeTruthy()
  })
})
