/**
 * The canvas host half writes the destination line through its own copy
 * (host faces are not bundled); this pins that copy to the reference reader
 * of @khorsheed/dsh-client-ui-agent-nav.
 */
import { describe, expect, it } from 'vitest'
import { readDestinations } from '@khorsheed/dsh-client-ui-agent-nav/src/destination.ts'
import { NAV_MARK as REFERENCE_MARK } from '@khorsheed/dsh-client-ui-agent-nav/src/destination.ts'
import { NAV_MARK, withCanvasDestination } from '../src/nav-line.ts'

describe('canvas destination line', () => {
  it('uses the reference marker and reads back as a canvas destination', () => {
    expect(NAV_MARK).toBe(REFERENCE_MARK)
    const answer = withCanvasDestination('完成：card_1', 'canvas:c1:card:card_1:1', { canvasId: 'c1', card: 'card_1', heading: '林雪' }, '林雪')
    expect(answer.startsWith('完成：card_1\n')).toBe(true)
    expect(readDestinations(answer)).toEqual([
      { id: 'canvas:c1:card:card_1:1', kind: 'canvas', params: { canvasId: 'c1', card: 'card_1', heading: '林雪' }, label: '林雪' },
    ])
  })
})
