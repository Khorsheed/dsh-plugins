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
  // Drop any header fixture mounted by a spec.
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

/** The two host DOM lines the in-place probe supports. */
type HostLine = 'legacy' | 'current'

/** Mutable rect the fixture's current-title node reports, so specs can prove re-measurement. */
interface RectState {
  left: number
  top: number
  width: number
  height: number
}

/** The rect a freshly mounted fixture reports. */
const FIXTURE_RECT: RectState = { left: 10, top: 20, width: 100, height: 28 }

/** Knobs for {@link mountHeader}. */
interface HeaderOptions {
  /** Ancestor crumb text — set it equal to the title to prove the probe stays on the last segment. */
  ancestor?: string
  /** Extra sibling after the title node (the official lineage slot's seat). */
  lineage?: string
  /** Viewport rect the current-title node reports. */
  rect?: RectState
}

/**
 * Mount an official-header stand-in with the shape both supported host lines
 * draw (host `ConversationSession.tsx` + the renderer's slot anchor):
 * titleCluster > nav (one `crumbSeg` per breadcrumb, a `'/'` separator, the
 * current title node LAST) plus the headerActions row this entry is mounted in,
 * which holds the slot's own `[data-slot=…]` anchor (`display: contents`). The
 * lines differ in that node alone:
 *  - `legacy` (host ≤ 0.1.6): `<button type="button" disabled>`, the current
 *    crumb being the header's only disabled crumb button;
 *  - `current` (host ≥ 0.1.7-alpha.1, upstream 92101e1a5b): plain
 *    `<span class="crumbCurrent">` text, because a disabled button was
 *    subtracted from the darwin window-drag band.
 * jsdom reports zero rects, so the fixture supplies the measured one.
 * @param line - which host DOM line to mirror.
 * @param title - the current session title, as the crumb renders it.
 * @param options - ancestor text, trailing lineage content, and the rect.
 * @returns the slot anchor container to render the entry into.
 */
