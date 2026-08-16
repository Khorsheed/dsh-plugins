import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { FilePreviewController } from '../src/client/panel-service.ts'
import type { FilePreviewActions } from '../src/client/panel-service.ts'

function fakeActions(): FilePreviewActions {
  return {
    open: vi.fn(),
    close: vi.fn(),
    toggle: vi.fn(),
    select: vi.fn(),
    openPath: vi.fn(),
    refreshList: vi.fn(),
    setList: vi.fn(),
    setListLoading: vi.fn(),
    setListError: vi.fn(),
    setPreview: vi.fn(),
    setPreviewLoading: vi.fn(),
    setPreviewError: vi.fn(),
  }
}

const sid = (k: string): SessionId => k as SessionId

describe('FilePreviewController', () => {
  it('routes openPath to the drawer and the session view actions', () => {
    const controller = new FilePreviewController()
    const drawer = fakeActions()
    const view = fakeActions()
    controller.attachDrawer(drawer)
    controller.attachSession(sid('s1'), view)
    controller.openPath(sid('s1'), 'notes.md')
    expect(drawer.openPath).toHaveBeenCalledWith('notes.md')
    // The view selection stays in step without switching to the tab.
    expect(view.openPath).toHaveBeenCalledWith('notes.md')
  })

  it('routes open to the drawer when attached', () => {
    const controller = new FilePreviewController()
    const drawer = fakeActions()
    controller.attachDrawer(drawer)
    controller.open(sid('s1'))
    expect(drawer.open).toHaveBeenCalledTimes(1)
  })

  it('parks a pending path and applies it on the next view attach', () => {
    const controller = new FilePreviewController()
    controller.openPath(sid('s1'), 'notes.md')
    const drawer = fakeActions()
    const view = fakeActions()
    controller.attachDrawer(drawer)
    controller.attachSession(sid('s1'), view)
    expect(view.openPath).toHaveBeenCalledWith('notes.md')
    // The pending path is consumed once; a later gesture routes directly.
    controller.openPath(sid('s1'), 'a.md')
    expect(view.openPath).toHaveBeenCalledTimes(2)
  })

  it('keeps sessions independent', () => {
    const controller = new FilePreviewController()
    const drawer = fakeActions()
    const a = fakeActions()
    const b = fakeActions()
    controller.attachDrawer(drawer)
    controller.attachSession(sid('s1'), a)
    controller.attachSession(sid('s2'), b)
    controller.openPath(sid('s2'), 'x.md')
    expect(a.openPath).not.toHaveBeenCalled()
    expect(b.openPath).toHaveBeenCalledWith('x.md')
  })

  it('routes open to the session view actions without a drawer', () => {
    const controller = new FilePreviewController()
    const view = fakeActions()
    controller.attachSession(sid('s1'), view)
    controller.open(sid('s1'))
    expect(view.open).toHaveBeenCalledTimes(1)
  })

  it('throws before any surface wires the actions', () => {
    const controller = new FilePreviewController()
    expect(() => { controller.open(sid('s1')) }).toThrow(/no attached file view/)
  })
})
