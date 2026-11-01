// @vitest-environment jsdom
/**
 * The turn card is the game's body inside the one conversation card: the
 * shell's frame and door (打开游戏面板 → the play area), the game's rows, each
 * row's jump through the same `go`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { zh } from '../src/client/locales.ts'
import { GAME_TURN_KEY, GameTurnCard } from '../src/client/TurnCard.tsx'
import type { TurnReport } from '../src/types.ts'

const t = ((key: keyof typeof zh, params?: Record<string, string | number>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match))) as unknown as PropsLocale<'game'>['t']

afterEach(() => { cleanup() })

const report: TurnReport = {
  turn: 3, projectId: 'g_1', title: '灯塔', at: '2026-11-01T00:00:00Z',
  version: { kind: 'deployed', version: 2 },
  check: { ok: true, fixes: 0, gaveUp: false, passed: 4, failures: 0 },
  elements: [{ id: 'e1', name: '九尾狐', what: 'fields', fields: ['速度'] }],
  chapters: [], params: [], code: [], tests: [],
}

describe('GameTurnCard', () => {
  it('renders in the shared shell; the head door opens the play area, a row opens its place', async () => {
    const go = vi.fn()
    const api = { turnReport: vi.fn(async () => ({ ok: true, value: report })) }
    render(<GameTurnCard
      {...{ t, api, go, sessionId: 's1', subscribeSessionEvents: () => () => {} } as never}
      turn={{ data: { get: (key: string) => key === GAME_TURN_KEY ? { turn: 3, ended: true } : undefined }, end: { seq: 9 } }}
    />)
    expect(await screen.findByText(zh['turn.title'].replace('{title}', '灯塔'))).toBeTruthy()
    fireEvent.click(screen.getByText(`${zh['turn.openPanel']} →`))
    expect(go).toHaveBeenLastCalledWith({ projectId: 'g_1', view: 'play' })
    fireEvent.click(screen.getAllByText(zh['turn.see'])[1]!)
    expect(go).toHaveBeenLastCalledWith({ view: 'elements', elementId: 'e1' })
  })
})
