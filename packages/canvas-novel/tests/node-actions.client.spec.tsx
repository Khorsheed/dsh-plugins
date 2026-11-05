// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NodeActions } from '../src/client/NodeActions.tsx'
import { zh } from '../src/client/locales.ts'
import type { NovelSurfaceProps } from '../src/client/contract.ts'

const t = ((key: keyof typeof zh, params?: Record<string, string | number>) => zh[key].replace(/\{(\w+)\}/g, (match, name) => String(params?.[name] ?? match))) as NovelSurfaceProps['t']
afterEach(cleanup)

describe('card header actions', () => {
  it('puts details and delete behind one fixed menu', () => {
    const openCard = vi.fn()
    render(<NodeActions node="w1" name="微系" openCard={openCard} del={node => <button type="button">{`删除 ${node}`}</button>} t={t} />)
    expect(screen.queryByRole('button', { name: zh['codex.details'] })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['action.more'] }))
    fireEvent.click(screen.getByRole('button', { name: zh['codex.details'] }))
    expect(openCard).toHaveBeenCalledWith('w1', '微系')
    fireEvent.click(screen.getByRole('button', { name: zh['action.more'] }))
    expect(screen.getByRole('button', { name: '删除 w1' })).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('button', { name: zh['codex.details'] })).toBeNull()
  })
})
