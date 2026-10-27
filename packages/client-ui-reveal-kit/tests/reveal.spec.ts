import { describe, expect, it } from 'vitest'
import { RevealController } from '../src/client/reveal.ts'

const make = () => {
  const opened: string[] = []
  const c = new RevealController<string>({ name: 'test', open: t => { opened.push(t) }, switchKey: 'k', leavesView: (t, v) => v !== t && v.startsWith('el:') && t.startsWith('el:') })
  const unmount = c.mount()
  return { c, opened, unmount }
}

describe('the reveal controller', () => {
  it('opens when idle; a hold, a recent touch or leaving the current view leaves a notice', () => {
    const { c, opened } = make()
    expect(c.offer('play', 'v2', 'version')).toBe('opened')
    c.hold('playing')
    expect(c.offer('play', 'v3', 'version')).toBe('notice:holding')
    expect(c.notice).toEqual({ text: 'v3', target: 'play' })
    c.hold(null)
    c.touched()
    expect(c.offer('play', 'v4', 'version')).toBe('notice:touched')
    c.follow()
    expect(opened).toEqual(['play', 'play'])
    expect(c.notice).toBeNull()
  })

  it('does not take a viewer off another item', () => {
    const { c } = make()
    c.setViewing('el:bi')
    expect(c.offer('el:fox', 'fox', 'turn')).toBe('notice:view')
    expect(c.offer('el:bi', 'bi', 'turn')).toBe('opened')
  })

  it('acts on each agent request once; the first one on a page only when fresh', () => {
    const { c, opened } = make()
    expect(c.request('p', 3, 'play', 'look', false)).toBeNull()
    expect(c.request('p', 3, 'play', 'look', true)).toBeNull()
    expect(c.request('p', 4, 'el:fox', 'fox', false)).toBe('opened')
    expect(c.request('q', 1, 'play', 'new', true)).toBe('opened')
    expect(opened).toEqual(['el:fox', 'play'])
  })

  it('opens nothing for an unmounted panel in a narrow (or window-less) page', () => {
    const { c, opened, unmount } = make()
    unmount()
    expect(c.offer('play', 'v9', 'version')).toBe('skipped:narrow')
    expect(opened).toEqual([])
  })
})
