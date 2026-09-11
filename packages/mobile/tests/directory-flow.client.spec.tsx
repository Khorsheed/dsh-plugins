// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DirectoryFlow } from '../src/client/DirectoryFlow.tsx'
import { en } from '../src/client/locales.ts'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
})
afterEach(cleanup)
const t = (key: keyof typeof en) => en[key]
describe('remote workspace path flow', () => {
  it('passes the selected path to the official owner without a native chooser', () => {
    const picked = vi.fn()
    render(<DirectoryFlow open busy={false} onPicked={picked} onCancel={vi.fn()} onError={vi.fn()} t={t} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: ' /home/user/project ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open', exact: true }))
    expect(picked).toHaveBeenCalledExactlyOnceWith('/home/user/project')
  })
  it('does not submit while adoption is pending; cancellation returns to owner', () => {
    const picked = vi.fn(), cancel = vi.fn()
    const view = render(<DirectoryFlow open busy onPicked={picked} onCancel={cancel} onError={vi.fn()} t={t} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '/home/user/project' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Open', exact: true }).closest('form')!)
    expect(picked).not.toHaveBeenCalled()
    view.rerender(<DirectoryFlow open busy={false} onPicked={picked} onCancel={cancel} onError={vi.fn()} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(cancel).toHaveBeenCalledOnce()
  })
})
