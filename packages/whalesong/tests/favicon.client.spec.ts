// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFaviconAnimator, FRAME_MS } from '../src/client/favicon.ts'

const WHALE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 50 50"><style>path { fill: #000; }</style><path id="path" fill="#000" d="M1 1h10v10H1z"/></svg>'

/** Mount an icon link like the shell's and return it. */
function mountIcon(doc: Document, href = '/favicon.svg'): HTMLLinkElement {
  const link = doc.createElement('link')
  link.rel = 'icon'
  link.type = 'image/svg+xml'
  link.href = href
  doc.head.appendChild(link)
  return link
}

/** fetch fake answering the whale svg (or failing). */
function fetchSvg(svg: string | Error): typeof fetch {
  return (() => svg instanceof Error
    ? Promise.reject(svg)
    : Promise.resolve({ ok: true, text: () => Promise.resolve(svg) } as Response)) as unknown as typeof fetch
}

/** fetch fake answering from a queue (Error = network failure). */
function fetchQueue(...steps: (string | Error)[]): typeof fetch {
  let calls = 0
  return (() => {
    const step = steps[Math.min(calls, steps.length - 1)]
    calls += 1
    if (step instanceof Error) return Promise.reject(step)
    return Promise.resolve({ ok: true, text: () => Promise.resolve(step) } as Response)
  }) as unknown as typeof fetch
}

/** Decode the current data-URL frame back to svg text. */
function currentFrameSvg(link: HTMLLinkElement): string {
  const href = link.getAttribute('href') ?? ''
  expect(href.startsWith('data:image/svg+xml')).toBe(true)
  return decodeURIComponent(href.slice(href.indexOf(',') + 1))
}

