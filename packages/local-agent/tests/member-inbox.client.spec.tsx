// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemberInboxView, type MemberInboxFace } from '../src/client/MemberInboxView.tsx'
import type { LocalAgentMemberInbox } from '../src/types.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const t = ((key: keyof typeof zh, vars?: Record<string, unknown>) => zh[key].replace(/\{(\w+)\}/g, (_m, name: string) => String(vars?.[name] ?? `{${name}}`))) as never

describe('member inbox controls', () => {
  it('shows queued input, cancels its identity and resumes a recovered queue', async () => {
    const state: LocalAgentMemberInbox = { memberId: 'member', paused: true, messages: [{ id: 'input-1', text: 'queued work', status: 'queued', createdAt: 1, updatedAt: 1 }] }
    const face: MemberInboxFace = { read: vi.fn(async () => structuredClone(state)), control: vi.fn(async (action) => { if (action === 'resume') state.paused = false; return { ok: true } }) }
    render(<MemberInboxView face={face} t={t} />)
    await screen.findByText(/queued work/)
    fireEvent.click(screen.getByRole('button', { name: zh['inbox.cancel'] }))
    await waitFor(() => expect(face.control).toHaveBeenCalledWith('cancel', 'input-1'))
    fireEvent.click(screen.getByRole('button', { name: zh['inbox.resume'] }))
    await screen.findByRole('button', { name: zh['inbox.pause'] })
    expect(face.control).toHaveBeenCalledWith('resume', undefined)
  })

  it('the room\'s copy leaves out the room\'s own queued rows and the pause control; other callers\' rows stay', async () => {
    const state: LocalAgentMemberInbox = { memberId: 'member', paused: true, messages: [
      { id: 'room-1', caller: 'room', status: 'queued', createdAt: 1, updatedAt: 1 },
      { id: 'composer-1', caller: 'composer', text: 'from the members page', status: 'queued', createdAt: 2, updatedAt: 2 },
    ] }
    const face: MemberInboxFace = { read: vi.fn(async () => state), control: vi.fn() }
    const view = render(<MemberInboxView face={face} room t={t} />)
    await screen.findByText(/from the members page/)
    expect(view.container.textContent).not.toContain(zh['inbox.caller.room'])
    expect(screen.queryByRole('button', { name: zh['inbox.resume'] })).toBeNull()
    expect(view.container.textContent).not.toContain(zh['inbox.paused'])
    cleanup()
    // Only room rows queued: the room's copy shows nothing at all.
    const roomOnly: LocalAgentMemberInbox = { ...state, messages: [state.messages[0]!] }
    const empty = render(<MemberInboxView face={{ read: vi.fn(async () => roomOnly), control: vi.fn() }} room t={t} />)
    await waitFor(() => expect(empty.container.textContent).toBe(''))
  })

  it('a room row with a preview reads 来自协作间：…; without one it keeps the caller name', async () => {
    const state: LocalAgentMemberInbox = { memberId: 'member', paused: false, messages: [
      { id: 'room-1', caller: 'room', preview: '另外：师父这条线最后不要死', status: 'queued', createdAt: 1, updatedAt: 1 },
      { id: 'room-2', caller: 'room', status: 'queued', createdAt: 2, updatedAt: 2 },
    ] }
    const view = render(<MemberInboxView face={{ read: vi.fn(async () => state), control: vi.fn() }} t={t} />)
    fireEvent.click(await screen.findByRole('button', { name: /待处理消息 · 2/ }))
    expect(view.container.textContent).toContain('来自协作间：另外：师父这条线最后不要死')
    expect(view.container.textContent).toContain(zh['inbox.caller.room'])
  })

  it('does not present admitted or completed input as a waiting queue', async () => {
    const state: LocalAgentMemberInbox = { memberId: 'member', paused: false, messages: [
      { id: 'active', text: 'already executing', status: 'running', createdAt: 1, updatedAt: 1 },
      { id: 'done', text: 'finished', status: 'done', createdAt: 1, updatedAt: 1 },
    ] }
    const face: MemberInboxFace = { read: vi.fn(async () => state), control: vi.fn() }
    const view = render(<MemberInboxView face={face} t={t} />)
    await waitFor(() => expect(face.read).toHaveBeenCalled())
    expect(view.container.textContent).toBe('')
    expect(screen.queryByRole('button', { name: zh['inbox.pause'] })).toBeNull()
  })

  it('counts all waiting inputs, expands them and cancels the selected identity', async () => {
    const state: LocalAgentMemberInbox = { memberId: 'member', paused: false, messages: Array.from({ length: 10 }, (_, i) => ({ id: `q-${i}`, text: `waiting ${i}`, status: 'queued', createdAt: i, updatedAt: i })) }
    const face: MemberInboxFace = { read: vi.fn(async () => state), control: vi.fn(async () => ({ ok: true })) }
    render(<MemberInboxView face={face} t={t} />)
    const toggle = await screen.findByRole('button', { name: /待处理消息 · 10/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('waiting 0')).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getAllByRole('listitem')).toHaveLength(10)
    fireEvent.click(screen.getAllByRole('button', { name: zh['inbox.cancel'] })[0]!)
    await waitFor(() => expect(face.control).toHaveBeenCalledWith('cancel', 'q-0'))
  })

  it('keeps a paused empty queue resumable without a zero pending count', async () => {
    const state: LocalAgentMemberInbox = { memberId: 'member', paused: true, messages: [] }
    const face: MemberInboxFace = { read: vi.fn(async () => state), control: vi.fn(async () => ({ ok: true })) }
    render(<MemberInboxView face={face} t={t} />)
    await screen.findByRole('button', { name: zh['inbox.resume'] })
    expect(screen.queryByText(/· 0/)).toBeNull()
  })

  it('a round a restart closed asks nothing (no evidence box); the continuation queued ahead of typed input reads 重启后继续', async () => {
    const state: LocalAgentMemberInbox = { memberId: 'member', paused: false, messages: [
      { id: 'cut', caller: 'composer', key: 'k-1', text: '把北岭的捷径再加一条', status: 'cancelled', interrupted: 'restart', error: '被重启打断', createdAt: 1, updatedAt: 2 },
      { id: 'cont', caller: 'composer', key: 'restart-continue:cut', text: '刚才实例重启，打断了你上一轮的工作。……', preview: '重启后继续', status: 'queued', createdAt: 3, updatedAt: 3 },
      { id: 'typed', caller: 'composer', key: 'k-2', text: '顺便把出生点挪到桥头。', status: 'queued', createdAt: 4, updatedAt: 4 },
    ] }
    const face: MemberInboxFace = { read: vi.fn(async () => state), control: vi.fn(async () => ({ ok: true })) }
    const view = render(<MemberInboxView face={face} t={t} />)
    fireEvent.click(await screen.findByRole('button', { expanded: false }))
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual(['重启后继续', '顺便把出生点挪到桥头。'])
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(view.container.textContent).not.toContain('被重启打断')
  })
})
