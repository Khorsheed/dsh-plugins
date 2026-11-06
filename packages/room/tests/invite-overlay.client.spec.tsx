// @vitest-environment jsdom
/**
 * The invite dialog opened from the room's 「＋ 邀请成员」 capsule is an
 * overlay: the host Modal portals it to document.body (never inside the
 * composer dock, so the composer cannot reflow), Esc / 取消 / the mask close
 * it, and focus returns to the capsule.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RoomTaskCapsule } from '../src/client/RoomTaskCapsule.tsx'
import { zh } from '../src/client/locales.ts'
import type { RoomProviderList, RoomState } from '../src/types.ts'

afterEach(() => { cleanup() })

const t = makeTranslate(zh)
const ROOM: RoomState = { members: [{ name: 'dsh', kind: 'main-agent', invitedBy: 'human' }], relays: [], tasks: [], runs: [] }
const PROVIDERS: RoomProviderList = {
  localAgentAvailable: true,
  providers: [{ provider: 'kimi-cli', displayName: 'Kimi CLI', authenticated: true }],
}

/** The capsule docked above a composer stand-in, the way RoomComposer stacks them. */
function mount() {
  const view = render(
    <div data-testid="dock">
      <RoomTaskCapsule
        state={ROOM}
        invite={async () => ({ ok: true }) as never}
        listProviders={async () => PROVIDERS}
        roomCwd="/home/user/game"
        browseDirectory={async () => null}
        t={t as never}
      />
      <div data-testid="composer" />
    </div>,
  )
  const dock = screen.getByTestId('dock')
  const trigger = screen.getByRole('button', { name: '＋ 邀请成员' })
  return { view, dock, trigger }
}

async function open(trigger: HTMLElement): Promise<HTMLElement> {
  trigger.focus()
  await act(async () => { fireEvent.click(trigger) })
  return screen.findByRole('dialog')
}

describe('invite dialog overlay', () => {
  it('opens as a body-level modal: the composer dock keeps its exact structure', async () => {
    const { dock, trigger } = mount()
    const before = dock.innerHTML
    const dialog = await open(trigger)
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-label')).toBe('邀请成员')
    // Portaled out of the dock: nothing was inserted before or around the composer.
    expect(dock.contains(dialog)).toBe(false)
    expect(dialog.closest('[data-testid="dock"]')).toBeNull()
    expect(dock.innerHTML).toBe(before)
    expect(screen.getByTestId('composer').previousElementSibling).toBe(dock.firstElementChild)
    // Focus moved into the dialog.
    await waitFor(() => { expect(dialog.contains(document.activeElement)).toBe(true) })
  })

  it('Esc closes it and focus returns to the capsule', async () => {
    const { trigger } = mount()
    await open(trigger)
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(document.activeElement).toBe(trigger)
  })

  it('取消 closes it and focus returns to the capsule', async () => {
    const { trigger } = mount()
    const dialog = await open(trigger)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(dialog.isConnected).toBe(false)
    expect(document.activeElement).toBe(trigger)
  })

  it('a click on the dimmed mask closes it', async () => {
    const { trigger } = mount()
    const dialog = await open(trigger)
    const mask = dialog.parentElement!.querySelector('[aria-hidden="true"]')!
    fireEvent.click(mask)
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('Tab stays inside the dialog', async () => {
    const { trigger } = mount()
    const dialog = await open(trigger)
    const buttons = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), textarea:not(:disabled)')]
    buttons.at(-1)!.focus()
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' })
    expect(dialog.contains(document.activeElement)).toBe(true)
  })
})
