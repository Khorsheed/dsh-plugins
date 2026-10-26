import { describe, expect, it, vi } from 'vitest'
import {
  editInPlace, turnSettled, waitForTurnSettled, withdrawInPlace, type TurnSettleSnapshot,
} from '../src/client/edit-in-place.ts'

function steps() {
  return {
    cancel: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    waitIdle: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    edit: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }
}

function withdrawSteps() {
  return {
    cancel: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    waitIdle: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    withdraw: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }
}

describe('editInPlace', () => {
  it('cancels the running turn, waits for the settle, then edits (in order)', async () => {
    const s = steps()
    const order: string[] = []
    s.cancel.mockImplementation(() => { order.push('cancel'); return Promise.resolve() })
    s.waitIdle.mockImplementation(() => { order.push('waitIdle'); return Promise.resolve() })
    s.edit.mockImplementation(() => { order.push('edit'); return Promise.resolve() })
    await editInPlace(s, true)
    expect(order).toEqual(['cancel', 'waitIdle', 'edit'])
  })

  it('never cancels an idle session', async () => {
    const s = steps()
    await editInPlace(s, false)
    expect(s.cancel).not.toHaveBeenCalled()
    expect(s.waitIdle).not.toHaveBeenCalled()
    expect(s.edit).toHaveBeenCalledTimes(1)
  })

  it('rejects without editing when the cancel fails', async () => {
    const s = steps()
    s.cancel.mockRejectedValue(new Error('cancel denied'))
    await expect(editInPlace(s, true)).rejects.toThrow('cancel denied')
    expect(s.waitIdle).not.toHaveBeenCalled()
    expect(s.edit).not.toHaveBeenCalled()
  })

  it('propagates an edit failure after a clean cancel', async () => {
    const s = steps()
    s.edit.mockRejectedValue(new Error('already-withdrawn'))
    await expect(editInPlace(s, true)).rejects.toThrow('already-withdrawn')
    expect(s.cancel).toHaveBeenCalledTimes(1)
  })

  it('rejects without editing when the settle wait fails or times out', async () => {
    const s = steps()
    s.waitIdle.mockRejectedValue(new Error('message-tools: timed out waiting for the cancelled turn to settle'))
    await expect(editInPlace(s, true)).rejects.toThrow('timed out')
    expect(s.cancel).toHaveBeenCalledTimes(1)
    expect(s.edit).not.toHaveBeenCalled()
  })
})

describe('withdrawInPlace', () => {
  it('cancels the running turn, waits for the settle, then withdraws (in order)', async () => {
    const s = withdrawSteps()
    const order: string[] = []
    s.cancel.mockImplementation(() => { order.push('cancel'); return Promise.resolve() })
    s.waitIdle.mockImplementation(() => { order.push('waitIdle'); return Promise.resolve() })
    s.withdraw.mockImplementation(() => { order.push('withdraw'); return Promise.resolve() })
    await withdrawInPlace(s, true)
    expect(order).toEqual(['cancel', 'waitIdle', 'withdraw'])
  })

  it('never cancels an idle session', async () => {
    const s = withdrawSteps()
    await withdrawInPlace(s, false)
    expect(s.cancel).not.toHaveBeenCalled()
    expect(s.waitIdle).not.toHaveBeenCalled()
    expect(s.withdraw).toHaveBeenCalledTimes(1)
  })

  it('rejects without withdrawing when the cancel fails', async () => {
    const s = withdrawSteps()
    s.cancel.mockRejectedValue(new Error('cancel denied'))
    await expect(withdrawInPlace(s, true)).rejects.toThrow('cancel denied')
    expect(s.waitIdle).not.toHaveBeenCalled()
    expect(s.withdraw).not.toHaveBeenCalled()
  })

  it('propagates a withdraw failure after a clean cancel', async () => {
    const s = withdrawSteps()
    s.withdraw.mockRejectedValue(new Error('already-withdrawn'))
    await expect(withdrawInPlace(s, true)).rejects.toThrow('already-withdrawn')
    expect(s.cancel).toHaveBeenCalledTimes(1)
  })

  it('rejects without withdrawing when the settle wait fails or times out', async () => {
    const s = withdrawSteps()
    s.waitIdle.mockRejectedValue(new Error('message-tools: timed out waiting for the cancelled turn to settle'))
    await expect(withdrawInPlace(s, true)).rejects.toThrow('timed out')
    expect(s.cancel).toHaveBeenCalledTimes(1)
    expect(s.withdraw).not.toHaveBeenCalled()
  })
})

function settleSnapshot(overrides: {
  running?: boolean
  runningCalls?: readonly unknown[]
  turns?: ReadonlyMap<number, { readonly status: 'open' | 'closed' | 'unknown' }>
  turnOrder?: readonly number[]
} = {}): TurnSettleSnapshot {
  const turns = overrides.turns ?? new Map([[1, { status: 'closed' as const }]])
  return {
    running: overrides.running ?? false,
    runningCalls: overrides.runningCalls ?? [],
    chat: { timeline: { turnOrder: overrides.turnOrder ?? [...turns.keys()], turns } },
  }
}

