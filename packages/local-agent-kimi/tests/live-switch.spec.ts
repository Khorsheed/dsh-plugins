import { describe, expect, it, vi } from 'vitest'
import { LiveDriverSwitch } from '../src/live-switch.ts'

/** A switch with the live harness off (no driver generation), on a stub host. */
function mount(localAgent: unknown) {
  const warn = vi.fn()
  const ctx = { localAgent, logger: { warn } }
  const face = { get: () => ({ live: false }), watch: () => () => {} }
  const live = new LiveDriverSwitch(ctx as never, face as never, undefined)
  // The generations' reclaim hook (`onReclaimedWithTasks`) lands here.
  const reclaimed = (child: string, ids: readonly string[]) => (live as unknown as { noteReclaimed(child: string, ids: readonly string[]): void }).noteReclaimed(child, ids)
  return { live, reclaimed, warn }
}

describe('kimi live switch: a reclaim that cut background tasks off (C①)', () => {
  it('remembers the tasks first, then tells the core, which tells the member\'s room', () => {
    const order: string[] = []
    let live: LiveDriverSwitch | undefined
    const note = vi.fn((child: string, ids: readonly string[], because: string) => {
      order.push(`core:${child}:${ids.join(',')}:${because}`)
      // A read the report triggers already says process-reclaimed.
      order.push(`read:${String(live!.wasReclaimedWith(child, ids[0]!))}`)
    })
    const m = mount({ noteBackgroundTasksLost: note })
    live = m.live
    m.reclaimed('child-1', ['bash-1', 'agent-2'])
    expect(order).toEqual(['core:child-1:bash-1,agent-2:process-reclaimed', 'read:true'])
    expect(m.live.wasReclaimedWith('child-1', 'agent-2')).toBe(true)
  })

  it('an older core without the hook, or a throwing one: the tray fact still holds, nothing escapes', () => {
    const old = mount({})
    old.reclaimed('child-1', ['bash-1'])
    expect(old.live.wasReclaimedWith('child-1', 'bash-1')).toBe(true)
    const broken = mount({ noteBackgroundTasksLost: () => { throw new Error('boom') } })
    expect(() => broken.reclaimed('child-1', ['bash-1'])).not.toThrow()
    expect(broken.live.wasReclaimedWith('child-1', 'bash-1')).toBe(true)
    expect(broken.warn).toHaveBeenCalledTimes(1)
  })
})
