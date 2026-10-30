/**
 * The library host half writes the destination line through its own copy
 * (host faces are not bundled); this pins that copy — and the JSON output
 * render that writes it after the answer — to the reference reader of
 * @khorsheed/dsh-client-ui-agent-nav, and each address to the screens it opens.
 */
import { describe, expect, it } from 'vitest'
import { NAV_MARK as REFERENCE_MARK, readDestinations } from '@khorsheed/dsh-client-ui-agent-nav/src/destination.ts'
import { NAV_KEY, NAV_MARK } from '../src/nav-line.ts'
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
