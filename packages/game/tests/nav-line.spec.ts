/**
 * The game host half writes the destination line through its own copy (host
 * faces are not bundled); this pins that copy to the reference reader of
 * @khorsheed/dsh-client-ui-agent-nav.
 */
import { describe, expect, it } from 'vitest'
import { NAV_MARK as REFERENCE_MARK, readDestinations } from '@khorsheed/dsh-client-ui-agent-nav/src/destination.ts'
import { NAV_MARK, withGameDestination } from '../src/nav-line.ts'

describe('game destination line', () => {
  it('uses the reference marker and reads back as a game destination', () => {
    expect(NAV_MARK).toBe(REFERENCE_MARK)
    const answer = withGameDestination('完成：v3 通过检查。', 'game:p1:v3', { projectId: 'p1', view: 'elements', elementId: 'anubis' }, 'v3：改了阿努比斯')
    expect(answer.startsWith('完成：v3 通过检查。\n')).toBe(true)
    expect(readDestinations(answer)).toEqual([
      { id: 'game:p1:v3', kind: 'game', params: { projectId: 'p1', view: 'elements', elementId: 'anubis' }, label: 'v3：改了阿努比斯' },
    ])
  })
})
