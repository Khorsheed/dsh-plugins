// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { PendingList } from '../src/client/PendingList.tsx'
import type { NovelRemote } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
import type { PendingView } from '../src/types.ts'

const SESSION = 's-duplicate' as SessionId
const t = ((key: keyof typeof zh, params?: Record<string, string | number>) => zh[key].replace(/\{(\w+)\}/g, (match, name) => String(params?.[name] ?? match))) as Parameters<typeof PendingList>[0]['t']
const item: PendingView = {
  id: 'p1', kind: 'duplicate', chapter: 2, reason: '名称互相包含', payload: { cardId: 'w_old', content: '新增差异', name: '微系联盟' }, status: 'pending', createdAt: 'now',
}

afterEach(cleanup)

describe('suspected duplicate review', () => {
  it('offers merge and separate decisions and sends the matching action', async () => {
    const remote = { decidePending: vi.fn(() => Promise.resolve({ ok: true, value: { ok: true } })) } as unknown as NovelRemote
    const navigate = { openCard: vi.fn(), openPage: vi.fn(), openManuscripts: vi.fn(), refresh: vi.fn() }
    render(<PendingList canvasId="canvas" items={[item]} navigate={navigate} sessionId={SESSION} remote={remote} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: zh['pending.duplicate.accept'] }))
    expect(remote.decidePending).toHaveBeenCalledWith(SESSION, { canvasId: 'canvas', id: 'p1', action: 'accept' })
    await new Promise(resolve => { setTimeout(resolve, 0) })
    fireEvent.click(screen.getByRole('button', { name: zh['pending.duplicate.discard'] }))
    expect(remote.decidePending).toHaveBeenCalledWith(SESSION, { canvasId: 'canvas', id: 'p1', action: 'discard' })
  })

  it('does not offer a merge when no existing card matched', () => {
    const remote = { decidePending: vi.fn() } as unknown as NovelRemote
    render(<PendingList canvasId="canvas" items={[{ ...item, payload: { content: '独立设定', name: '甲与乙' } }]} navigate={{ openCard: vi.fn(), openPage: vi.fn(), openManuscripts: vi.fn(), refresh: vi.fn() }} sessionId={SESSION} remote={remote} t={t} />)
    expect(screen.queryByRole('button', { name: zh['pending.duplicate.accept'] })).toBeNull()
    expect(screen.getByRole('button', { name: zh['pending.duplicate.discard'] })).toBeTruthy()
  })

  it('lets the person choose which combined-name target receives the supplement', async () => {
    const remote = { decidePending: vi.fn(() => Promise.resolve({ ok: true, value: { ok: true } })) } as unknown as NovelRemote
    const combined = {
      ...item,
      payload: {
        ...item.payload,
        candidateIds: ['w_micro', 'w_utopia'], candidateNames: ['微系', '乌托邦'],
      },
    }
    render(<PendingList canvasId="canvas" items={[combined]} navigate={{ openCard: vi.fn(), openPage: vi.fn(), openManuscripts: vi.fn(), refresh: vi.fn() }} sessionId={SESSION} remote={remote} t={t} />)
    fireEvent.change(screen.getByRole('combobox', { name: zh['pending.duplicate.target'] }), { target: { value: 'w_utopia' } })
    fireEvent.click(screen.getByRole('button', { name: zh['pending.duplicate.accept'] }))
    expect(remote.decidePending).toHaveBeenCalledWith(SESSION, { canvasId: 'canvas', id: 'p1', action: 'accept', cardId: 'w_utopia' })
  })
})
