/**
 * The room desk on the host (proposal 2026-10-29-room-desk, the canvas
 * precedent): a room's coordinator opens a project ON the room — the room
 * session is bound (as a desk) and hears of it through room's
 * `room/desk-opened`; a member's open binds only its own session but still
 * tells the room; a member with no project of its own reads the room's.
 * Writes keep the member's own session as the fence. Outside a room nothing
 * changes.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { BrowserChecker } from '../src/checks.ts'
import { deskOf } from '../src/desk.ts'
import { GameService } from '../src/store.ts'
import { gameToolDefinitions } from '../src/tools.ts'

const checker: BrowserChecker = { run: async () => ({ failures: [], passed: 1 }), dispose: async () => {} }
const DESK = Symbol.for('dsh.agent.desk')

let dir: string
let workspace: string
let store: GameService

async function put(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

/** A session that records what is appended to it. */
function session(id: string): Session & { appended: { type: string; data: unknown }[] } {
  const appended: { type: string; data: unknown }[] = []
  return { id, header: { cwd: workspace }, appended, append: (type: string, data: unknown) => { appended.push({ type, data }) } } as never
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'game-desk-'))
  workspace = join(dir, 'ws')
  await mkdir(workspace)
  store = new GameService({ fs: { sandboxMode: undefined }, get: () => undefined } as unknown as Context, { stateRoot: join(dir, 'state') }, { checker, writer: put })
})
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

const tool = (name: string) => {
  const definition = gameToolDefinitions(store).find(d => d.name === name)!
  return definition.execute as unknown as (args: object, exec: object) => Promise<string>
}

/** A member's stand-in agent over its own session, marked with the room. */
const standIn = (own: Session, room: Session, role: 'coordinator' | 'member', runId?: string) =>
  ({ session: own, [DESK]: { session: room, role, member: 'codex', ...runId === undefined ? {} : { runId } } })

const GATE = { pitch: '守住灯塔到天亮', elementTypes: '角色、敌人', artStyle: 'pixel' }

describe('deskOf', () => {
  it('reads the mark, and ignores none, a malformed one, and the room itself', () => {
    const room = session('room')
    expect(deskOf({ session: session('a') })).toBeUndefined()
    expect(deskOf({ session: session('a'), [DESK]: { session: room, role: 'boss' } })).toBeUndefined()
    expect(deskOf({ session: room, [DESK]: { session: room, role: 'member', member: 'x' } })).toBeUndefined()
    expect(deskOf(standIn(session('a'), room, 'member', 'r1'))).toMatchObject({ role: 'member', member: 'codex', runId: 'r1' })
  })
})

