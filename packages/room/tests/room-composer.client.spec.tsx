// @vitest-environment jsdom
/** The room composer takeover: mention completion, dispatch submit, bare-message release, error line. */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RoomComposer } from '../src/client/RoomComposer.tsx'
import { RoomStore, type RoomGateway } from '../src/client/room-store.ts'
import type { RoomComposerProps, RoomMutationOutcome } from '../src/client/slots.ts'
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
  relays: [],
  tasks: [],
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

interface Bench {
  roomStore: RoomStore
  area: HTMLTextAreaElement
  /** The session standard kit's official input actions (stubbed). */
  inputActions: { setDraft: ReturnType<typeof vi.fn>; submit: ReturnType<typeof vi.fn> }
}

/** Render the composer with the framework shares stubbed (inputActions is a spy). */
async function bench(submit: (sessionId: SessionId, text: string) => Promise<RoomMutationOutcome>): Promise<Bench> {
  const roomStore = await primedStore()
  const inputActions = { setDraft: vi.fn(), submit: vi.fn() }
  const props = {
    sessionId: SESSION,
    matched: { room: true },
    inputActions,
    roomStore,
    submit,
    t: (key: string) => key,
  } as unknown as RoomComposerProps
  render(<RoomComposer {...props} />)
  const area = screen.getByRole('textbox') as HTMLTextAreaElement
  return { roomStore, area, inputActions }
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

  it('submits an @-message as a dispatch and clears the draft', async () => {
    const submit = vi.fn(async (): Promise<RoomMutationOutcome> => ({ ok: true }))
    const { area, inputActions } = await bench(submit)
    type(area, '@ada 出方案')
    fireEvent.keyDown(area, { key: 'Enter' })
    await waitFor(() => { expect(submit).toHaveBeenCalledWith(SESSION, '@ada 出方案') })
    await waitFor(() => { expect(area.value).toBe('') })
    // The dispatch path never touches the official input machine.
    expect(inputActions.setDraft).not.toHaveBeenCalled()
    expect(inputActions.submit).not.toHaveBeenCalled()
  })

  it('releases a bare message to the official submit path (a normal main-agent turn)', async () => {
    const submit = vi.fn(async (): Promise<RoomMutationOutcome> => ({ ok: true }))
    const { area, inputActions } = await bench(submit)
    type(area, '随便聊聊')
    fireEvent.keyDown(area, { key: 'Enter' })
    await waitFor(() => { expect(area.value).toBe('') })
    // The official input machine received the text and the submission —
    // the room Remote was never called.
    expect(inputActions.setDraft).toHaveBeenCalledWith('随便聊聊')
    expect(inputActions.submit).toHaveBeenCalledTimes(1)
    expect(submit).not.toHaveBeenCalled()
  })

  it('shows the structured error line and keeps the draft on rejection', async () => {
    const submit = vi.fn(async (): Promise<RoomMutationOutcome> => ({ ok: false, message: '未知成员：ghost' }))
    const { area } = await bench(submit)
    type(area, '@ghost 干活')
    fireEvent.keyDown(area, { key: 'Enter' })
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toBe('未知成员：ghost')
    expect(area.value).toBe('@ghost 干活')
  })
})