describe('turnSettled', () => {
  it('is false while the session still reports running (status flips first)', () => {
    expect(turnSettled(settleSnapshot({ running: true }))).toBe(false)
  })

  it('stays false after the running flip while cancelled tool results are still pending', () => {
    expect(turnSettled(settleSnapshot({ running: false, runningCalls: [{ call: 1 }] }))).toBe(false)
  })

  it('stays false until the latest turn closes (turn/end lands last)', () => {
    const turns = new Map([[1, { status: 'closed' as const }], [2, { status: 'open' as const }]])
    expect(turnSettled(settleSnapshot({ turns }))).toBe(false)
  })

  it('is true once the latest turn closed and no tool call is pending', () => {
    const turns = new Map([[1, { status: 'closed' as const }], [2, { status: 'closed' as const }]])
    expect(turnSettled(settleSnapshot({ turns }))).toBe(true)
  })

  it('ignores an unclosed older turn once the latest one closed', () => {
    const turns = new Map([[1, { status: 'open' as const }], [2, { status: 'closed' as const }]])
    expect(turnSettled(settleSnapshot({ turns }))).toBe(true)
  })

  it('is false when the running turn\'s turn/start has not streamed in yet', () => {
    expect(turnSettled(settleSnapshot({ turns: new Map(), turnOrder: [] }))).toBe(false)
  })
})

describe('waitForTurnSettled', () => {
  /**
   * A scripted snapshot stub: each sleep advances the teardown one stage,
   * replaying the production race — running flips false first, the cancelled
   * tool results persist next, turn/end lands last.
   */
  function stagedSettle() {
    const stages: TurnSettleSnapshot[] = [
      // Cancel just admitted: still running, call pending, turn open.
      settleSnapshot({ running: true, runningCalls: [{ call: 1 }], turns: new Map([[2, { status: 'open' }]]) }),
      // running flipped false, but the cancelled result has not landed.
      settleSnapshot({ running: false, runningCalls: [{ call: 1 }], turns: new Map([[2, { status: 'open' }]]) }),
      // The cancelled result landed (runningCalls cleared); turn/end still out.
      settleSnapshot({ running: false, runningCalls: [], turns: new Map([[2, { status: 'open' }]]) }),
      // turn/end landed: the teardown is fully durable.
      settleSnapshot({ running: false, runningCalls: [], turns: new Map([[2, { status: 'closed' }]]) }),
    ]
    let stage = 0
    const snapshots: TurnSettleSnapshot[] = []
    return {
      read: (): TurnSettleSnapshot => {
        const current = stages[Math.min(stage, stages.length - 1)] as TurnSettleSnapshot
        snapshots.push(current)
        return current
      },
      advance: (): void => { stage += 1 },
      snapshots,
    }
  }

  it('resolves only after the whole teardown (results AND turn/end) landed', async () => {
    const settle = stagedSettle()
    let resolved = false
    const wait = waitForTurnSettled(settle.read, {
      sleep: () => { settle.advance(); return Promise.resolve() },
    }).then(() => { resolved = true })
    await wait
    expect(resolved).toBe(true)
    // The wait must have observed every unsettled stage before resolving:
    // running flip alone, and results-without-turn/end, are both insufficient.
    expect(settle.snapshots.length).toBe(4)
  })

  it('lets editInPlace edit only once the full teardown is durable', async () => {
    const settle = stagedSettle()
    const order: string[] = []
    await editInPlace({
      cancel: () => { order.push('cancel'); return Promise.resolve() },
      waitIdle: () => waitForTurnSettled(settle.read, {
        sleep: () => { settle.advance(); return Promise.resolve() },
      }).then(() => { order.push('waitIdle') }),
      edit: () => { order.push('edit'); return Promise.resolve() },
    }, true)
    expect(order).toEqual(['cancel', 'waitIdle', 'edit'])
    expect(settle.snapshots.length).toBe(4)
  })

  it('rejects on timeout instead of waiting forever, so edit never fires', async () => {
    const s = steps()
    let clock = 0
    s.waitIdle.mockImplementation(() => waitForTurnSettled(
      // Never settles: turn/end never lands.
      () => settleSnapshot({ turns: new Map([[2, { status: 'open' }]]) }),
      { now: () => clock, sleep: (ms) => { clock += ms; return Promise.resolve() }, timeoutMs: 500, intervalMs: 100 },
    ))
    await expect(editInPlace(s, true)).rejects.toThrow('timed out waiting for the cancelled turn to settle')
    expect(s.edit).not.toHaveBeenCalled()
  })

  it('treats an unresolvable snapshot (session binding gone) as unsettled', async () => {
    let clock = 0
    await expect(waitForTurnSettled(() => undefined, {
      now: () => clock,
      sleep: (ms) => { clock += ms; return Promise.resolve() },
      timeoutMs: 200,
      intervalMs: 100,
    })).rejects.toThrow('timed out')
  })
})
