import { describe, expect, it } from 'vitest'
import { LivePaintDiagnostics } from '../src/client/live-paint.ts'

const item = (revision: number, turn = 1) => ({ id: `${turn}:1`, turn, step: 1, kind: 'text' as const, text: 'must not be retained', receivedAt: 100, revision })

describe('whole-round paint diagnostics', () => {
  it('distinguishes baseline replay, unrendered updates and independent surfaces', () => {
    const diagnostics = new LivePaintDiagnostics()
    diagnostics.receive('member', item(1), true)
    expect(diagnostics.begin('member', 1, 1, 'room')).toBeUndefined()
    diagnostics.receive('member', item(2), false)
    diagnostics.receive('member', item(3), false)
    diagnostics.begin('member', 1, 2, 'room')!('painted', 190)
    diagnostics.begin('member', 1, 2, 'member')!('hidden', 200)
    diagnostics.receive('member', item(2), true) // A reconnect cannot erase an observation.
    expect(diagnostics.report('member').rounds[0]).toMatchObject({ baselineUpdates: 1, liveUpdates: 2, surfaces: {
      room: { samples: [90], p95: 90, unrendered: 1 }, member: { hidden: 1, unrendered: 1 },
    } })
    expect(JSON.stringify(diagnostics.report('member'))).not.toContain('must not be retained')
    expect(diagnostics.report('other').rounds).toEqual([])
  })

  it('keeps slow paints across newer revisions and exposes all incomplete outcomes', () => {
    const diagnostics = new LivePaintDiagnostics()
    for (let revision = 1; revision <= 5; revision++) diagnostics.receive('member', item(revision), false)
    const slow = diagnostics.begin('member', 1, 1, 'room')!
    diagnostics.begin('member', 1, 2, 'room')!('painted', 140)
    slow('painted', 400)
    slow('painted', 101) // Duplicate callbacks cannot improve the recorded result.
    diagnostics.begin('member', 1, 3, 'room')!('unmounted', 400)
    diagnostics.begin('member', 1, 4, 'room')!('painted', 90)
    diagnostics.begin('member', 1, 5, 'room')
    expect(diagnostics.report('member').rounds[0]?.surfaces.room).toMatchObject({ samples: [300, 40], p95: 300, painted: 2, unmounted: 1, clockMismatch: 1, pending: 1 })
  })

  it('reports truncation and eviction instead of presenting a retained tail as a full round', () => {
    const diagnostics = new LivePaintDiagnostics(2, 2)
    for (let revision = 1; revision <= 3; revision++) diagnostics.receive('member', item(revision), false)
    expect(diagnostics.report('member').rounds[0]).toMatchObject({ dropped: 1, liveUpdates: 2 })
    diagnostics.receive('member', item(4, 2), false)
    diagnostics.receive('member', item(5, 3), false)
    expect(diagnostics.report('member')).toMatchObject({ evictedRounds: 1, rounds: [{ turn: 2 }, { turn: 3 }] })
  })
})
