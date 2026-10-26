// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AdaptiveSplit, useAdaptiveSplitBack } from '../src/client/AdaptiveSplit.tsx'
import { PanelHeader } from '../src/client/PanelHeader.tsx'

let resize: (width: number) => void
const disconnect = vi.fn()
beforeEach(() => {
  disconnect.mockClear()
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) {
      resize = width => act(() => callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver))
    }
    observe() {}
    disconnect = disconnect
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function Fixture() {
  const [open, setOpen] = useState(false)
  return <AdaptiveSplit detailOpen={open} onBack={() => setOpen(false)} backLabel="Files"
    master={<><input aria-label="Filter" defaultValue=""/><button onClick={() => setOpen(true)}>README.md</button></>}
    detail={<textarea aria-label="Draft" defaultValue="Unsaved draft"/>}/>
}

it('retains selection, draft, filter and element identity across navigation and container changes', () => {
  const { container, unmount } = render(<Fixture />)
  resize(390)
  const file = screen.getByRole('button', { name: 'README.md' })
  const filter = screen.getByRole('textbox', { name: 'Filter' })
  fireEvent.change(filter, { target: { value: 'README' } })
  file.focus()
  fireEvent.click(file)
  const draft = screen.getByRole('textbox', { name: 'Draft' })
  fireEvent.change(draft, { target: { value: 'Keep my edits' } })
  const back = screen.getByRole('button', { name: 'Files' })
  expect(document.activeElement).toBe(back)
  expect(screen.queryByRole('button', { name: 'README.md' })).toBeNull()
  resize(760)
  expect(screen.getByRole('button', { name: 'README.md' })).toBe(file)
  expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(draft)
  resize(390)
  fireEvent.click(back)
  expect(document.activeElement).toBe(file)
  expect((filter as HTMLInputElement).value).toBe('README')
  fireEvent.click(file)
  expect((screen.getByRole('textbox', { name: 'Draft' }) as HTMLTextAreaElement).value).toBe('Keep my edits')
  resize(0)
  expect(container.firstElementChild?.getAttribute('data-adaptive-split')).toBe('narrow')
  unmount()
  expect(disconnect).toHaveBeenCalledOnce()
})

it('keeps both surfaces available when ResizeObserver is unavailable', () => {
  vi.stubGlobal('ResizeObserver', undefined)
  render(<Fixture />)
  expect(screen.getByRole('button', { name: 'README.md' })).toBeTruthy()
  expect(screen.getByRole('textbox', { name: 'Draft' })).toBeTruthy()
})

/** A detail with its own title bar, drawing the split's back control there. */
function OwnHeaderDetail() {
  const back = useAdaptiveSplitBack()
  return <><PanelHeader title="README.md" moreLabel="More" onBack={back?.onBack} backLabel={back?.backLabel} backRef={back?.backRef} />
    <textarea aria-label="Draft" defaultValue="" /></>
}

function OwnHeaderFixture() {
  const [open, setOpen] = useState(false)
  return <AdaptiveSplit backInDetail detailOpen={open} onBack={() => setOpen(false)} backLabel="Files"
    master={<button onClick={() => setOpen(true)}>README.md</button>}
    detail={<OwnHeaderDetail />}/>
}

it('lets a backInDetail detail draw the one back control, narrow only, and focuses it on open', () => {
  render(<OwnHeaderFixture />)
  resize(560)
  fireEvent.click(screen.getByRole('button', { name: 'README.md' }))
  // Exactly one back control, and it is the detail's own header button.
  const backs = screen.getAllByRole('button', { name: 'Files' })
  expect(backs).toHaveLength(1)
  expect(document.activeElement).toBe(backs[0])
  fireEvent.click(backs[0]!)
  expect(screen.getByRole('button', { name: 'README.md' })).toBeTruthy()
  // Wide: no back control at all.
  resize(800)
  expect(screen.queryByRole('button', { name: 'Files' })).toBeNull()
})

