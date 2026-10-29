/**
 * The room desk on the host side (proposal 2026-10-29-room-desk): a room
 * member's stand-in carries `Symbol.for('dsh.agent.desk')`. The coordinator
 * acts on the room's binding and its open moves the room's panel; a member
 * binds its own session and reads the room's project only as a fallback;
 * either open tells the room through room's `room/desk-opened` (this
 * package's owner, its fields under `data`) — never a type of its own.
 */
import { describe, expect, it, vi } from 'vitest'
import { deskOf } from '../src/desk.ts'
import type { VideoStudioService } from '../src/service.ts'
import { defineVideoTools } from '../src/tool-definition.ts'

const DESK = Symbol.for('dsh.agent.desk')

/** An in-memory stand-in for the parts of the service the tools touch. */
function fakeService(bindings: Record<string, string> = {}) {
  const projects = new Map<string, { id: string; name: string; showId: string | null }>([
    ['p_old', { id: 'p_old', name: '#22 旧工程', showId: null }],
    ['p_room', { id: 'p_room', name: '#21 房间的', showId: null }],
  ])
  let next = 1
  const svc = {
    bindings,
    bind: vi.fn(async (sessionId: string, projectId: string) => { bindings[sessionId] = projectId }),
    bound: vi.fn(async (sessionId: string) => bindings[sessionId] ?? null),
    createProject: vi.fn(async (input: { name: string; showId?: string | null }) => {
      const project = { id: `p_new${next++}`, name: input.name, showId: input.showId ?? null }
      projects.set(project.id, project)
      return project
    }),
    mustProject: vi.fn(async (id: string) => {
      const project = projects.get(id)
      if (project === undefined) throw new Error(`没有这个工程：${id}`)
      return project
    }),
    readForModel: vi.fn(async (id: string) => `工程 ${id} 的文稿`),
    overview: vi.fn(async () => ({
      shows: [],
      projects: [...projects.values()].map(p => ({ ...p, status: 'draft', durationSec: 0, outputSec: 0 })),
      toolchain: { ffmpeg: true },
    })),
  }
  return svc
}

function tools(svc: ReturnType<typeof fakeService>) {
  const [project, , read] = defineVideoTools(svc as unknown as VideoStudioService)
  const run = (tool: typeof project, args: Record<string, unknown>, agent: unknown): Promise<string> =>
    (tool as unknown as { execute: (a: unknown, e: unknown) => Promise<string> }).execute(args, { agent })
  return { project: (args: Record<string, unknown>, agent: unknown) => run(project, args, agent), read: (args: Record<string, unknown>, agent: unknown) => run(read!, args, agent) }
}

function room() {
  const append = vi.fn()
  return { session: { id: 'room-1', append }, append }
}

function standIn(role: 'coordinator' | 'member', roomSession: unknown, runId?: string) {
  return { id: 'child-bill', [DESK]: { session: roomSession, role, member: 'bill', ...runId === undefined ? {} : { runId } } }
}

describe('video tools at the room desk', () => {
  it('the coordinator\'s create binds the ROOM session and tells the room', async () => {
    const svc = fakeService()
    const { session, append } = room()
    const answer = await tools(svc).project({ action: 'create', name: '#23 老周' }, standIn('coordinator', session, 'run-7'))
    expect(svc.bind).toHaveBeenCalledExactlyOnceWith('room-1', 'p_new1')
    expect(svc.bindings['child-bill']).toBeUndefined()
    expect(answer).toContain('绑定到房间')
    expect(answer).toContain('房间的剪辑面板已切到这个工程')
    expect(append).toHaveBeenCalledExactlyOnceWith('room/desk-opened', {
      version: 1, owner: '@khorsheed/dsh-video-studio', member: 'bill', role: 'coordinator', runId: 'run-7',
      data: { projectId: 'p_new1', title: '#23 老周', created: true },
    })
  })

  it('a member\'s open keeps its own session and still tells the room', async () => {
    const svc = fakeService({ 'room-1': 'p_room' })
    const { session, append } = room()
    const answer = await tools(svc).project({ action: 'open', projectId: 'p_old' }, standIn('member', session))
    expect(svc.bindings).toEqual({ 'room-1': 'p_room', 'child-bill': 'p_old' })
    expect(answer).toContain('房间的剪辑面板不变')
    expect(answer).toContain('工程 p_old 的文稿')
    expect(append).toHaveBeenCalledExactlyOnceWith('room/desk-opened', {
      version: 1, owner: '@khorsheed/dsh-video-studio', member: 'bill', role: 'member',
      data: { projectId: 'p_old', title: '#22 旧工程', created: false },
    })
    // No event type of this package's own ever reaches the room.
    expect(append.mock.calls.every(([type]) => type === 'room/desk-opened')).toBe(true)
  })

  it('a member reads its own binding first and falls back to the room\'s', async () => {
    const svc = fakeService({ 'room-1': 'p_room' })
    const { session } = room()
    const { read } = tools(svc)
    expect(await read({}, standIn('member', session))).toBe('工程 p_room 的文稿')
    svc.bindings['child-bill'] = 'p_old'
    expect(await read({}, standIn('member', session))).toBe('工程 p_old 的文稿')
  })

  it('the coordinator reads the room\'s binding, not its own', async () => {
    const svc = fakeService({ 'room-1': 'p_room', 'child-bill': 'p_old' })
    const { session } = room()
    expect(await tools(svc).read({}, standIn('coordinator', session))).toBe('工程 p_room 的文稿')
  })

  it('list marks the acting session\'s project', async () => {
    const svc = fakeService({ 'room-1': 'p_room', 'child-bill': 'p_old' })
    const { session } = room()
    const { project } = tools(svc)
    const coordinator = await project({ action: 'list' }, standIn('coordinator', session))
    expect(coordinator).toMatch(/p_room「#21 房间的」.*← 当前会话/)
    expect(coordinator).not.toMatch(/p_old.*← 当前会话/)
    const member = await project({ action: 'list' }, standIn('member', session))
    expect(member).toMatch(/p_old「#22 旧工程」.*← 当前会话/)
  })

  it('outside a room nothing changes: own session, no event', async () => {
    const svc = fakeService()
    const answer = await tools(svc).project({ action: 'create', name: '#24' }, { id: 'plain' })
    expect(svc.bind).toHaveBeenCalledExactlyOnceWith('plain', 'p_new1')
    expect(answer).toContain('绑定到当前会话')
    expect(answer).not.toContain('房间')
  })

  it('a closed room loses only the row', async () => {
    const svc = fakeService()
    const session = { id: 'room-1', append: vi.fn(() => { throw new Error('closed') }) }
    const answer = await tools(svc).project({ action: 'create', name: '#25' }, standIn('member', session))
    expect(answer).toContain('已建工程 p_new1')
    expect(svc.bindings['child-bill']).toBe('p_new1')
  })

  it('deskOf ignores malformed marks and the room\'s own agent', () => {
    const { session } = room()
    expect(deskOf(undefined)).toBeUndefined()
    expect(deskOf({ id: 'x', [DESK]: { session, role: 'boss' } })).toBeUndefined()
    expect(deskOf({ id: 'room-1', [DESK]: { session, role: 'coordinator', member: 'bill' } })).toBeUndefined()
    expect(deskOf(standIn('member', session, 'r1'))).toMatchObject({ role: 'member', member: 'bill', runId: 'r1' })
  })
})
