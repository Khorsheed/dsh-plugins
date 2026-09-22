// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemberInboxView, type MemberInboxFace } from '../src/client/MemberInboxView.tsx'
import type { LocalAgentMemberInbox } from '../src/types.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const t = ((key: keyof typeof zh) => zh[key]) as never

describe('member inbox controls', () => {
  it('shows queued input, cancels its identity and resumes a recovered queue', async () => {
    const state: LocalAgentMemberInbox = { memberId: 'member', paused: true, messages: [{ id: 'input-1', text: 'queued work', status: 'queued', createdAt: 1, updatedAt: 1 }] }
    const face: MemberInboxFace = { read: vi.fn(async () => structuredClone(state)), control: vi.fn(async (action) => { if (action === 'resume') state.paused = false; return { ok: true } }) }
    render(<MemberInboxView face={face} t={t} />)
    await screen.findByText(/queued work/)
    fireEvent.click(screen.getByRole('button', { name: zh['inbox.cancel'] }))
    await waitFor(() => expect(face.control).toHaveBeenCalledWith('cancel', 'input-1', undefined, ''))
    fireEvent.click(screen.getByRole('button', { name: zh['inbox.resume'] }))
    await screen.findByRole('button', { name: zh['inbox.pause'] })
    expect(face.control).toHaveBeenCalledWith('resume', undefined, undefined, '')
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
    await waitFor(() => expect(face.control).toHaveBeenCalledWith('cancel', 'q-0', undefined, ''))
  })

  it('keeps a paused empty queue resumable without a zero pending count', async () => {
    const state: LocalAgentMemberInbox = { memberId: 'member', paused: true, messages: [] }
    const face: MemberInboxFace = { read: vi.fn(async () => state), control: vi.fn(async () => ({ ok: true })) }
    render(<MemberInboxView face={face} t={t} />)
    await screen.findByRole('button', { name: zh['inbox.resume'] })
    expect(screen.queryByText(/· 0/)).toBeNull()
  })

  it('requires reconciliation evidence and sends the selected outcome without replaying', async () => {
    const state: LocalAgentMemberInbox = { memberId: 'member', paused: true, messages: [{ id: 'uncertain-1', text: 'unknown work', status: 'uncertain', createdAt: 1, updatedAt: 1 }] }
    const face: MemberInboxFace = { read: vi.fn(async () => state), control: vi.fn(async () => ({ ok: true })) }
    render(<MemberInboxView face={face} t={t} />)
    const done = await screen.findByRole('button', { name: zh['inbox.confirmDone'] }) as HTMLButtonElement
    expect(done.disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox', { name: zh['inbox.evidence'] }), { target: { value: 'verified native output' } })
    fireEvent.click(done)
    await waitFor(() => expect(face.control).toHaveBeenCalledWith('reconcile', 'uncertain-1', 'done', 'verified native output'))
    expect(face.control).toHaveBeenCalledTimes(1)
  })
})
