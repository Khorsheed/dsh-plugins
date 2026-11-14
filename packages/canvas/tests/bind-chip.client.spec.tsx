// @vitest-environment jsdom
/**
 * The session header's binding chip: the gate that decides which sessions get
 * it, and the chip itself, which lists every live canvas and binds, opens and
 * unbinds through its face.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { CanvasBindChip, type CanvasBindInjected } from '../src/client/bind/BindChip.tsx'
import { GenreBindingGate, type GenreGrantSource } from '../src/client/bind/gate.ts'
import { zh } from '../src/client/locales.ts'
import type { CanvasGenreSummary, CanvasSummary } from '../src/types.ts'
import { notifyWritten } from '@khorsheed/dsh-client-ui-agent-nav/src/client/index.ts'

const NOW = '2026-10-05T08:00:00.000Z'
const S1 = 's1' as SessionId
const CANVAS_ROW = '@khorsheed/dsh-canvas/agent'
const NOVEL_ROW = '@khorsheed/dsh-canvas-novel/agent'

const t = ((key: keyof typeof zh, params?: Record<string, string>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)) as never

function genre(over: Partial<CanvasGenreSummary> = {}): CanvasGenreSummary {
  return { id: 'novel', label: '长篇小说', version: 'novel@1', description: '', roles: [], agentRow: NOVEL_ROW, ...over }
}

/** A grant source answering from a fixed set of granted rows. */
function grants(granted: readonly string[]): GenreGrantSource & { calls: string[][] } {
  const calls: string[][] = []
  return {
    calls,
    grantsAny: (_sid, modules) => { calls.push([...modules]); return modules.some(row => granted.includes(row)) },
    subscribe: () => () => {},
  }
}

async function settledGate(gate: GenreBindingGate): Promise<void> {
  const off = gate.subscribe(() => {})
  await new Promise(resolve => setTimeout(resolve, 0))
  off()
}

describe('GenreBindingGate', () => {
  it('offers ordinary binding through the canvas row without any genre', async () => {
    const offered = new GenreBindingGate(async () => ({ ok: true, value: [] }), grants([CANVAS_ROW]))
    const denied = new GenreBindingGate(async () => ({ ok: true, value: [] }), grants([]))
    await settledGate(offered)
    await settledGate(denied)
    expect(offered.offered(S1)).toBe(true)
    expect(denied.offered(S1)).toBe(false)
  })

  it('keeps the canvas offer when the genre listing fails', async () => {
    const gate = new GenreBindingGate(async () => { throw new Error('genre listing failed') }, grants([CANVAS_ROW]))
    await settledGate(gate)
    expect(gate.offered(S1)).toBe(true)
  })

  it('also follows the preset grant of a genre’s agent row', async () => {
    const granted = new GenreBindingGate(async () => ({ ok: true, value: [genre()] }), grants([NOVEL_ROW]))
    const denied = new GenreBindingGate(async () => ({ ok: true, value: [genre()] }), grants([]))
    await settledGate(granted)
    await settledGate(denied)
    expect(granted.offered(S1)).toBe(true)
    expect(denied.offered(S1)).toBe(false)
  })

  it('offers the chip for a genre that gates no tools', async () => {
    const { agentRow: _row, ...open } = genre()
    const gate = new GenreBindingGate(async () => ({ ok: true, value: [open] }), grants([]))
    await settledGate(gate)
    expect(gate.offered(S1)).toBe(true)
  })
})

function summary(id: string, title: string, over: Partial<CanvasSummary> = {}): CanvasSummary {
  return { id, title, cardCount: 0, openQuestions: 0, archivedAt: null, lastActiveAt: NOW, ...over }
}

