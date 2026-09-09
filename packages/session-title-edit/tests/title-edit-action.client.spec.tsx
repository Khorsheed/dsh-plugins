// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { TitleEditAction } from '../src/client/TitleEditAction.tsx'
import type { TitleEditActionProps } from '../src/client/slots.ts'
import { zh } from '../src/client/locales.ts'
import { isRenameFailure, type RenameFailure } from '../src/client/slots.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  // Drop any in-place crumb fixture mounted by a spec.
  document.body.innerHTML = ''
})

const SESSION = 's1' as SessionId
const t: TitleEditActionProps['t'] = makeTranslate(zh)

function summary(title: string): SessionSummary {
  return { displayTitle: title } as SessionSummary
}

/** Props with a stub session list; a missing title leaves byId without the session. */
function props(over: {
  title?: string
  rename?: (title: string) => Promise<void>
} = {}): TitleEditActionProps {
  const byId: Record<string, SessionSummary> = over.title === undefined
    ? {}
    : { [SESSION]: summary(over.title) }
  const state = {
    ids: [SESSION],
    byId,
    current: SESSION,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  } satisfies SessionListState
  const useSessions = <T,>(select: (snapshot: SessionListState) => T): T => select(state)
  return {
    sessionId: SESSION,
    useSessions,
    renameSession: over.rename ?? vi.fn(async () => {}),
    t,
  } as unknown as TitleEditActionProps
}

function renameFailure(code: string): RenameFailure {
  const failure = new Error('host rejection') as RenameFailure
  failure.code = code
  return failure
}

const OPEN = { name: '重命名会话' }
const SAVE = { name: '保存' }
const CANCEL = { name: '取消' }

