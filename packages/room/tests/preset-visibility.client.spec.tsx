// @vitest-environment jsdom
/**
 * The M3' self-hide spec: room's session chrome (the invite chip at the
 * component level, the members tab at the REGISTRATION level) shows exactly
 * when the current session's preset composition names the
 * `@khorsheed/dsh-room-tool` row. Pinned here: the criterion's three states
 * per path (granted / not granted / every fail-open), the actual-room
 * escape (E1), the legacy top-level preset key, the tab's
 * register-while-shown / dispose-while-hidden toggle, and the chip's own
 * null return.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { InviteAgentAction } from '../src/client/InviteAgentAction.tsx'
import {
  RegistrationToggle, RoomPresetVisibility, ROOM_TOOL_ROW_MODULE,
  type RoomPluginInventorySnapshot,
} from '../src/client/preset-visibility.ts'

afterEach(() => { cleanup() })

const DEV: RoomPluginInventorySnapshot = {
  agentPresets: [
    { id: 'dev', rows: [{ moduleName: ROOM_TOOL_ROW_MODULE }] },
    { id: 'standard', rows: [{ moduleName: '@deepseek-ai/dsh-tool-bash' }] },
  ],
}

interface BenchOptions {
  /** The list rows (sessionId → row), and the current session. */
  rows?: Record<string, unknown>
  current?: string
  /** The inventory answer; undefined = a host with NO pluginInventory namespace. */
  composition?: RoomPluginInventorySnapshot
  compositionFails?: boolean
  /** Sessions the RoomStore reports as rooms (the E1 escape). */
  rooms?: readonly string[]
}

function bench(over: BenchOptions = {}) {
  const list = createSnapshotStore({
    ids: Object.keys(over.rows ?? {}),
    byId: over.rows ?? {},
    current: over.current as SessionId | undefined,
    phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  })
  const ctx = new Context()
  ctx.provide('sessions', { list, open: vi.fn() } as never)
  if (over.composition !== undefined || over.compositionFails === true) {
    ctx.provide('remote.pluginInventory', {
      list: over.compositionFails === true
        ? vi.fn(async () => ({ ok: false as const }))
        : vi.fn(async () => ({ ok: true as const, value: over.composition })),
    } as never)
  }
  const visibility = new RoomPresetVisibility(
    ctx,
    sessionId => (over.rooms ?? []).includes(sessionId),
  )
  return { ctx, list, visibility }
}

/** Flush the constructor's inventory fetch. */
async function settled(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('RoomPresetVisibility.show', () => {
  it('shows when the session preset composition names the room-tool row', async () => {
    const { visibility } = bench({
      rows: { s1: { projectionValues: { agentPreset: 'dev' } } },
      composition: DEV,
    })
    await settled()
    expect(visibility.show('s1' as SessionId)).toBe(true)
  })

  it('hides when the session preset composition does not name the row', async () => {
    const { visibility } = bench({
      rows: { s1: { projectionValues: { agentPreset: 'standard' } } },
      composition: DEV,
    })
    await settled()
    expect(visibility.show('s1' as SessionId)).toBe(false)
  })

  it('hides via the 0.1.1 top-level agentPreset key too', async () => {
    const { visibility } = bench({
      rows: { s1: { agentPreset: 'standard' } },
      composition: DEV,
    })
    await settled()
    expect(visibility.show('s1' as SessionId)).toBe(false)
  })

  it('fails open on a namespace-less host, a failed RPC, a missing or broken group, and preset-less sessions', async () => {
    const noNamespace = bench({ rows: { s1: { projectionValues: { agentPreset: 'standard' } } } })
    expect(noNamespace.visibility.show('s1' as SessionId)).toBe(true)

    const failed = bench({
      rows: { s1: { projectionValues: { agentPreset: 'standard' } } },
      compositionFails: true,
    })
    await settled()
    expect(failed.visibility.show('s1' as SessionId)).toBe(true)

    const broken = bench({
      rows: { s1: { projectionValues: { agentPreset: 'standard' } } },
      composition: { agentPresets: [{ id: 'standard', broken: 'unreadable', rows: [] }] },
    })
    await settled()
    expect(broken.visibility.show('s1' as SessionId)).toBe(true)

    const noPreset = bench({ rows: { s1: {} }, composition: DEV })
    await settled()
    expect(noPreset.visibility.show('s1' as SessionId)).toBe(true)
    expect(noPreset.visibility.show(undefined)).toBe(true)
  })

  it('always shows inside an actual room, whatever its preset granted (E1)', async () => {
    const { visibility } = bench({
      rows: { s1: { projectionValues: { agentPreset: 'standard' } } },
      composition: DEV,
      rooms: ['s1'],
    })
    await settled()
    expect(visibility.show('s1' as SessionId)).toBe(true)
  })
})

describe('RegistrationToggle (the members tab hide level)', () => {
  it('registers only while shown, disposes when hidden, and defers until the slot is ready', () => {
    const dispose = vi.fn()
    const register = vi.fn(() => dispose)
    let shown = false
    const toggle = new RegistrationToggle(register, () => shown)

    // Not ready yet: a passing criterion registers nothing.
    shown = true
    toggle.sync()
    expect(register).not.toHaveBeenCalled()

    toggle.setReady(true)
    expect(register).toHaveBeenCalledTimes(1)

    // Criterion fails (a switch to a non-granted session): the entry leaves.
    shown = false
    toggle.sync()
    expect(dispose).toHaveBeenCalledTimes(1)

    // And returns when the criterion passes again.
    shown = true
    toggle.sync()
    expect(register).toHaveBeenCalledTimes(2)

    // Slot teardown disposes a live registration.
    toggle.setReady(false)
    expect(dispose).toHaveBeenCalledTimes(2)
  })
})

describe('InviteAgentAction self-hide', () => {
  function face(show: () => boolean, subscribe: (listener: () => void) => () => void = () => () => {}) {
    return {
      roomCwd: '/home/user/room',
      invite: vi.fn(async () => ({ ok: true as const, pendingFirstTask: false })),
      listProviders: vi.fn(async () => ({ localAgentAvailable: true, providers: [] })),
      browseDirectory: vi.fn(async () => null),
      listNames: vi.fn(() => []),
      roomChrome: { show, subscribe },
    }
  }

  it('renders the chip when the criterion passes', () => {
    render(<InviteAgentAction {...({ ...face(() => true), sessionId: 's1', t: (key: string) => key } as never)} />)
    expect(screen.getByRole('button', { name: 'action.inviteAgent' })).toBeDefined()
  })

  it('renders nothing when the session is not granted and is no room', () => {
    render(<InviteAgentAction {...({ ...face(() => false), sessionId: 's1', t: (key: string) => key } as never)} />)
    expect(screen.queryByRole('button', { name: 'action.inviteAgent' })).toBeNull()
  })

  it('re-renders when the criterion flips (a session switch notification)', async () => {
    let shown = false
    let listener: (() => void) | undefined
    const subscribe = (next: () => void): (() => void) => {
      listener = next
      return () => {}
    }
    render(<InviteAgentAction {...({ ...face(() => shown, subscribe), sessionId: 's1', t: (key: string) => key } as never)} />)
    expect(screen.queryByRole('button', { name: 'action.inviteAgent' })).toBeNull()
    shown = true
    listener?.()
    await waitFor(() => expect(screen.getByRole('button', { name: 'action.inviteAgent' })).toBeDefined())
  })
})
