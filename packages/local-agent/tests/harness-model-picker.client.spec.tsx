// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HarnessModelPicker, type ModelDirectoryFace } from '../src/client/HarnessModelPicker.tsx'
import type { LocalAgentModelDirectory } from '../src/types.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const t = (key: keyof typeof zh): string => zh[key]
const ready: LocalAgentModelDirectory = { entries: [{ value: 'alias', label: 'Full Native Label', resolvedModel: 'resolved-model-id', source: 'native' }], customInput: true, complete: true, status: 'ready', refreshing: false, revision: 2 }
const untilAbort = (signal: AbortSignal): Promise<void> => new Promise(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true }) })
function open(container: HTMLElement) { act(() => { container.querySelector('details')!.open = true; fireEvent(container.querySelector('details')!, new Event('toggle')) }) }

describe('harness model picker', () => {
  it('chooses the first candidate only when unset and incorporates the native directory without reopening', async () => {
    let complete!: () => void
    const result = new Promise<void>(resolve => { complete = resolve })
    const face: ModelDirectoryFace = {
      read: vi.fn(async () => ready),
      follow: vi.fn(async function* (signal) {
        yield { ...ready, entries: [], status: 'loading', complete: false, revision: 1 } as LocalAgentModelDirectory
        await result
        yield ready
        await untilAbort(signal)
      }),
    }
    const change = vi.fn()
    const view = render(<HarnessModelPicker face={face} value="" onChange={change} t={t} />)
    expect(face.follow).toHaveBeenCalledTimes(1)
    open(view.container)
    await screen.findByText(new RegExp(zh['configuration.directory.loading']))
    await act(async () => complete())
    const option = await screen.findByRole('option', { name: /Full Native Label/ })
    expect(option.textContent).toContain('alias → resolved-model-id')
    await waitFor(() => expect(change).toHaveBeenCalledWith('alias'))
    fireEvent.click(option)
    expect(view.container.querySelector('details')!.open).toBe(false)
    open(view.container)
    expect(screen.queryByLabelText(zh['configuration.effort'])).toBeNull()
    expect(screen.queryByText(zh['configuration.custom'])).toBeNull()
    expect(screen.queryByText(zh['configuration.details'])).toBeNull()

  })

  it('preserves a saved choice even when it is absent from a refreshed directory', async () => {
    const face: ModelDirectoryFace = { read: async () => ready, follow: async function* (signal) { yield ready; await untilAbort(signal) } }
    const change = vi.fn()
    const view = render(<HarnessModelPicker face={face} value="previous-user-model" onChange={change} t={t} />)
    open(view.container)
    await screen.findByRole('option', { name: /Full Native Label/ })
    expect(change).not.toHaveBeenCalled()
    expect(screen.getByText('previous-user-model')).toBeTruthy()
    expect(screen.queryByText(zh['configuration.default'])).toBeNull()
  })

  it('dismisses on outside pointer or Escape, returns keyboard focus, and never submits on dismissal', async () => {
    const face: ModelDirectoryFace = { read: async () => ready, follow: async function* (signal) { yield ready; await untilAbort(signal) } }
    const change = vi.fn()
    const view = render(<HarnessModelPicker face={face} value="alias" onChange={change} t={t} />)
    open(view.container)
    await screen.findByRole('option', { name: /Full Native Label/ })
    fireEvent.pointerDown(screen.getByLabelText(zh['configuration.search']))
    expect(view.container.querySelector('details')!.open).toBe(true)
    fireEvent.pointerDown(document.body)
    expect(view.container.querySelector('details')!.open).toBe(false)
    open(view.container)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(view.container.querySelector('details')!.open).toBe(false)
    expect(document.activeElement).toBe(view.container.querySelector('summary'))
    expect(change).not.toHaveBeenCalled()
    open(view.container)
    await screen.findByRole('option', { name: /Full Native Label/ })
  })

  it('hides the previous provider directory immediately when its ownership changes', async () => {
    const first: ModelDirectoryFace = { read: async () => ready, follow: async function* (signal) { yield ready; await untilAbort(signal) } }
    const second: ModelDirectoryFace = { read: async () => null, follow: async function* (signal) { await untilAbort(signal) } }
    const view = render(<HarnessModelPicker face={first} value="" onChange={() => {}} t={t} />)
    open(view.container)
    await screen.findByRole('option', { name: /Full Native Label/ })
    view.rerender(<HarnessModelPicker face={second} value="" onChange={() => {}} t={t} />)
    expect(screen.queryByRole('option', { name: /Full Native Label/ })).toBeNull()
    await waitFor(() => expect(screen.getByText(zh.loading)).toBeTruthy())
  })
})