function face(over: Partial<CanvasBindInjected> & { bound?: string | null } = {}) {
  let bound = over.bound ?? null
  const mocks = {
    offered: vi.fn(() => true),
    subscribe: vi.fn(() => () => {}),
    boundCanvas: vi.fn(async () => ({ ok: true as const, value: bound })),
    bindCanvas: vi.fn(async (canvasId: string | null) => {
      bound = canvasId
      return { ok: true as const, value: { ok: true as const, canvasId } }
    }),
    listCanvases: vi.fn(async () => ({
      ok: true as const,
      value: {
        items: [
          summary('canvas_plain', '随手记'),
          summary('canvas_rain', '雨夜', { genre: 'novel' }),
          summary('canvas_old', '旧稿', { genre: 'novel', archivedAt: NOW }),
        ],
      },
    })),
    openCanvas: vi.fn(),
    ...over,
  }
  return mocks
}

afterEach(() => { cleanup() })

describe('CanvasBindChip', () => {
  it('renders nothing where the gate does not offer it', () => {
    const { container } = render(<CanvasBindChip t={t} {...face({ offered: () => false })} />)
    expect(container.innerHTML).toBe('')
  })

  it('lists every live canvas, including a plain one, and binds the picked work', async () => {
    const mocks = face()
    render(<CanvasBindChip t={t} {...mocks} />)
    fireEvent.click(await screen.findByRole('button', { name: zh['bind.aria'] }))
    const plain = await screen.findByRole('menuitem', { name: '随手记' })
    expect(screen.getByRole('menuitem', { name: '雨夜' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: '旧稿' })).toBeNull()
    fireEvent.click(plain)
    await waitFor(() => { expect(mocks.bindCanvas).toHaveBeenCalledWith('canvas_plain') })
    await screen.findByText('作品 · 随手记')
  })

  it('names the bound work on its label, opens it, and unbinds', async () => {
    const mocks = face({ bound: 'canvas_rain' })
    render(<CanvasBindChip t={t} {...mocks} />)
    await screen.findByText('作品 · 雨夜')
    fireEvent.click(screen.getByRole('button', { name: zh['bind.aria'] }))
    fireEvent.click(await screen.findByRole('menuitem', { name: zh['bind.open'] }))
    expect(mocks.openCanvas).toHaveBeenCalledWith('canvas_rain')
    fireEvent.click(screen.getByRole('button', { name: zh['bind.aria'] }))
    fireEvent.click(await screen.findByRole('menuitem', { name: zh['bind.unbind'] }))
    await waitFor(() => { expect(mocks.bindCanvas).toHaveBeenCalledWith(null) })
    await screen.findByText(zh['bind.unbound'])
  })

  it('re-reads the binding and list immediately after a local binding revision', async () => {
    const listeners = new Set<() => void>()
    let rev = 0
    let bound: string | null = null
    const items = [summary('canvas_plain', '随手记')]
    const mocks = face({
      subscribe: vi.fn((next: () => void) => { listeners.add(next); return () => { listeners.delete(next) } }),
      revision: () => rev,
      boundCanvas: vi.fn(async () => ({ ok: true as const, value: bound })),
      listCanvases: vi.fn(async () => ({ ok: true as const, value: { items } })),
    })
    render(<CanvasBindChip t={t} {...mocks} />)
    await screen.findByText(zh['bind.unbound'])
    items.push(summary('canvas_new', '新作品'))
    bound = 'canvas_new'
    act(() => { rev += 1; for (const listener of listeners) listener() })
    await screen.findByText('作品 · 新作品')
  })

  it('picks up a binding the model made when the conversation writes a canvas, else on the slow re-read', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      let bound: string | null = null
      const mocks = face({ boundCanvas: vi.fn(async () => ({ ok: true as const, value: bound })) })
      render(<CanvasBindChip t={t} {...mocks} />)
      await screen.findByText(zh['bind.unbound'])
      bound = 'canvas_rain'
      notifyWritten({ kind: 'canvas', params: { canvasId: 'canvas_rain' } })
      await screen.findByText('作品 · 雨夜')
      bound = null
      await vi.advanceTimersByTimeAsync(30_000)
      await screen.findByText(zh['bind.unbound'])
    } finally {
      vi.useRealTimers()
    }
  })
})
