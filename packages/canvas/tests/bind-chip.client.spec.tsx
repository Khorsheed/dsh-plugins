// @vitest-environment jsdom
/**
 * The session header's binding chip (创作体裁): the gate that decides which
 * sessions get it — no genre installed means no chip, whatever the preset —
 * and the chip itself, which lists only canvases with a genre and binds,
 * opens and unbinds through its face.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { CanvasBindChip, type CanvasBindInjected } from '../src/client/bind/BindChip.tsx'
import { GenreBindingGate, type GenreGrantSource } from '../src/client/bind/gate.ts'
import { zh } from '../src/client/locales.ts'
import type { CanvasGenreSummary, CanvasSummary } from '../src/types.ts'

const NOW = '2026-10-05T08:00:00.000Z'
const S1 = 's1' as SessionId
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
  it('offers no chip while no genre is installed, even where every row is granted', async () => {
    const gate = new GenreBindingGate(async () => ({ ok: true, value: [] }), grants([NOVEL_ROW]))
    expect(gate.offered(S1)).toBe(false)
    await settledGate(gate)
    expect(gate.offered(S1)).toBe(false)
  })

  it('offers no chip when the genre listing fails — the genre half fails closed', async () => {
    const gate = new GenreBindingGate(async () => { throw new Error('host half missing') }, grants([NOVEL_ROW]))
    await settledGate(gate)
    expect(gate.offered(S1)).toBe(false)
  })

  it('follows the preset grant of the genre’s agent row', async () => {
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

  it('lists only live canvases with a genre, and binds the picked one', async () => {
    const mocks = face()
    render(<CanvasBindChip t={t} {...mocks} />)
    fireEvent.click(await screen.findByRole('button', { name: zh['bind.aria'] }))
    const rain = await screen.findByRole('menuitem', { name: '雨夜' })
    expect(screen.queryByRole('menuitem', { name: '随手记' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: '旧稿' })).toBeNull()
    fireEvent.click(rain)
    await waitFor(() => { expect(mocks.bindCanvas).toHaveBeenCalledWith('canvas_rain') })
    await screen.findByText('作品 · 雨夜')
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
})