function mountHeader(line: HostLine, title: string, options: HeaderOptions = {}): HTMLElement {
  const rect = options.rect ?? { ...FIXTURE_RECT }
  const current = line === 'legacy'
    ? `<button type="button" class="crumb crumbCurrent" disabled>${title}</button>`
    : `<span class="crumb crumbCurrent">${title}</span>`
  const lineage = options.lineage === undefined ? '' : `<span class="lineage">${options.lineage}</span>`
  document.body.innerHTML = '<header><div class="titleCluster"><nav aria-label="会话层级">'
    + `<span class="crumbSeg"><button type="button" class="crumb">${options.ancestor ?? 'Ancestor'}</button></span>`
    + `<span class="crumbSeg"><span class="crumbSep">/</span>${current}${lineage}</span>`
    + '</nav><div class="headerActions">'
    + '<div data-slot="conversation.session.header.actions" style="display:contents"></div>'
    + '</div></div><div class="headerUtilities"></div></header>'
  const title$ = fixtureTitle()
  title$.getBoundingClientRect = () => ({
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
  return document.querySelector('[data-slot="conversation.session.header.actions"]') as HTMLElement
}

/** The fixture's current-title node (`.crumbCurrent` on both host lines). */
function fixtureTitle(): HTMLElement {
  return document.querySelector('header nav .crumbCurrent') as HTMLElement
}

/** The fixture's ancestor crumb (navigation, never the title). */
function fixtureAncestor(): HTMLElement {
  return document.querySelector('header nav .crumbSeg:first-child .crumb') as HTMLElement
}

/** Render the entry inside a mounted fixture header's actions row. */
function renderInHeader(container: HTMLElement, over: Parameters<typeof props>[0] = {}) {
  return render(<TitleEditAction {...props(over)} />, { container })
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

describe.each(['legacy', 'current'] as const)('TitleEditAction in-place editing (%s host line)', (line) => {
  it('opens in place: hides the official title and overlays the input at its rect', () => {
    renderInHeader(mountHeader(line, 'Current title'), { title: 'Current title' })
    fireEvent.click(screen.getByRole('button', OPEN))
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.className).toBeTruthy()
    expect(input.style.left).toBe('10px')
    expect(input.style.top).toBe('20px')
    expect(input.style.width).toBe('100px')
    expect(input.value).toBe('Current title')
    expect(input.selectionStart).toBe(0)
    expect(fixtureTitle().getAttribute('data-ste-inplace')).toBe('')
    // The ancestor crumb navigates, so it is never the title: it stays visible.
    expect(fixtureAncestor().hasAttribute('data-ste-inplace')).toBe(false)
  })

  it('commits on Enter and restores the title', async () => {
    const rename = vi.fn(async () => {})
    renderInHeader(mountHeader(line, 'Old'), { title: 'Old', rename })
    fireEvent.click(screen.getByRole('button', OPEN))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '  New  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(rename).toHaveBeenCalledWith('New')
    await act(async () => {})
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(fixtureTitle().hasAttribute('data-ste-inplace')).toBe(false)
  })

  it('cancels on Escape and restores the title', () => {
    const rename = vi.fn(async () => {})
    renderInHeader(mountHeader(line, 'Old'), { title: 'Old', rename })
    fireEvent.click(screen.getByRole('button', OPEN))
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(rename).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(fixtureTitle().hasAttribute('data-ste-inplace')).toBe(false)
  })

  it('cancels on blur and restores the title', () => {
    const rename = vi.fn(async () => {})
    renderInHeader(mountHeader(line, 'Old'), { title: 'Old', rename })
    fireEvent.click(screen.getByRole('button', OPEN))
    fireEvent.blur(screen.getByRole('textbox'))
    expect(rename).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(fixtureTitle().hasAttribute('data-ste-inplace')).toBe(false)
  })

  it('shows the rejection in the actions row and keeps the title hidden', async () => {
    const rename = vi.fn(async () => { throw renameFailure('title-invalid') })
    renderInHeader(mountHeader(line, 'Old'), { title: 'Old', rename })
    fireEvent.click(screen.getByRole('button', OPEN))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect((await screen.findByRole('alert')).textContent).toBe('标题不能为空')
    // In-flow (actions row), never fixed: it cannot overlap the title area.
    expect(screen.getByRole('alert').style.position).toBe('')
    expect(screen.getByRole('textbox')).toBeTruthy()
    expect(fixtureTitle().getAttribute('data-ste-inplace')).toBe('')
  })

  it('restores the title when it unmounts mid-edit', () => {
    const { unmount } = renderInHeader(mountHeader(line, 'Old'), { title: 'Old' })
    fireEvent.click(screen.getByRole('button', OPEN))
    expect(fixtureTitle().getAttribute('data-ste-inplace')).toBe('')
    unmount()
    expect(fixtureTitle().hasAttribute('data-ste-inplace')).toBe(false)
  })

  it('re-measures the overlay when the window resizes', () => {
    const rect: RectState = { left: 10, top: 20, width: 100, height: 28 }
    renderInHeader(mountHeader(line, 'Old', { rect }), { title: 'Old' })
    fireEvent.click(screen.getByRole('button', OPEN))
    expect(screen.getByRole<HTMLInputElement>('textbox').style.left).toBe('10px')
    rect.left = 50
    fireEvent(window, new Event('resize'))
    expect(screen.getByRole<HTMLInputElement>('textbox').style.left).toBe('50px')
  })

  it('keeps the editor open while the rename is in flight: blur does not cancel', async () => {
    let settle!: () => void
    const rename = vi.fn(() => new Promise<void>((resolve) => { settle = resolve }))
    renderInHeader(mountHeader(line, 'Old'), { title: 'Old', rename })
    fireEvent.click(screen.getByRole('button', OPEN))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Busy' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(rename).toHaveBeenCalledWith('Busy')
    fireEvent.blur(input)
    expect(screen.getByRole('textbox')).toBeTruthy()
    expect(fixtureTitle().getAttribute('data-ste-inplace')).toBe('')
    await act(async () => { settle() })
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(fixtureTitle().hasAttribute('data-ste-inplace')).toBe(false)
  })

  it('stays on the current crumb when an ancestor carries the same title', () => {
    renderInHeader(mountHeader(line, 'Same title', { ancestor: 'Same title' }), { title: 'Same title' })
    fireEvent.click(screen.getByRole('button', OPEN))
    expect(fixtureAncestor().hasAttribute('data-ste-inplace')).toBe(false)
    expect(fixtureTitle().getAttribute('data-ste-inplace')).toBe('')
  })

  it('leaves slot-rendered lineage content after the title untouched', () => {
    renderInHeader(mountHeader(line, 'Parent session', { lineage: '3' }), { title: 'Parent session' })
    fireEvent.click(screen.getByRole('button', OPEN))
    const lineage = document.querySelector('header nav .lineage') as HTMLElement
    expect(lineage.hasAttribute('data-ste-inplace')).toBe(false)
    expect(fixtureTitle().getAttribute('data-ste-inplace')).toBe('')
  })

  it('probes by projected title text, with the disabled-button shape as the ≤0.1.6 fallback', () => {
    // The store still shows the previous title while the crumb already renders
    // the new one. The legacy line locates the crumb by its disabled-button
    // shape; the current line has no such marker and degrades to the row editor.
    renderInHeader(mountHeader(line, 'Rendered title'), { title: 'Projected title' })
    fireEvent.click(screen.getByRole('button', OPEN))
    if (line === 'legacy') {
      expect(fixtureTitle().getAttribute('data-ste-inplace')).toBe('')
      expect(screen.queryByRole('button', SAVE)).toBeNull()
    } else {
      expect(document.querySelector('header nav [data-ste-inplace]')).toBeNull()
      expect(screen.getByRole<HTMLButtonElement>('button', SAVE)).toBeTruthy()
    }
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

describe.each(['legacy', 'current'] as const)('TitleEditAction in-place auto-fit (%s host line)', (line) => {
  it('grows the overlay with the draft text and clamps at the official 220px crumb cap', () => {
    renderInHeader(mountHeader(line, 'Short'), { title: 'Short' })
    fireEvent.click(screen.getByRole('button', OPEN))
    const input = screen.getByRole<HTMLInputElement>('textbox')
    // Open floors the fitted width at the title node's measured width (100px fixture).
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

  it('never shrinks the overlay below the title width while deleting', () => {
    renderInHeader(mountHeader(line, 'A fairly long original title'), { title: 'A fairly long original title' })
    fireEvent.click(screen.getByRole('button', OPEN))
    const input = screen.getByRole<HTMLInputElement>('textbox')
    expect(input.style.width).toBe('100px') // fixture title width 100
    fireEvent.change(input, { target: { value: 'x' } })
    // Mirror measures 0 in jsdom; the title-width floor keeps the box stable.
    expect(input.style.width).toBe('100px')
  })

  it('shows the over-limit hint in place and blocks Enter commit', () => {
    const rename = vi.fn(async () => {})
    renderInHeader(mountHeader(line, 'Old'), { title: 'Old', rename })
    fireEvent.click(screen.getByRole('button', OPEN))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '汉'.repeat(27) } })
    expect(screen.getByRole('alert').textContent).toContain('最多 80 字节')
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(rename).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox')).toBeTruthy()
    expect(fixtureTitle().getAttribute('data-ste-inplace')).toBe('')
  })
})
