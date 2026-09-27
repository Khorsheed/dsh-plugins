// @vitest-environment jsdom
/** T86 step 2: the sidebar body follows the host's navigations over its own back stack, and survives a reload that drops the params. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InspectReads } from '../src/client/InspectPane.tsx'
import { createInspectTitles, SidebarInspect, SidebarInspectTitle, type TabInfoLike } from '../src/client/SidebarInspect.tsx'
import { inspectMemoryKey, type InspectTarget } from '../src/client/inspect-target.ts'

const t = (key: string, params?: Record<string, unknown>): string => (
  params === undefined ? key : `${key} ${JSON.stringify(params)}`
)
const reads = {
  fetchItemMaterials: undefined, fetchDatasetFile: undefined, fetchJudgePromptPreview: undefined, fetchJudgePrompt: undefined,
} as unknown as InspectReads
const item = (id: string): InspectTarget => ({ page: 'item', experimentId: 'e1', item: id })
const title = (id: string) => `inspect.title {"item":"${id}"}`

function info(tabId: string, revision: number, target: InspectTarget | null, close = vi.fn()): TabInfoLike {
  return { tab: { id: tabId, title: 'type title', navigation: { params: target === null ? undefined : { target }, revision }, actions: { close } } }
}

describe('the sidebar inspect body', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(cleanup)

  it('pushes each new navigation, goes back, and closes through the host', () => {
    const titles = createInspectTitles()
    const close = vi.fn()
    let now = info('tab-1', 1, item('F1'), close)
    const view = () => <SidebarInspect sessionId={'s1' as SessionId} useTabInfo={() => now} t={t} reads={reads} titles={titles} />
    const { rerender } = render(view())
    expect(screen.getByText(title('F1'))).toBeTruthy()
    now = info('tab-1', 2, item('F2'), close)
    rerender(view())
    expect(screen.getByText(title('F2'))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'inspect.back' }))
    expect(screen.getByText(title('F1'))).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'inspect.back' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'inspect.close' }))
    expect(close).toHaveBeenCalled()
  })

  it('redraws the remembered stack when a reload restores the tab without params', () => {
    const titles = createInspectTitles()
    const first = render(<SidebarInspect sessionId={'s1' as SessionId} useTabInfo={() => info('tab-1', 3, item('F3'))} t={t} reads={reads} titles={titles} />)
    first.unmount()
    expect(localStorage.getItem(inspectMemoryKey('s1'))).toContain('F3')
    render(<SidebarInspect sessionId={'s1' as SessionId} useTabInfo={() => info('tab-1', 0, null)} t={t} reads={reads} titles={titles} />)
    expect(screen.getByText(title('F3'))).toBeTruthy()
  })

  it('shows the recent list on an empty tab, and the chip follows the top', () => {
    const titles = createInspectTitles()
    render(<SidebarInspect sessionId={'s2' as SessionId} useTabInfo={() => info('tab-9', 0, null)} t={t} reads={reads} titles={titles} />)
    expect(screen.getByText('inspect.nothing')).toBeTruthy()
    cleanup()
    render(<SidebarInspect sessionId={'s2' as SessionId} useTabInfo={() => info('tab-9', 1, item('F4'))} t={t} reads={reads} titles={titles} />)
    render(<SidebarInspectTitle useTabInfo={() => info('tab-9', 1, item('F4'))} titles={titles} />)
    expect(screen.getAllByText(title('F4')).length).toBe(2)
    act(() => { titles.set('tab-9', 'other') })
    expect(screen.getByText('other')).toBeTruthy()
  })
})
