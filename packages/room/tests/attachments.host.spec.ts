/**
 * Composer attachments: postMessage admits images and uploaded files the way
 * the host's own prompt path does — the human message carries the durable
 * blocks, every addressed member gets the local paths.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import RoomService, { withAttachmentPaths } from '../src/index.ts'
import { createRoom } from './promote.ts'

async function boot() {
  const ctx = new Context()
  const agent = { followup: vi.fn(), send: vi.fn(), whenIdle: vi.fn(async () => {}), cancel: vi.fn() }
  ctx.provide('agents', {
    get: () => agent,
    create: vi.fn(async (request: { sessionId: never; meta?: Record<string, unknown> }) => {
      const session = ctx.sessions.create(request.sessionId, { meta: request.meta ?? {} })
      return { agent: { id: session.id, session }, dispose: async () => {} }
    }),
  } as never)
  ctx.provide('localAgent', { start: vi.fn(), resume: vi.fn(), cancel: vi.fn() } as never)
  const committed = vi.fn()
  const fileRef = { attachmentId: 'f1', name: 'brief.pdf', bytes: 10 }
  ctx.provide('fileUploads', {
    resolve: (_agent: unknown, receiptId: string) => receiptId === 'r1' ? fileRef : undefined,
    bindPrompt: () => ({ commit: committed, [Symbol.dispose]: () => {} }),
  } as never)
  ctx.provide('attachments', {
    admitPromptContent: async (parts: readonly { type: string; name?: string; attachment?: unknown }[]) => parts.map(part => part.type === 'image'
      ? { type: 'image', attachment: { attachmentId: 'i1', ...part.name === undefined ? {} : { name: part.name }, mediaType: 'image/png', bytes: 3, width: 1, height: 1 } }
      : part),
    imageHostPath: () => '/home/user/.dsh/attachments/i1.png',
    fileHostPath: () => '/home/user/.dsh/attachments/brief.pdf',
  } as never)
  await ctx.plugin(SessionStore)
  await ctx.plugin(RoomService)
  const service = ctx.get('room') as RoomService
  const sessionId = await createRoom(ctx, service)
  await service.invite({ sessionId, provider: 'claude-local', name: 'gm' })
  return { ctx, service, sessionId, committed }
}

describe('composer attachments', () => {
  it('admits an image and an uploaded file into the human message and dispatches their paths', async () => {
    const bench = await boot()
    const dispatched = vi.spyOn(bench.service.engine, 'dispatch').mockImplementation(() => {})
    const result = await bench.service.postMessage({ sessionId: bench.sessionId, text: '@gm 看看这张图', attachments: [
      { type: 'image', data: 'AAAA', mediaType: 'image/png', name: 'shot.png' }, { type: 'file', receiptId: 'r1' },
    ] })
    expect(result.ok).toBe(true)
    const events = bench.ctx.sessions.get(bench.sessionId)!.snapshotEvents()
    const human = events.filter(event => event.type === 'user/message').at(-1)!.data as { content: { type: string }[] }
    expect(human.content.map(block => block.type)).toEqual(['image', 'file', 'text'])
    expect(bench.committed).toHaveBeenCalled()
    const dispatch = events.filter(event => event.type === 'room/dispatch').at(-1)!.data as { attachments: unknown }
    expect(dispatch.attachments).toEqual([
      { kind: 'image', name: 'shot.png', path: '/home/user/.dsh/attachments/i1.png' },
      { kind: 'file', name: 'brief.pdf', path: '/home/user/.dsh/attachments/brief.pdf' },
    ])
    const prompt = dispatched.mock.calls[0]![2] as string
    expect(prompt).toContain('看看这张图')
    expect(prompt).toContain('- 图片 shot.png：/home/user/.dsh/attachments/i1.png')
    expect(prompt).toContain('- 文件 brief.pdf：/home/user/.dsh/attachments/brief.pdf')
  })

  it('an attachment-only message still sends; a receipt not uploaded here is refused', async () => {
    const bench = await boot()
    vi.spyOn(bench.service.engine, 'dispatch').mockImplementation(() => {})
    expect((await bench.service.postMessage({ sessionId: bench.sessionId, text: '@gm', attachments: [{ type: 'image', data: 'AAAA', mediaType: 'image/png' }] })).ok).toBe(true)
    expect(await bench.service.postMessage({ sessionId: bench.sessionId, text: 'x', attachments: [{ type: 'file', receiptId: 'nope' }] }))
      .toEqual({ ok: false, error: { code: 'attachment-invalid', message: 'a file was not uploaded to this room' } })
  })

  it('leaves text alone without attachments', () => {
    expect(withAttachmentPaths('hi', undefined)).toBe('hi')
    expect(withAttachmentPaths('hi', [{ kind: 'image' }])).toContain('- 图片：（宿主没有给出本地路径')
  })
})
