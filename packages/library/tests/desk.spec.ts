/**
 * A room member's library tools work on the room's desk (proposal
 * 2026-10-29-room-desk): the coordinator binds and reads the ROOM session's
 * binding, a member binds itself and reads its own else the room's; each bind
 * is told to the room as room's `room/desk-opened` (owner: this package); a
 * photo sent in the room reaches the member; a card's source session stays
 * the member's own.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibraryService } from '../src/service.ts'
import { libraryToolDefinitions } from '../src/tool-definition.ts'
import { ImageRefCache } from '../src/image-refs.ts'
import { renderBindingContext } from '../src/tool.ts'
import { bindingSessionIdOf } from '../src/tools/kit.ts'
import { deskOf } from '../src/desk.ts'

let root: string
let service: LibraryService
let tools: ReturnType<typeof libraryToolDefinitions>
let images: ImageRefCache
let events: { type: string; data: unknown }[]

const ctx = { get: () => undefined, effect: () => () => {} } as unknown as Context

/** The room session: records what is appended to it. */
const room = {
  id: 's_room',
  append(type: string, data: unknown) { events.push({ type, data }) },
}

/** A member's stand-in agent over its own session, marked with the room's desk. */
const member = (role: 'coordinator' | 'member', runId?: string) => ({
  agent: {
    session: { id: role === 'coordinator' ? 's_coord' : 's_bill' },
    [Symbol.for('dsh.agent.desk')]: { session: room, role, member: 'bill', ...runId === undefined ? {} : { runId } },
  },
})
const plain = { agent: { session: { id: 's_plain' } } }

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-library-desk-'))
  service = new LibraryService(ctx, { stateRoot: root })
  images = new ImageRefCache()
  tools = libraryToolDefinitions(service, images)
  events = []
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

async function call(name: string, args: Record<string, unknown>, from: unknown): Promise<unknown> {
  const tool = tools.find(candidate => candidate.name === name)
  if (tool === undefined) throw new Error(`no tool ${name}`)
  return tool.execute(args as never, from as never)
}

/** A project with one book, made outside any room. */
async function shelf(): Promise<{ project: string; book: string }> {
  const created = (await call('library_project', { name: '神经科学', template: 'language' }, plain)) as { project: { id: string } }
  const book = (await call('library_textbook', {
    op: 'create', project: created.project.id, kind: 'book', title: 'Principles of Neural Science', edition: '6th', bookKind: 'knowledge',
    toc: ['Ion Channels', 'The Action Potential'], tocSource: { by: 'web', url: 'https://example.com/toc' },
  }, plain)) as { resource: { id: string } }
  events = []
  return { project: created.project.id, book: book.resource.id }
}

describe('the desk mark', () => {
  it('is read only when well-formed and not the caller\'s own session', () => {
    expect(deskOf(plain.agent)).toBeUndefined()
    expect(deskOf(member('member', 'r1').agent)).toMatchObject({ role: 'member', member: 'bill', runId: 'r1' })
    const self = { session: { id: 's_room' }, [Symbol.for('dsh.agent.desk')]: { session: room, role: 'coordinator', member: 'x' } }
    expect(deskOf(self)).toBeUndefined()
    expect(deskOf({ session: { id: 'a' }, [Symbol.for('dsh.agent.desk')]: { session: room, role: 'guest' } })).toBeUndefined()
  })
})