/** Mutable rect the fixture crumb reports, so specs can prove re-measurement. */
interface RectState {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Mount a fake official header crumb (a disabled button inside `header nav`)
 * so the in-place probe locates it; jsdom's default rect is all zeros, so the
 * fixture supplies one.
 */
function mountCrumb(title: string, rect: RectState = { left: 10, top: 20, width: 100, height: 28 }): HTMLButtonElement {
  document.body.innerHTML = `<header><nav aria-label="Session hierarchy"><span><button disabled>${title}</button></span></nav></header>`
  const crumb = document.querySelector('header nav button:disabled') as HTMLButtonElement
  crumb.getBoundingClientRect = () => ({
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  })
  return crumb
}

/** The fixture crumb element, or null when no in-place fixture is mounted. */
function fixtureCrumb(): HTMLButtonElement | null {
  return document.querySelector('header nav button:disabled') as HTMLButtonElement | null
}

describe('TitleEditAction open and prefill', () => {
  it('renders the pencil control that opens the editor prefilled with the display title and selects it', () => {
    render(<TitleEditAction {...props({ title: 'Current title' })} />)
    fireEvent.click(screen.getByRole('button', OPEN))
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('Current title')
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('Current title'.length)
  })

  it('opens with an empty draft when the session has no title yet', () => {
    render(<TitleEditAction {...props({})} />)
    fireEvent.click(screen.getByRole('button', OPEN))
    expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe('')
  })
})

describe('TitleEditAction commit', () => {
  it('saves the trimmed title and closes the editor', async () => {
    const rename = vi.fn(async () => {})
    render(<TitleEditAction {...props({ title: 'Old', rename })} />)
    fireEvent.click(screen.getByRole('button', OPEN))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  New name  ' } })
    fireEvent.click(screen.getByRole('button', SAVE))
    expect(rename).toHaveBeenCalledWith('New name')
    await act(async () => {})
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('commits on Enter and cancels on Escape', async () => {
    const rename = vi.fn(async () => {})
    render(<TitleEditAction {...props({ title: 'Old', rename })} />)
    fireEvent.click(screen.getByRole('button', OPEN))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Kept' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(rename).toHaveBeenCalledWith('Kept')
    await act(async () => {})
    expect(screen.queryByRole('textbox')).toBeNull()

    // A second open cancels via Escape without committing.
    fireEvent.click(screen.getByRole('button', OPEN))
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(rename).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('ignores unrelated keys while editing', () => {
    render(<TitleEditAction {...props({ title: 'Old' })} />)
    fireEvent.click(screen.getByRole('button', OPEN))
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'a' })
    expect(screen.getByRole('textbox')).toBeTruthy()
  })

  it('keeps save disabled for an empty or whitespace-only draft', () => {
    render(<TitleEditAction {...props({})} />)
    fireEvent.click(screen.getByRole('button', OPEN))
    expect(screen.getByRole<HTMLButtonElement>('button', SAVE).disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } })
    expect(screen.getByRole<HTMLButtonElement>('button', SAVE).disabled).toBe(true)
  })

  it('does not block saving the current title: confirming it is the pin gesture', () => {
    const rename = vi.fn(async () => {})
    render(<TitleEditAction {...props({ title: 'Current', rename })} />)
    fireEvent.click(screen.getByRole('button', OPEN))
    expect(screen.getByRole<HTMLButtonElement>('button', SAVE).disabled).toBe(false)
  })

  it('does not commit an empty draft on Enter', () => {
    const rename = vi.fn(async () => {})
    render(<TitleEditAction {...props({ rename })} />)
    fireEvent.click(screen.getByRole('button', OPEN))
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(rename).not.toHaveBeenCalled()
  })

  it('keeps the editor open and disables both buttons while the rename is in flight', async () => {
    let settle!: () => void
    const rename = vi.fn(() => new Promise<void>((resolve) => { settle = resolve }))
    render(<TitleEditAction {...props({ title: 'Old', rename })} />)
    fireEvent.click(screen.getByRole('button', OPEN))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Busy' } })
    fireEvent.click(screen.getByRole('button', SAVE))
    expect(rename).toHaveBeenCalledWith('Busy')
    expect(screen.getByRole<HTMLButtonElement>('button', SAVE).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', CANCEL).disabled).toBe(true)
    expect(screen.getByRole<HTMLInputElement>('textbox').disabled).toBe(true)
    await act(async () => { settle() })
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})

describe('TitleEditAction failures', () => {
  it('maps a title-invalid host rejection to the invalid-title copy and stays open', async () => {
    const rename = vi.fn(async () => { throw renameFailure('title-invalid') })
    render(<TitleEditAction {...props({ title: 'Old', rename })} />)
    fireEvent.click(screen.getByRole('button', OPEN))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New' } })
    fireEvent.click(screen.getByRole('button', SAVE))
    expect((await screen.findByRole('alert')).textContent).toBe('标题不能为空')
    expect(screen.getByRole('textbox')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', SAVE).disabled).toBe(false)
  })

  it('maps the namespaced session/title-invalid rejection to the invalid-title copy and stays open', async () => {
    const rename = vi.fn(async () => { throw renameFailure('session/title-invalid') })
    render(<TitleEditAction {...props({ title: 'Old', rename })} />)
    fireEvent.click(screen.getByRole('button', OPEN))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New' } })
    fireEvent.click(screen.getByRole('button', SAVE))
    expect((await screen.findByRole('alert')).textContent).toBe('标题不能为空')
    expect(screen.getByRole('textbox')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', SAVE).disabled).toBe(false)
  })

  it('maps a generic rejection to the retry copy and stays open', async () => {
    const rename = vi.fn(async () => { throw new Error('boom') })
    render(<TitleEditAction {...props({ title: 'Old', rename })} />)
    fireEvent.click(screen.getByRole('button', OPEN))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New' } })
    fireEvent.click(screen.getByRole('button', SAVE))
    expect((await screen.findByRole('alert')).textContent).toBe('重命名失败，请重试')
  })

  it('maps a renamed failure with an unknown code to the retry copy', async () => {
    const rename = vi.fn(async () => { throw renameFailure('transport') })
    render(<TitleEditAction {...props({ title: 'Old', rename })} />)
    fireEvent.click(screen.getByRole('button', OPEN))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New' } })
    fireEvent.click(screen.getByRole('button', SAVE))
    expect((await screen.findByRole('alert')).textContent).toBe('重命名失败，请重试')
  })

  it('maps a non-Error rejection to the retry copy', async () => {
    const rename = vi.fn(async () => { throw 'boom' })
    render(<TitleEditAction {...props({ title: 'Old', rename })} />)
    fireEvent.click(screen.getByRole('button', OPEN))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New' } })
    fireEvent.click(screen.getByRole('button', SAVE))
    expect((await screen.findByRole('alert')).textContent).toBe('重命名失败，请重试')
  })

  it('maps an Error with a non-string code to the retry copy', async () => {
    const tagged = new Error('boom') as RenameFailure
    tagged.code = 42 as unknown as string
    const rename = vi.fn(async () => { throw tagged })
    render(<TitleEditAction {...props({ title: 'Old', rename })} />)
    fireEvent.click(screen.getByRole('button', OPEN))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New' } })
    fireEvent.click(screen.getByRole('button', SAVE))
    expect((await screen.findByRole('alert')).textContent).toBe('重命名失败，请重试')
  })

  it('keeps the RenameFailure guard narrow for non-failures', () => {
    expect(isRenameFailure(new Error('plain'))).toBe(false)
    expect(isRenameFailure('plain')).toBe(false)
    const tagged = new Error('boom') as RenameFailure
    tagged.code = 42 as unknown as string
    expect(isRenameFailure(tagged)).toBe(false)
  })
})

describe('TitleEditAction in-place editing (crumb fixture mounted)', () => {
  it('opens in place: hides the official crumb and overlays the input at its rect', () => {
    mountCrumb('Current title')
    render(<TitleEditAction {...props({ title: 'Current title' })} />)
    fireEvent.click(screen.getByRole('button', OPEN))
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.className).toBeTruthy()
    expect(input.style.left).toBe('10px')
    expect(input.style.top).toBe('20px')
    expect(input.style.width).toBe('100px')
    expect(input.value).toBe('Current title')
    expect(input.selectionStart).toBe(0)
    expect(fixtureCrumb()?.getAttribute('data-ste-inplace')).toBe('')
  })

  it('commits on Enter and restores the crumb', async () => {
    const rename = vi.fn(async () => {})
    mountCrumb('Old')
    render(<TitleEditAction {...props({ title: 'Old', rename })} />)
    fireEvent.click(screen.getByRole('button', OPEN))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '  New  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(rename).toHaveBeenCalledWith('New')
    await act(async () => {})
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(fixtureCrumb()?.hasAttribute('data-ste-inplace')).toBe(false)
  })

  it('cancels on Escape and restores the crumb', () => {
    const rename = vi.fn(async () => {})
    mountCrumb('Old')
    render(<TitleEditAction {...props({ title: 'Old', rename })} />)
    fireEvent.click(screen.getByRole('button', OPEN))
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(rename).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(fixtureCrumb()?.hasAttribute('data-ste-inplace')).toBe(false)
  })

  it('cancels on blur and restores the crumb', () => {
    const rename = vi.fn(async () => {})
    mountCrumb('Old')
    render(<TitleEditAction {...props({ title: 'Old', rename })} />)
    fireEvent.click(screen.getByRole('button', OPEN))
    fireEvent.blur(screen.getByRole('textbox'))
    expect(rename).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(fixtureCrumb()?.hasAttribute('data-ste-inplace')).toBe(false)
  })

  it('shows the rejection in the actions row and keeps the crumb hidden', async () => {
    const rename = vi.fn(async () => { throw renameFailure('title-invalid') })
    mountCrumb('Old')
    render(<TitleEditAction {...props({ title: 'Old', rename })} />)
    fireEvent.click(screen.getByRole('button', OPEN))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect((await screen.findByRole('alert')).textContent).toBe('标题不能为空')
    // In-flow (actions row), never fixed: it cannot overlap the title area.
    expect(screen.getByRole('alert').style.position).toBe('')
    expect(screen.getByRole('textbox')).toBeTruthy()
    expect(fixtureCrumb()?.getAttribute('data-ste-inplace')).toBe('')
  })

  it('restores the crumb when it unmounts mid-edit', () => {
    mountCrumb('Old')
    const { unmount } = render(<TitleEditAction {...props({ title: 'Old' })} />)
    fireEvent.click(screen.getByRole('button', OPEN))
    expect(fixtureCrumb()?.getAttribute('data-ste-inplace')).toBe('')
    unmount()
    expect(fixtureCrumb()?.hasAttribute('data-ste-inplace')).toBe(false)
  })

  it('re-measures the overlay when the window resizes', () => {
    const rect: RectState = { left: 10, top: 20, width: 100, height: 28 }
    mountCrumb('Old', rect)
    render(<TitleEditAction {...props({ title: 'Old' })} />)
    fireEvent.click(screen.getByRole('button', OPEN))
    expect(screen.getByRole<HTMLInputElement>('textbox').style.left).toBe('10px')
    rect.left = 50
    fireEvent(window, new Event('resize'))
    expect(screen.getByRole<HTMLInputElement>('textbox').style.left).toBe('50px')
  })

  it('keeps the editor open while the rename is in flight: blur does not cancel', async () => {
    let settle!: () => void
    const rename = vi.fn(() => new Promise<void>((resolve) => { settle = resolve }))
    mountCrumb('Old')
    render(<TitleEditAction {...props({ title: 'Old', rename })} />)
    fireEvent.click(screen.getByRole('button', OPEN))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Busy' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(rename).toHaveBeenCalledWith('Busy')
    fireEvent.blur(input)
    expect(screen.getByRole('textbox')).toBeTruthy()
    expect(fixtureCrumb()?.getAttribute('data-ste-inplace')).toBe('')
    await act(async () => { settle() })
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(fixtureCrumb()?.hasAttribute('data-ste-inplace')).toBe(false)
  })
})

describe('TitleEditAction length gate (row editor)', () => {
  it('shows the over-limit hint and disables save beyond the host byte cap', () => {
    render(<TitleEditAction {...props({})} />)
    fireEvent.click(screen.getByRole('button', OPEN))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '汉'.repeat(27) } })
    expect(screen.getByRole('alert').textContent).toContain('最多 80 字节')
    expect(screen.getByRole<HTMLButtonElement>('button', SAVE).disabled).toBe(true)
  })

  it('accepts a draft at exactly the byte cap', () => {
    render(<TitleEditAction {...props({})} />)
    fireEvent.click(screen.getByRole('button', OPEN))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '汉'.repeat(26) } })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', SAVE).disabled).toBe(false)
  })