describe('game_open on a room desk', () => {
  it('the coordinator binds the room, marks it a desk, and tells the room', async () => {
    const room = session('room')
    const own = session('coord')
    const answer = await tool('game_open')({ create: 'Lighthouse', ...GATE }, { agent: standIn(own, room, 'coordinator', 'run-1') })
    expect(answer).toContain('房间侧栏已切到这个项目')
    const bound = await store.boundProject('room')
    expect(bound?.title).toBe('Lighthouse')
    // The project lives in the caller's own workspace (the fence and cwd are its own).
    expect(bound?.root).toBe(join(workspace, 'lighthouse'))
    expect(await store.isDesk('room')).toBe(true)
    expect(room.appended).toEqual([{
      type: 'room/desk-opened',
      data: { version: 1, owner: '@khorsheed/dsh-game', member: 'codex', role: 'coordinator', runId: 'run-1', data: { projectId: bound!.id, title: 'Lighthouse', created: true } },
    }])
    expect(own.appended).toEqual([])
    // The room's own turns stay out of the end-of-turn checks and turn reports.
    expect(await store.checkTurn(room, 0, 2)).toEqual({ kind: 'skip' })
    expect(await store.turnBaseline('room')).toBeUndefined()

    // A switch by the coordinator moves the room too, and reports it as not created.
    await tool('game_open')({ create: 'Harbor', ...GATE }, { agent: { session: session('elsewhere') } })
    await tool('game_open')({ project: 'Harbor' }, { agent: standIn(own, room, 'coordinator') })
    expect((await store.boundProject('room'))?.title).toBe('Harbor')
    expect(room.appended.at(-1)).toMatchObject({ type: 'room/desk-opened', data: { role: 'coordinator', data: { title: 'Harbor', created: false } } })
    expect((room.appended.at(-1)!.data as { runId?: string }).runId).toBeUndefined()
  })

  it('a member binds only its own session, still tells the room, and the room keeps its project', async () => {
    const room = session('room')
    const own = session('member-1')
    await tool('game_open')({ create: 'Lighthouse', ...GATE }, { agent: { session: session('elsewhere') } })
    await tool('game_open')({ create: 'Harbor', ...GATE }, { agent: { session: session('elsewhere') } })
    await tool('game_open')({ project: 'Lighthouse' }, { agent: standIn(session('coord'), room, 'coordinator') })

    const answer = await tool('game_open')({ project: 'Harbor' }, { agent: standIn(own, room, 'member', 'run-2') })
    expect(answer).toContain('只绑定了你自己的会话')
    expect((await store.boundProject('member-1'))?.title).toBe('Harbor')
    expect((await store.boundProject('room'))?.title).toBe('Lighthouse')
    expect(await store.isDesk('member-1')).toBe(false)
    expect(room.appended.at(-1)).toMatchObject({
      type: 'room/desk-opened',
      data: { owner: '@khorsheed/dsh-game', member: 'codex', role: 'member', runId: 'run-2', data: { title: 'Harbor', created: false } },
    })
  })

  it('a member with no project of its own reads, proposes and publishes on the room\'s, fenced by its own session', async () => {
    const room = session('room')
    await tool('game_open')({ create: 'Lighthouse', ...GATE }, { agent: standIn(session('coord'), room, 'coordinator') })
    const project = (await store.boundProject('room'))!
    const member = standIn(session('member-1'), room, 'member')
    expect(await tool('game_read')({}, { agent: member })).toContain('项目《Lighthouse》')
    // Not in a room: the same session has no project.
    expect(await tool('game_read')({}, { agent: { session: session('member-1') } })).toContain('本会话还没有游戏项目')

    await put(join(project.root, 'index.html'), '<p>hi</p>')
    const published = await tool('game_publish')({}, { agent: member })
    expect(published).toContain('v1 通过检查')
    expect((await store.view(project.id))?.current).toMatchObject({ version: 1, by: 'agent' })
    // A desk call names no destination: in a room the desk row brings the project.
    expect(published).not.toContain('⟦dsh-nav⟧')
    // …and tells the room what it wrote, so the room's game tab re-reads.
    expect(room.appended.at(-1)).toEqual({ type: 'room/desk-wrote', data: {
      version: 1, owner: '@khorsheed/dsh-game', member: 'codex', role: 'member',
      data: { projectId: project.id, what: 'publish', place: { view: 'play' }, label: 'v1 已上线' },
    } })

    // Its own choice wins once it has one.
    await tool('game_open')({ create: 'Harbor', ...GATE }, { agent: member })
    expect(await tool('game_read')({}, { agent: member })).toContain('项目《Harbor》')
  })

  it('a panel switch keeps the room a desk; unbinding clears the mark', async () => {
    const room = session('room')
    await tool('game_open')({ create: 'Lighthouse', ...GATE }, { agent: standIn(session('coord'), room, 'coordinator') })
    await tool('game_open')({ create: 'Harbor', ...GATE }, { agent: { session: session('elsewhere') } })
    const harbor = (await store.boundProject('elsewhere'))!
    await store.bind('room', harbor.id)
    expect(await store.isDesk('room')).toBe(true)
    await store.bind('room', null)
    expect(await store.isDesk('room')).toBe(false)
    // The room row's 打开 marks it again.
    await store.bind('room', harbor.id, { desk: true })
    expect(await store.isDesk('room')).toBe(true)
  })
})