describe('binding at the room desk', () => {
  it('the coordinator binds the ROOM session and tells the room', async () => {
    const { project, book } = await shelf()
    await call('library_binding', { project, resource: book }, member('coordinator', 'r7'))
    expect(service.getBinding('s_room')).toEqual({ projectId: project, resourceId: book })
    expect(service.getBinding('s_coord')).toBeUndefined()
    expect(events).toEqual([{ type: 'room/desk-opened', data: {
      version: 1, owner: '@khorsheed/dsh-library', member: 'bill', role: 'coordinator', runId: 'r7',
      data: { projectId: project, projectName: '神经科学', resourceId: book, resourceTitle: 'Principles of Neural Science' },
    } }])
    // Its reads follow the room's binding.
    const listed = (await call('library_read', { what: 'projects' }, member('coordinator'))) as { binding: unknown }
    expect(listed.binding).toEqual({ projectId: project, resourceId: book })
    // The per-turn context reads the same desk.
    expect(renderBindingContext(service, bindingSessionIdOf(id => service.getBinding(id), member('coordinator') as never)!)).toContain('Principles of Neural Science')
  })

  it('a member binds only itself, and still tells the room', async () => {
    const { project, book } = await shelf()
    await call('library_binding', { project, resource: book }, member('member'))
    expect(service.getBinding('s_bill')).toEqual({ projectId: project, resourceId: book })
    expect(service.getBinding('s_room')).toBeUndefined()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'room/desk-opened', data: { role: 'member', member: 'bill', data: { projectId: project, resourceId: book } } })
    expect((events[0]!.data as { runId?: string }).runId).toBeUndefined()
  })

  it('a member reads its own binding first, else the room\'s', async () => {
    const { project, book } = await shelf()
    await service.setBinding('s_room', { projectId: project, resourceId: book })
    const viaRoom = (await call('library_read', { what: 'projects' }, member('member'))) as { binding: unknown }
    expect(viaRoom.binding).toEqual({ projectId: project, resourceId: book })
    // Reading through the room binds nothing.
    expect(service.getBinding('s_bill')).toBeUndefined()
    const other = (await call('library_project', { name: '数学', template: 'subject' }, plain)) as { project: { id: string } }
    await call('library_binding', { project: other.project.id }, member('member'))
    const own = (await call('library_read', { what: 'projects' }, member('member'))) as { binding: unknown }
    expect(own.binding).toEqual({ projectId: other.project.id })
    expect(service.getBinding('s_room')).toEqual({ projectId: project, resourceId: book })
  })

  it('unbinding is not announced; outside a room nothing is', async () => {
    const { project } = await shelf()
    await call('library_binding', { project }, plain)
    await call('library_binding', { unbind: true }, member('coordinator'))
    expect(events).toEqual([])
  })

  it('a write\'s auto-bind lands on the acting session and is told once', async () => {
    const created = (await call('library_project', { name: '物理', template: 'subject' }, member('coordinator', 'r2'))) as { project: { id: string } }
    expect(service.getBinding('s_room')).toEqual({ projectId: created.project.id })
    expect(service.getBinding('s_coord')).toBeUndefined()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ data: { role: 'coordinator', runId: 'r2', data: { projectId: created.project.id, projectName: '物理' } } })
    // A member's write into a project the room is bound to binds the member itself.
    const book = (await call('library_textbook', {
      op: 'create', project: created.project.id, kind: 'book', title: '力学', bookKind: 'knowledge',
      toc: ['运动', '力'], tocSource: { by: 'model' },
    }, member('member'))) as { resource: { id: string } }
    expect(service.getBinding('s_bill')).toEqual({ projectId: created.project.id, resourceId: book.resource.id })
    expect(service.getBinding('s_room')).toEqual({ projectId: created.project.id })
    expect(events.at(-1)).toMatchObject({ data: { role: 'member', data: { resourceId: book.resource.id, resourceTitle: '力学' } } })
  })
})

describe('what stays the member\'s own', () => {
  it('a photo sent in the room reaches the member; its own photo comes first', async () => {
    const { book } = await shelf()
    await service.setBinding('s_room', { projectId: service.findResourceOwner(book)!, resourceId: book })
    const roomPhoto = { attachmentId: 'sha256:room', mediaType: 'image/jpeg', width: 10, height: 20, bytes: 99 }
    images.observe('s_room', { type: 'user/message', data: { content: [{ type: 'image', attachment: roomPhoto }] } })
    const fromRoom = (await call('library_page', { text: 'held at the inn', marks: [] }, member('member'))) as { page: { attachment: unknown } }
    expect(fromRoom.page.attachment).toEqual(roomPhoto)
    // Named by id, too.
    const named = (await call('library_page', { text: 'p2', marks: [], attachment: 'room' }, member('member'))) as { page: { attachment: unknown } }
    expect(named.page.attachment).toEqual(roomPhoto)
    const ownPhoto = { ...roomPhoto, attachmentId: 'sha256:own' }
    images.observe('s_bill', { type: 'user/message', data: { content: [{ type: 'image', attachment: ownPhoto }] } })
    const fromOwn = (await call('library_page', { text: 'p3', marks: [] }, member('member'))) as { page: { attachment: unknown } }
    expect(fromOwn.page.attachment).toEqual(ownPhoto)
    // Outside a room, the room's photo is nobody else's.
    await expect(call('library_page', { text: 'x', marks: [], resource: book }, plain)).rejects.toThrow(/send the page photo/)
  })

  it('a card\'s source session stays the member\'s own while it lands on the room\'s book', async () => {
    const { project, book } = await shelf()
    await service.setBinding('s_room', { projectId: project, resourceId: book })
    const recorded = (await call('library_cards', { cards: [{ kind: 'concept', term: '不应期', gloss: 'Na⁺ 失活', source: { type: 'chat' } }] }, member('member'))) as { added: { resourceId?: string; sources: { ref?: string }[] }[] }
    expect(recorded.added[0]?.resourceId).toBe(book)
    expect(recorded.added[0]?.sources[0]?.ref).toBe('s_bill')
  })
})
