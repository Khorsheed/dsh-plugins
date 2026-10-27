/** A queued delivery an older move-on left behind closes on recovery; later work does not. */
import { describe, expect, it } from 'vitest'
import { MOVED_ON_TEXT, supersededByMoveOn } from '../src/dispatch.ts'

const edge = (seq: number, data: Record<string, unknown>) => ({ type: 'room/delivery-state', seq, time: seq, data }) as never

describe('supersededByMoveOn', () => {
  it('covers exactly the rows queued between the lost round and the move-on', () => {
    // Lost round dispatched at 10; the human moved on at seq 40.
    const events = [edge(40, { id: '10:m', dispatchSeq: 10, memberId: 'm', state: 'cancelled', text: MOVED_ON_TEXT })]
    expect(supersededByMoveOn(events, 'm', 20)).toBe(true)
    expect(supersededByMoveOn(events, 'm', 50)).toBe(false)
    expect(supersededByMoveOn(events, 'm', 5)).toBe(false)
    expect(supersededByMoveOn(events, 'other', 20)).toBe(false)
  })
})
