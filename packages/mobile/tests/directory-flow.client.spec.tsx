// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DirectoryFlow } from '../src/client/DirectoryFlow.tsx'
import { MobileDirectory, installMobileDirectoryPicker } from '../src/client/directory.ts'
import { MobileNavigation, type NavigationCapabilities } from '../src/client/navigation.ts'
import { en } from '../src/client/locales.ts'
import type { MobileDirectoryListing } from '../src/protocol.ts'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
})
afterEach(cleanup)
const t = (key: keyof typeof en) => en[key]
const level = (path = '/home/user'): MobileDirectoryListing => ({ path, parent: '/home', entries: [{ name: 'project', path: '/home/user/project', hidden: false }, { name: '.hidden', path: '/home/user/.hidden', hidden: true }], truncated: false })
function setup() {
  const directory = new MobileDirectory(), navigation = new MobileNavigation()
  const picked = vi.fn(), cancel = vi.fn()
  const list = vi.spyOn(directory, 'list').mockImplementation(async path => level(path))
  return { directory, navigation, list, picked, cancel, props: { open: true, busy: false, preferSaved: true, onPicked: picked, onCancel: cancel, onError: vi.fn(), directory, navigation, t } }
}
describe('remote workspace directory flow', () => {
  it('browses and validates before passing a path to the official owner, never autofocusing a textbox', async () => {
    const { props, picked, list } = setup(); render(<DirectoryFlow {...props}/>)
    expect(document.activeElement?.tagName).not.toBe('INPUT')
    fireEvent.click(screen.getByRole('button', { name: 'Browse computer' }))
    await screen.findByRole('button', { name: 'project' })
    expect(screen.queryByRole('button', { name: '.hidden' })).toBeNull()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: '.hidden' })).toBeTruthy()
    fireEvent.click(screen.getByText('Enter a path'))
    fireEvent.click(screen.getByRole('button', { name: 'project' }))
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveProperty('value', '/home/user/project'))
    fireEvent.click(screen.getByRole('button', { name: 'Use this directory' }))
    expect(picked).toHaveBeenCalledExactlyOnceWith('/home/user/project')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '/missing' } })
    expect(screen.getByRole('button', { name: 'Use this directory' }).hasAttribute('disabled')).toBe(true)
    list.mockRejectedValueOnce(new Error('missing'))
    fireEvent.click(screen.getByRole('button', { name: 'Go', exact: true }))
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: 'Use this directory' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(list).toHaveBeenLastCalledWith('/missing', expect.any(AbortSignal))
  })
  it('opens saved workspace paths and preserves adoption busy/cancel behavior', async () => {
    const { props, navigation, list, picked, cancel } = setup()
    const items = [{ path: '/home/user/project', title: 'Project' }]
    navigation.set({ workspaces: { list: { subscribe: () => () => {}, getSnapshot: () => ({ items }) } } } as unknown as NavigationCapabilities)
    const view = render(<DirectoryFlow {...props}/>)
    fireEvent.click(screen.getByRole('button', { name: /Project/ }))
    await waitFor(() => expect(list).toHaveBeenCalledWith('/home/user/project', expect.any(AbortSignal)))
    view.rerender(<DirectoryFlow {...props} busy/>)
    fireEvent.click(screen.getByRole('button', { name: 'Use this directory' })); expect(picked).not.toHaveBeenCalled()
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: false, cancelable: true })); expect(cancel).not.toHaveBeenCalled()
    view.rerender(<DirectoryFlow {...props}/>); fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(cancel).toHaveBeenCalledOnce()
  })
  it('aborts old reads and ignores late results after a newer navigation or dismissal', async () => {
    const { props, list } = setup()
    const requests: { signal: AbortSignal; resolve: (value: MobileDirectoryListing) => void }[] = []
    list.mockImplementation((_path, signal) => new Promise(resolve => { requests.push({ signal, resolve }) }))
    const view = render(<DirectoryFlow {...props}/>)
    fireEvent.click(screen.getByRole('button', { name: 'Browse computer' }))
    fireEvent.click(screen.getByText('Enter a path'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '/new' } }); fireEvent.click(screen.getByRole('button', { name: 'Go', exact: true }))
    expect(requests[0]!.signal.aborted).toBe(true)
    await act(async () => { requests[1]!.resolve(level('/new')); requests[0]!.resolve(level('/old')) })
    expect(screen.getByRole('textbox')).toHaveProperty('value', '/new')
    fireEvent.click(screen.getByRole('button', { name: 'Parent folder' }))
    view.rerender(<DirectoryFlow {...props} open={false}/>); expect(requests[2]!.signal.aborted).toBe(true)
  })
})
it('routes all mobile picks to one pending choice and restores desktop ownership on unload', async () => {
  const native = vi.fn(async () => '/desktop')
  const owner = Object.create({ pickDirectory: native }) as { pickDirectory(): Promise<string | null> }
  const directory = new MobileDirectory(); let active = true
  const restore = installMobileDirectoryPicker(owner, directory, () => active)
  const first = owner.pickDirectory(); expect(owner.pickDirectory()).toBe(first); expect(native).not.toHaveBeenCalled()
  directory.finish('/selected'); await expect(first).resolves.toBe('/selected')
  active = false; await expect(owner.pickDirectory()).resolves.toBe('/desktop')
  active = true; const cancelled = owner.pickDirectory(); restore(); await expect(cancelled).resolves.toBeNull()
  expect(Object.hasOwn(owner, 'pickDirectory')).toBe(false); expect(owner.pickDirectory).toBe(native)
})

it('starts adding a workspace with selectable folders, keeping path entry secondary', async () => {
  const { props, list } = setup()
  render(<DirectoryFlow {...props} preferSaved={false}/>)
  await screen.findByRole('button', { name: 'project' })
  expect(list).toHaveBeenCalledExactlyOnceWith(undefined, expect.any(AbortSignal))
  expect(document.querySelector('[data-directory-manual]')?.hasAttribute('open')).toBe(false)
  expect(screen.getByRole('button', { name: 'Use this directory' }).hasAttribute('disabled')).toBe(false)
})