  it('clears the hint and re-enables save once the draft fits again', () => {
    render(<TitleEditAction {...props({})} />)
    fireEvent.click(screen.getByRole('button', OPEN))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '汉'.repeat(30) } })
    expect(screen.getByRole<HTMLButtonElement>('button', SAVE).disabled).toBe(true)
    fireEvent.change(input, { target: { value: 'short' } })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', SAVE).disabled).toBe(false)
  })

  it('never commits an over-limit draft on Enter', () => {
    const rename = vi.fn(async () => {})
    render(<TitleEditAction {...props({ title: 'Old', rename })} />)
    fireEvent.click(screen.getByRole('button', OPEN))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '汉'.repeat(27) } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(rename).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox')).toBeTruthy()
  })
})

describe('TitleEditAction in-place auto-fit', () => {
  it('grows the overlay with the draft text and clamps at the official 220px crumb cap', () => {
    mountCrumb('Short')
    render(<TitleEditAction {...props({ title: 'Short' })} />)
    fireEvent.click(screen.getByRole('button', OPEN))
    const input = screen.getByRole<HTMLInputElement>('textbox')
    // Open floors the fitted width at the crumb's measured width (100px fixture).
    expect(input.style.width).toBe('100px')
    const mirror = document.querySelector('[aria-hidden="true"]') as HTMLSpanElement
    expect(mirror).toBeTruthy()
    // A draft the crumb could not have shown (offsetWidth 160) widens the box.
    Object.defineProperty(mirror, 'offsetWidth', { value: 160, configurable: true })
    fireEvent.change(input, { target: { value: 'a longer title that overflows the crumb' } })
    expect(input.style.width).toBe('182px') // 160 + (8+1)*2 padding/border + 4 caret buffer
    // A very wide draft clamps at 220px, matching the crumb's max-width.
    Object.defineProperty(mirror, 'offsetWidth', { value: 500, configurable: true })
    fireEvent.change(input, { target: { value: 'W'.repeat(80) } })
    expect(input.style.width).toBe('220px')
  })

  it('never shrinks the overlay below the crumb width while deleting', () => {
    mountCrumb('A fairly long original title')
    render(<TitleEditAction {...props({ title: 'A fairly long original title' })} />)
    fireEvent.click(screen.getByRole('button', OPEN))
    const input = screen.getByRole<HTMLInputElement>('textbox')
    expect(input.style.width).toBe('100px') // fixture crumb width 100
    fireEvent.change(input, { target: { value: 'x' } })
    // Mirror measures 0 in jsdom; the crumb-width floor keeps the box stable.
    expect(input.style.width).toBe('100px')
  })

  it('shows the over-limit hint in place and blocks Enter commit', () => {
    const rename = vi.fn(async () => {})
    mountCrumb('Old')
    render(<TitleEditAction {...props({ title: 'Old', rename })} />)
    fireEvent.click(screen.getByRole('button', OPEN))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '汉'.repeat(27) } })
    expect(screen.getByRole('alert').textContent).toContain('最多 80 字节')
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(rename).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox')).toBeTruthy()
    expect(fixtureCrumb()?.getAttribute('data-ste-inplace')).toBe('')
  })
})
