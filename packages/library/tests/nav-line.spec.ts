/**
 * The library host half writes the destination line through its own copy
 * (host faces are not bundled); this pins that copy — and the JSON output
 * render that writes it after the answer — to the reference reader of
 * @khorsheed/dsh-client-ui-agent-nav, and each address to the screens it opens.
 */
import { describe, expect, it } from 'vitest'
import { NAV_MARK as REFERENCE_MARK, readDestinations } from '@khorsheed/dsh-client-ui-agent-nav/src/destination.ts'
import { NAV_KEY, NAV_MARK, RECORD_KIND } from '../src/nav-line.ts'
import { jsonOutput, landed } from '../src/tools/kit.ts'
import { stackOf } from '../src/client/store.ts'

describe('library destination line', () => {
  it('renders after the answer JSON, which no longer carries it', () => {
    expect(NAV_MARK).toBe(REFERENCE_MARK)
    const value = landed(undefined, { ok: true, notes: { revisions: 1 } }, { view: 'lesson', projectId: 'p1', resourceId: 'r1', nodeId: 'n2' }, '这一站的讲义')
    const [block] = jsonOutput().render(undefined, value)
    const [json, line] = block!.text.split('\n')
    expect(JSON.parse(json!)).toEqual({ ok: true, notes: { revisions: 1 } })
    expect(line!.startsWith(NAV_MARK)).toBe(true)
    expect(readDestinations(block!.text)).toEqual([expect.objectContaining({
      kind: 'library', label: '这一站的讲义', params: { view: 'lesson', projectId: 'p1', resourceId: 'r1', nodeId: 'n2' },
    })])
  })

  it('a call at a room desk names no destination (the desk row brings the library)', () => {
    const desk = { agent: { [Symbol.for('dsh.agent.desk')]: { session: { id: 'room' }, role: 'coordinator', member: 'm' } } }
    const value = landed(desk as never, { ok: true }, { view: 'project', projectId: 'p1' }, '项目')
    expect(NAV_KEY in value).toBe(false)
    expect(jsonOutput().render(undefined, value)[0]!.text).toBe('{"ok":true}')
  })

  it('an answer without a destination renders as before', () => {
    expect(jsonOutput().render(undefined, { ok: true })[0]!.text).toBe('{"ok":true}')
    expect(jsonOutput().render(undefined, [1, 2])[0]!.text).toBe('[1,2]')
  })
})

describe('stackOf: each address opens its screen over the ones 「‹」 walks back through', () => {
  it('maps every view', () => {
    expect(stackOf({ view: 'today' }).map(route => route.view)).toEqual(['today'])
    expect(stackOf({ view: 'project', projectId: 'p' }).map(route => route.view)).toEqual(['today', 'project'])
    expect(stackOf({ view: 'book', projectId: 'p', resourceId: 'r' }).map(route => route.view)).toEqual(['today', 'project', 'resource'])
    expect(stackOf({ view: 'station', projectId: 'p', resourceId: 'r', nodeId: 'n', tab: 'pages' }).at(-1))
      .toEqual({ view: 'node', projectId: 'p', resourceId: 'r', nodeId: 'n', tab: 'pages' })
    expect(stackOf({ view: 'station', projectId: 'p', resourceId: 'r', nodeId: 'n' }).at(-1)).toMatchObject({ tab: 'guide' })
    expect(stackOf({ view: 'lesson', projectId: 'p', resourceId: 'r', nodeId: 'n' }).map(route => route.view)).toEqual(['today', 'project', 'resource', 'lesson'])
    expect(stackOf({ view: 'quiz', projectId: 'p', resourceId: 'r', quizId: 'q' }).map(route => route.view)).toEqual(['today', 'project', 'resource', 'quiz'])
    expect(stackOf({ view: 'quiz', projectId: 'p', quizId: 'q' }).at(-1)).toEqual({ view: 'quiz', projectId: 'p', quizId: 'q' })
    expect(stackOf({ view: 'cards', projectId: 'p' }).at(-1)).toEqual({ view: 'cards', projectId: 'p', filter: 'all' })
  })
})

describe('a noted weak point', () => {
  it('names the cards list under the record kind, which the follower never opens by itself', () => {
    const rendered = jsonOutput().render(undefined, landed(undefined, { ok: true }, { view: 'cards', projectId: 'p' }, '记下：动作电位', RECORD_KIND))
    expect(readDestinations(rendered)).toEqual([expect.objectContaining({ kind: 'library-record', params: { view: 'cards', projectId: 'p' }, label: '记下：动作电位' })])
  })
})

describe('the card data a write hands the shell', () => {
  it('a roadmap draft waits to be adopted; a quiz waits to be answered; other writes carry the label only', () => {
    const draft = jsonOutput().render(undefined, landed(undefined, { ok: true }, { view: 'book', projectId: 'p', resourceId: 'r', draft: true },
      '《神经科学原理》的学习路线', undefined, { status: '等你采用', awaiting: true, door: '去书里采用 →' }))
    expect(readDestinations(draft)).toEqual([expect.objectContaining({
      params: { view: 'book', projectId: 'p', resourceId: 'r', draft: true },
      card: { status: '等你采用', awaiting: true, door: '去书里采用 →' },
    })])
    const quiz = jsonOutput().render(undefined, landed(undefined, { ok: true }, { view: 'quiz', projectId: 'p', quizId: 'q1' },
      '新出的测验（5 题）', undefined, { status: '等你作答', awaiting: true, door: '去作答 →' }))
    expect(readDestinations(quiz)[0]?.card).toEqual({ status: '等你作答', awaiting: true, door: '去作答 →' })
    const notes = jsonOutput().render(undefined, landed(undefined, { ok: true }, { view: 'lesson', projectId: 'p', resourceId: 'r', nodeId: 'n' }, '讲义'))
    expect(readDestinations(notes)[0]?.card).toBeUndefined()
  })

  it('the roadmap draft still opens the book', () => {
    expect(stackOf({ view: 'book', projectId: 'p', resourceId: 'r', draft: true }).map(route => route.view)).toEqual(['today', 'project', 'resource'])
  })
})
