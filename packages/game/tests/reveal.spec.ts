import { describe, expect, it } from 'vitest'
import { Reveal } from '../src/client/reveal.ts'
import type { NavTarget } from '../src/client/contract.ts'
import type { ShowRequest } from '../src/types.ts'

const req = (seq: number, at = new Date().toISOString()): ShowRequest => ({ seq, target: { view: 'elements', elementId: 'fox' }, note: '看看九尾狐', at })

describe('the page follows the agent', () => {
  it('carries out each request once; a busy user gets a notice; history on a reload is ignored', () => {
    const opened: NavTarget[] = []
    const reveal = new Reveal(t => { opened.push(t) })
    reveal.mount()
    expect(reveal.request('p', req(1, new Date(Date.now() - 10 * 60_000).toISOString()))).toBeNull()
    expect(reveal.request('p', req(2))).toBe('opened')
    expect(reveal.request('p', req(2))).toBeNull()
    expect(opened).toEqual([{ view: 'elements', elementId: 'fox' }])
    reveal.setPlaying(true)
    expect(reveal.request('p', req(3))).toBe('notice')
    expect(reveal.notice?.text).toBe('看看九尾狐')
    reveal.setPlaying(false)
    reveal.follow()
    expect(opened).toHaveLength(2)
    reveal.touched()
    expect(reveal.request('p', req(4))).toBe('notice')
  })

  it('does not open a closed panel in a narrow (or window-less) page', () => {
    const opened: NavTarget[] = []
    const reveal = new Reveal(t => { opened.push(t) })
    expect(reveal.request('p', req(1))).toBe('skipped')
    expect(opened).toEqual([])
  })
})
