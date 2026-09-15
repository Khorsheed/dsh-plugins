// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemberConfiguration } from '../src/client/MemberConfiguration.tsx'
import { MemberConfigurationStore, MemberConfigurationStores, type MemberConfigurationFace } from '../src/client/member-configuration.ts'
import type { LocalAgentMemberControlState, LocalAgentModelDirectory } from '../src/types.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const t = (key: keyof typeof zh): string => zh[key]
const directory: LocalAgentModelDirectory = { status: 'ready', revision: 1, refreshing: false, complete: true, customInput: true, entries: [
  { value: 'long-native-model-id', label: 'Full native model label', resolvedModel: 'native-resolved-id', source: 'native', reasoning: { options: [{ value: 'low', label: 'Native low' }] } },
  { value: 'historical', label: 'Observed model', source: 'history' },
] }
function state(): LocalAgentMemberControlState {
  const current = { revision: 0, selection: { model: { mode: 'value' as const, value: 'old-model' }, effort: { mode: 'default' as const } }, resolved: { model: 'old-model', effort: 'high' } }
  return { memberId: 'member', revision: 0, status: 'idle', current, round: { id: 'round', configuration: current } }
}
function bench(initial = state()) {
  let current = initial
  let notify: (() => void) | undefined
  const follow = vi.fn(async function* (_id: string, signal: AbortSignal) {
    signal.addEventListener('abort', () => notify?.(), { once: true })
    while (!signal.aborted) {
      yield structuredClone(current)
      await new Promise<void>(resolve => { notify = resolve; if (signal.aborted) resolve() })
    }
  })
  const face: MemberConfigurationFace = {
    read: async () => structuredClone(current), follow,
    directory: async () => directory,
    followDirectory: async function* (_id, signal) { yield directory; await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })) },
    select: vi.fn(async (_id, request, revision, selection) => {
      if (revision !== current.revision) return { requestId: request, revision: current.revision, status: 'conflict', error: 'changed elsewhere' }
      current = { ...current, revision: revision + 1, status: 'pending', pending: { revision: revision + 1, requestId: request, kind: 'selection', selection } }
      notify?.()
      return { requestId: request, revision: current.revision, status: 'pending' }
    }),
    cancel: vi.fn(async (_id, request, revision) => {
      current = { ...current, revision: revision + 1, status: 'idle' }; delete current.pending
      notify?.()
      return { requestId: request, revision: current.revision, status: 'cancelled' }
    }),
    retry: vi.fn(async () => {}),
  }
  const stores = new MemberConfigurationStores(face)
  return { face, follow, stores, store: stores.get('member'), update: (next: LocalAgentMemberControlState) => { current = next; notify?.() } }
}
function open(container: HTMLElement) { fireEvent.click(container.querySelector('summary')!); container.querySelector('details')!.open = true }

describe('shared member configuration UI', () => {
  it('accepts model and native effort during a running round, shares pending state and cancels without changing that round', async () => {
    const h = bench()
    const first = render(<MemberConfiguration store={h.store} t={t} />)
    const second = render(<MemberConfiguration store={h.stores.get('member')} t={t} />)
    open(first.container); open(second.container)
    const a = within(first.container); const b = within(second.container)
    await waitFor(() => expect(a.getByRole('option', { name: /Full native model label/ }).closest('fieldset')?.disabled).toBe(false))
    expect(h.follow).toHaveBeenCalledTimes(1)
    fireEvent.click(a.getByRole('option', { name: /Full native model label/ }))
    fireEvent.change(a.getByLabelText(zh['configuration.effort']), { target: { value: 'value:low' } })
    fireEvent.click(a.getByRole('button', { name: zh['configuration.apply'] }))
    await waitFor(() => expect(b.getByText('long-native-model-id · low')).toBeTruthy())
    expect(a.getAllByText('old-model · high').length).toBeGreaterThan(0)
    expect(h.face.select).toHaveBeenCalledWith('member', expect.any(String), 0, { model: { mode: 'value', value: 'long-native-model-id' }, effort: { mode: 'value', value: 'low' } })
    expect(a.getByText('long-native-model-id → native-resolved-id')).toBeTruthy()
    fireEvent.click(b.getByRole('button', { name: zh['configuration.cancel'] }))
    await waitFor(() => expect(a.queryByText('long-native-model-id · low')).toBeNull())
    expect(b.getAllByText('old-model · high').length).toBeGreaterThan(0)
  })

  it('rejects a stale draft instead of overwriting another entry, then adopts the authoritative selection', async () => {
    const h = bench(); const view = render(<MemberConfiguration store={h.store} t={t} />); open(view.container)
    await screen.findByRole('option', { name: /Full native model label/ })
    fireEvent.click(screen.getByRole('option', { name: /Full native model label/ }))
    await act(async () => h.update({ ...state(), revision: 1, pending: { kind: 'selection', revision: 1, requestId: 'other', selection: { model: { mode: 'value', value: 'historical' }, effort: { mode: 'default' } } } }))
    fireEvent.click(screen.getByRole('button', { name: zh['configuration.apply'] }))
    await screen.findByText('changed elsewhere')
    expect(h.face.select).toHaveBeenCalledWith('member', expect.any(String), 0, expect.any(Object))
    await waitFor(() => expect(screen.getByRole('option', { name: /Observed model/ }).getAttribute('aria-selected')).toBe('true'))
  })

  it('shows frozen conditions and leaves choices disabled even when the member is idle', async () => {
    const initial = state(); delete initial.round; initial.lockedReason = 'Frozen eval conditions'
    const h = bench(initial); const view = render(<MemberConfiguration store={h.store} t={t} />); open(view.container)
    await screen.findByText('Frozen eval conditions')
    expect(screen.getByRole('option', { name: /Full native model label/ }).closest('fieldset')?.disabled).toBe(true)
    expect((screen.getByRole('button', { name: zh['configuration.apply'] }) as HTMLButtonElement).disabled).toBe(true)
    expect(h.face.select).not.toHaveBeenCalled()
  })

  it('does not replace a newer stream phase with a delayed read at the same intent revision', async () => {
    const h = bench()
    let complete!: (value: LocalAgentMemberControlState) => void
    h.face.read = () => new Promise(resolve => { complete = resolve })
    const store = new MemberConfigurationStore('member', h.face)
    const unsubscribe = store.subscribe(() => {})
    await waitFor(() => expect(store.getSnapshot().connected).toBe(true))
    const refresh = store.refresh()
    h.update({ ...state(), status: 'failed', error: 'native control failed' })
    await waitFor(() => expect(store.getSnapshot().state?.status).toBe('failed'))
    complete(state()); await refresh
    expect(store.getSnapshot().state?.status).toBe('failed')
    unsubscribe()
  })
})
