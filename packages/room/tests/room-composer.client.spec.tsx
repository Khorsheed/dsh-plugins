// @vitest-environment jsdom
/** The room composer takeover: mention completion, submit, note hint, error line. */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RoomComposer } from '../src/client/RoomComposer.tsx'
import { RoomStore, type RoomGateway } from '../src/client/room-store.ts'
import type { RoomComposerProps, RoomSubmitOutcome } from '../src/client/slots.ts'
import type { RoomState } from '../src/types.ts'

afterEach(() => {
  cleanup()
})

const SESSION = 'room-1' as SessionId

const STATE: RoomState = {
  members: [
    { name: 'main', kind: 'main-agent', invitedBy: 'human' },
    { name: 'ada', kind: 'cli', provider: 'kimi', invitedBy: 'human' },
    { name: 'bill', kind: 'cli', provider: 'codex', invitedBy: 'agent' },
  ],
  blackboard: [],
  cursors: [],
  runs: [],
}

/** A store pre-primed with the STATE fixture. */
async function primedStore(): Promise<RoomStore> {
  const list = createSnapshotStore<{ current: SessionId | undefined }>({ current: undefined })
  const gateway: RoomGateway = {
    isRoom: async () => ({ ok: true, value: true }),
    getState: async () => ({ ok: true, value: { ok: true, value: STATE } }),
  }
  const store = new RoomStore({ sessions: { list } } as unknown as ClientContext, gateway)
  await store.ensure(SESSION)
  return store
}

/** Render the composer with the framework shares stubbed (they are unused by this component). */
async function bench(submit: (sessionId: SessionId, text: string) => Promise<RoomSubmitOutcome>) {
  const roomStore = await primedStore()
  const props = {
    sessionId: SESSION,
    matched: { room: true },
    roomStore,
    submit,
    t: (key: string) => key,
  } as unknown as RoomComposerProps
  render(<RoomComposer {...props} />)
  const area = screen.getByRole('textbox') as HTMLTextAreaElement
  return { roomStore, area }
}

/** Change the draft with the caret at the end (a real typing position). */
function type(area: HTMLTextAreaElement, value: string): void {
  fireEvent.change(area, { target: { value, selectionStart: value.length, selectionEnd: value.length } })
}

describe('RoomComposer', () => {
  it('renders the textarea and a disabled send button on an empty draft', async () => {
    await bench(vi.fn())
    expect(screen.getByRole('textbox')).toBeDefined()
    expect((screen.getByRole('button', { name: 'composer.send' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('lists roster members on @ and inserts the picked name', async () => {
    const { area } = await bench(vi.fn())
    type(area, '@')
    // Only existing members — main agent included, no invite entry.
    const options = screen.getAllByRole('option')
    expect(options.map(option => option.textContent)).toEqual([
      'mainmember.kind.main', 'ada' + 'kimi', 'bill' + 'codex',
    ])
    // Keyboard: down to ada, Enter picks.
    fireEvent.keyDown(area, { key: 'ArrowDown' })
    fireEvent.keyDown(area, { key: 'Enter' })
    expect(area.value).toBe('@ada ')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('filters candidates by the typed prefix and Esc closes the menu', async () => {
    const { area } = await bench(vi.fn())
    type(area, '@b')
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]!.textContent).toContain('bill')
    fireEvent.keyDown(area, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    // A later complete token re-opens completion after it.
    type(area, '@ada @')
    expect(screen.getAllByRole('option')).toHaveLength(3)
  })

  it('submits on Enter, clears the draft, and shows no hint for a dispatch', async () => {
    const submit = vi.fn(async (): Promise<RoomSubmitOutcome> => ({ ok: true, dispatched: true }))
    const { area } = await bench(submit)
    type(area, '@ada 出方案')
    fireEvent.keyDown(area, { key: 'Enter' })
    await waitFor(() => { expect(submit).toHaveBeenCalledWith(SESSION, '@ada 出方案') })
    await waitFor(() => { expect(area.value).toBe('') })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows the blackboard hint for a bare message', async () => {
    const submit = vi.fn(async (): Promise<RoomSubmitOutcome> => ({ ok: true, dispatched: false }))
    const { area } = await bench(submit)
    type(area, '随便聊聊')
    fireEvent.keyDown(area, { key: 'Enter' })
    await screen.findByRole('status')
    expect(screen.getByRole('status').textContent).toBe('composer.noted')
  })

  it('shows the structured error line and keeps the draft on rejection', async () => {
    const submit = vi.fn(async (): Promise<RoomSubmitOutcome> => ({ ok: false, message: '未知成员：ghost' }))
    const { area } = await bench(submit)
    type(area, '@ghost 干活')
    fireEvent.keyDown(area, { key: 'Enter' })
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toBe('未知成员：ghost')
    expect(area.value).toBe('@ghost 干活')
  })
})