describe('createFaviconAnimator', () => {
  afterEach(() => {
    document.head.innerHTML = ''
    document.body.removeAttribute('data-ds-dark-theme')
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders the static page-matched whale on creation (no task running yet)', async () => {
    vi.useFakeTimers()
    const link = mountIcon(document)
    const animator = createFaviconAnimator(window, { doc: document, fetchImpl: fetchSvg(WHALE_SVG) })
    await vi.advanceTimersByTimeAsync(0) // let the svg fetch land
    const frame = currentFrameSvg(link)
    expect(frame).toContain('fill="#000000"') // light page: black whale
    expect(frame).not.toContain('<style>') // the media query is gone
    expect(frame).not.toContain('<rect x="0" y="43"') // no waterline while idle
    expect(animator.active).toBe(false)
    animator.dispose()
  })

  it('active swaps the href to svg data-url frames and cycles them', async () => {
    vi.useFakeTimers()
    const link = mountIcon(document)
    const animator = createFaviconAnimator(window, { doc: document, fetchImpl: fetchSvg(WHALE_SVG) })
    await vi.advanceTimersByTimeAsync(0) // frames ready
    animator.setActive(true)
    expect(animator.active).toBe(true)
    const first = link.getAttribute('href') ?? ''
    expect(first.startsWith('data:image/svg+xml')).toBe(true)
    await vi.advanceTimersByTimeAsync(FRAME_MS)
    const second = link.getAttribute('href') ?? ''
    expect(second).not.toBe(first) // frame advanced
    animator.dispose()
  })

  it('renders the waterline-bubble frame: bobbing whale group + waterline rect + 3 solid bubbles', async () => {
    vi.useFakeTimers()
    const link = mountIcon(document)
    const animator = createFaviconAnimator(window, { doc: document, fetchImpl: fetchSvg(WHALE_SVG) })
    await vi.advanceTimersByTimeAsync(0) // frames ready
    animator.setActive(true)

    // frame 0: bob = 0
    const frame0 = currentFrameSvg(link)
    expect(frame0).toContain('<g transform="translate(0 0)"><path id="path"')
    expect(frame0).toContain('<rect x="0" y="43" width="50" height="7" fill="#2E5BFF" opacity="0.85"/>')
    const bubbles0 = frame0.match(/<circle /g) ?? []
    expect(bubbles0).toHaveLength(3)
    expect(frame0).toContain('r="2.6"')
    expect(frame0.match(/<circle [^>]*opacity/)).toBeNull() // bubbles stay solid (16px visibility)
    // bubble rise slots y = [13, 9, 5, 1] by (frame + i) % 4
    expect(frame0).toContain('cx="21" cy="13"')
    expect(frame0).toContain('cx="25" cy="9"')
    expect(frame0).toContain('cx="29" cy="5"')
    // The stock <style> block (theme media query) must NOT survive into the
    // frame: data-URL favicons cannot evaluate it reliably, and the whale
    // fill is pinned explicitly instead.
    expect(frame0).not.toContain('<style>')

    // frame 1: bob = -1.5, bubbles one phase up
    await vi.advanceTimersByTimeAsync(FRAME_MS)
    const frame1 = currentFrameSvg(link)
    expect(frame1).toContain('<g transform="translate(0 -1.5)"><path id="path"')
    expect(frame1).toContain('cx="21" cy="9"')
    expect(frame1).toContain('cx="29" cy="1"')

    // frame 3: bob = 1
    await vi.advanceTimersByTimeAsync(FRAME_MS * 2)
    const frame3 = currentFrameSvg(link)
    expect(frame3).toContain('<g transform="translate(0 1)"><path id="path"')
    animator.dispose()
  })

  it('keeps the waterline/bubbles on an svg without the whale path marker', async () => {
    vi.useFakeTimers()
    const link = mountIcon(document)
    const plain = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50"><rect width="50" height="50"/></svg>'
    const animator = createFaviconAnimator(window, { doc: document, fetchImpl: fetchSvg(plain) })
    await vi.advanceTimersByTimeAsync(0)
    animator.setActive(true)
    const frame0 = currentFrameSvg(link)
    expect(frame0).not.toContain('<g transform=') // no bob wrap without the marker
    expect(frame0).toContain('fill="#2E5BFF"')
    animator.dispose()
  })

  it('setActive(false) shows the static page-matched whale and stops cycling', async () => {
    vi.useFakeTimers()
    const link = mountIcon(document)
    const animator = createFaviconAnimator(window, { doc: document, fetchImpl: fetchSvg(WHALE_SVG) })
    await vi.advanceTimersByTimeAsync(0)
    animator.setActive(true)
    animator.setActive(false)
    const staticFrame = currentFrameSvg(link)
    expect(staticFrame).not.toContain('<rect x="0" y="43"') // idle: no waterline
    await vi.advanceTimersByTimeAsync(FRAME_MS * 3)
    expect(currentFrameSvg(link)).toBe(staticFrame) // stays static
    animator.dispose()
  })

  it('does not start the interval when deactivated while the frames load', async () => {
    vi.useFakeTimers()
    const link = mountIcon(document)
    const animator = createFaviconAnimator(window, { doc: document, fetchImpl: fetchSvg(WHALE_SVG) })
    animator.setActive(true)
    animator.setActive(false) // deactivate before the fetch resolves
    await vi.advanceTimersByTimeAsync(0)
    expect(currentFrameSvg(link)).not.toContain('<rect x="0" y="43"') // static whale, no interval
    await vi.advanceTimersByTimeAsync(FRAME_MS * 2)
    expect(currentFrameSvg(link)).not.toContain('<rect x="0" y="43"')
    animator.setActive(true) // frames already cached: animation resumes immediately
    expect(currentFrameSvg(link)).toContain('<rect x="0" y="43"')
    animator.dispose()
  })

  it('dispose leaves the static page-matched whale', async () => {
    vi.useFakeTimers()
    const link = mountIcon(document)
    const animator = createFaviconAnimator(window, { doc: document, fetchImpl: fetchSvg(WHALE_SVG) })
    await vi.advanceTimersByTimeAsync(0)
    animator.setActive(true)
    animator.dispose()
    expect(currentFrameSvg(link)).toContain('fill="#000000"') // themed whale stays
    expect(currentFrameSvg(link)).not.toContain('<rect x="0" y="43"')
  })

  it('reduced-motion: the static page-matched whale stays, never animated', async () => {
    vi.useFakeTimers()
    const link = mountIcon(document)
    const animator = createFaviconAnimator(window, {
      doc: document, fetchImpl: fetchSvg(WHALE_SVG), reducedMotion: () => true,
    })
    await vi.advanceTimersByTimeAsync(0)
    animator.setActive(true)
    await vi.advanceTimersByTimeAsync(FRAME_MS * 5)
    expect(currentFrameSvg(link)).not.toContain('<rect x="0" y="43"') // no animation
    expect(currentFrameSvg(link)).toContain('fill="#000000"') // but themed
    animator.dispose()
  })

  it('drops animation under prefers-reduced-motion via the default matchMedia probe', () => {
    vi.useFakeTimers()
    const link = mountIcon(document)
    const fakeWin = { document, matchMedia: () => ({ matches: true }) } as unknown as Window
    const animator = createFaviconAnimator(fakeWin)
    animator.setActive(true)
    expect(link.getAttribute('href')).toBe('/favicon.svg') // no fetch: stock stays
    animator.dispose()
  })

  it('fetch failure degrades to a silent no-op (stock favicon untouched, no throw)', async () => {
    vi.useFakeTimers()
    const link = mountIcon(document)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const animator = createFaviconAnimator(window, { doc: document, fetchImpl: fetchSvg(new Error('404')) })
    expect(() => animator.setActive(true)).not.toThrow()
    await vi.advanceTimersByTimeAsync(FRAME_MS * 3)
    expect(link.getAttribute('href')).toBe('/favicon.svg')
    expect(warn).toHaveBeenCalledOnce()
    animator.dispose()
  })

  it('degrades when the route answers non-OK', async () => {
    vi.useFakeTimers()
    const link = mountIcon(document)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchImpl = (() => Promise.resolve({ ok: false, status: 503 } as Response)) as unknown as typeof fetch
    const animator = createFaviconAnimator(window, { doc: document, fetchImpl })
    await vi.advanceTimersByTimeAsync(0)
    expect(link.getAttribute('href')).toBe('/favicon.svg')
    expect(warn).toHaveBeenCalledOnce()
    animator.dispose()
  })

  it('degrades when the icon is not an SVG document', async () => {
    vi.useFakeTimers()
    const link = mountIcon(document)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const animator = createFaviconAnimator(window, { doc: document, fetchImpl: fetchSvg('not an svg') })
    await vi.advanceTimersByTimeAsync(0)
    expect(link.getAttribute('href')).toBe('/favicon.svg')
    expect(warn).toHaveBeenCalledOnce()
    animator.dispose()
  })

  it('retries after a transient failure: the next activation edge reloads frames', async () => {
    vi.useFakeTimers()
    const link = mountIcon(document)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // First fetch fails (restart-window load), the retry succeeds.
    const animator = createFaviconAnimator(window, {
      doc: document, fetchImpl: fetchQueue(new Error('transient'), WHALE_SVG),
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(link.getAttribute('href')).toBe('/favicon.svg') // failed load: stock stays
    expect(warn).toHaveBeenCalledOnce()
    animator.setActive(true) // activation edge → retry
    await vi.advanceTimersByTimeAsync(0)
    expect(currentFrameSvg(link)).toContain('#2E5BFF') // frames loaded, animation running
    animator.dispose()
  })

  it('reports a non-Error rejection reason as its string form', async () => {
    vi.useFakeTimers()
    const link = mountIcon(document)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchImpl = (() => Promise.reject('route gone')) as unknown as typeof fetch
    const animator = createFaviconAnimator(window, { doc: document, fetchImpl })
    await vi.advanceTimersByTimeAsync(0)
    expect(link.getAttribute('href')).toBe('/favicon.svg')
    expect(warn).toHaveBeenCalledWith('[whalesong] favicon animation disabled: route gone')
    animator.dispose()
  })

  it('missing icon link degrades to a no-op', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const animator = createFaviconAnimator(window, { doc: document, fetchImpl: fetchSvg(WHALE_SVG) })
    expect(() => animator.setActive(true)).not.toThrow()
    animator.setActive(false)
    animator.dispose()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('does not throw when the surface has no fetch', () => {
    const link = mountIcon(document)
    const fakeWin = { document } as unknown as Window
    const animator = createFaviconAnimator(fakeWin)
    expect(() => animator.setActive(true)).not.toThrow()
    expect(link.getAttribute('href')).toBe('/favicon.svg')
    animator.dispose()
  })

  it('follows the page palette: light page black whale, dark page white whale, theme switch re-renders', async () => {
    vi.useFakeTimers()
    const link = mountIcon(document)
    try {
      const animator = createFaviconAnimator(window, { doc: document, fetchImpl: fetchSvg(WHALE_SVG) })
      await vi.advanceTimersByTimeAsync(0)
      expect(currentFrameSvg(link)).toContain('fill="#000000"') // light page → black whale
      // The page switches to dark: the observer re-renders a white whale.
      document.body.setAttribute('data-ds-dark-theme', '')
      await vi.advanceTimersByTimeAsync(0)
      expect(currentFrameSvg(link)).toContain('fill="#FFFFFF"')
      // And the animation frames follow too.
      animator.setActive(true)
      expect(currentFrameSvg(link)).toContain('fill="#FFFFFF"')
      expect(currentFrameSvg(link)).toContain('<rect x="0" y="43"')
      animator.dispose()
    } finally {
      document.body.removeAttribute('data-ds-dark-theme')
    }
  })

  it('setActive is idempotent (repeat true keeps one interval)', async () => {
    vi.useFakeTimers()
    const link = mountIcon(document)
    const animator = createFaviconAnimator(window, { doc: document, fetchImpl: fetchSvg(WHALE_SVG) })
    await vi.advanceTimersByTimeAsync(0)
    animator.setActive(true)
    animator.setActive(true)
    const first = link.getAttribute('href')
    await vi.advanceTimersByTimeAsync(FRAME_MS)
    expect(link.getAttribute('href')).not.toBe(first)
    animator.setActive(false)
    expect(currentFrameSvg(link)).not.toContain('<rect x="0" y="43"')
    animator.dispose()
  })
})
