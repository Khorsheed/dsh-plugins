import { describe, expect, it } from 'vitest'
import { AutoNav, offerFor, type NavWords } from '../src/client/autonav.ts'
import type { NavTarget } from '../src/client/contract.ts'
import type { TurnReport } from '../src/types.ts'

const words: NavWords = {
  version: v => `v${v} live`, candidate: v => `v${v} waits`, element: n => `${n} updated`, elements: c => `${c} changed`, chapter: t => `${t} updated`,
}
const report = (over: Partial<TurnReport>): TurnReport => ({
  turn: 1, projectId: 'p', title: 'T', at: new Date().toISOString(), version: null, check: null,
  elements: [], chapters: [], params: [], code: [], tests: [], ...over,
})
const fox = { id: 'fox', name: '九尾狐', what: 'look' as const }

describe('where a finished turn sends the panel', () => {
  it('a version with code changes goes to play; one element alone opens its page, with the version to play', () => {
    expect(offerFor(report({ version: { kind: 'deployed', version: 15 }, code: ['src/main.js'], elements: [fox] }), words))
      .toEqual({ target: { view: 'play' }, text: 'v15 live' })
    expect(offerFor(report({ version: { kind: 'deployed', version: 15 }, elements: [fox] }), words))
      .toEqual({ target: { view: 'elements', elementId: 'fox', playVersion: 15 }, text: '九尾狐 updated' })
    expect(offerFor(report({ elements: [fox, { id: 'bi', name: '毕方', what: 'fields' }] }), words)?.target).toEqual({ view: 'elements' })
    expect(offerFor(report({ version: { kind: 'candidate', version: 3 } }), words)?.text).toBe('v3 waits')
    expect(offerFor(report({ chapters: [{ id: 'core-loop', title: '核心循环' }] }), words)?.target).toEqual({ view: 'design', chapterId: 'core-loop' })
  })

  it('a failed check or an empty turn goes nowhere', () => {
    expect(offerFor(report({ check: { ok: false, fixes: 2, gaveUp: true, passed: 0, failures: 3 }, elements: [fox] }), words)).toBeNull()
    expect(offerFor(report({}), words)).toBeNull()
  })
})

describe('the controller', () => {
  const setup = () => {
    const opened: NavTarget[] = []
    const nav = new AutoNav(target => { opened.push(target) })
    const unmount = nav.mount()
    return { nav, opened, unmount }
  }

  it('jumps when the panel is idle, and leaves a notice while a game runs or the user just touched it', () => {
    const { nav, opened } = setup()
    nav.turnEnded('s', report({ turn: 1, elements: [fox] }), words)
    expect(opened).toEqual([{ view: 'elements', elementId: 'fox' }])
    nav.setPlaying(true)
    nav.turnEnded('s', report({ turn: 2, version: { kind: 'deployed', version: 9 }, code: ['a.js'] }), words)
    expect(opened).toHaveLength(1)
    expect(nav.notice).toEqual({ text: 'v9 live', target: { view: 'play' } })
    nav.follow()
    expect(opened.at(-1)).toEqual({ view: 'play' })
    nav.setPlaying(false)
    nav.touched()
    nav.versionLanded('p', 10, 'v10 live')
    expect(nav.notice?.text).toBe('v10 live')
  })

  it('handles a turn once, ignores history, and does not announce a mid-turn version again at turn end', () => {
    const { nav, opened } = setup()
    nav.turnEnded('s', report({ turn: 3, at: new Date(Date.now() - 10 * 60_000).toISOString(), elements: [fox] }), words)
    expect(opened).toEqual([])
    nav.versionLanded('p', 12, 'v12 live')
    expect(opened).toEqual([{ view: 'play' }])
    nav.turnEnded('s', report({ turn: 4, version: { kind: 'deployed', version: 12 }, code: ['a.js'] }), words)
    nav.turnEnded('s', report({ turn: 4, version: { kind: 'deployed', version: 12 }, code: ['a.js'] }), words)
    expect(opened).toHaveLength(1)
  })

  it('does not take a viewer off another element, and opens nothing for a closed panel in a narrow window', () => {
    const { nav, opened, unmount } = setup()
    nav.setViewing({ view: 'elements', elementId: 'bi' })
    nav.turnEnded('s', report({ turn: 5, elements: [fox] }), words)
    expect(opened).toEqual([])
    expect(nav.notice?.target).toEqual({ view: 'elements', elementId: 'fox' })
    nav.setViewing(null)
    unmount()
    nav.turnEnded('s', report({ turn: 6, elements: [fox] }), words)
    expect(opened).toEqual([])
  })
})
