// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createWhalesongOverlay, findWhaleRect, setWhalesongActive, type WhalesongOverlay,
} from '../src/client/whalesong-overlay.ts'

/** Mock an element's rect (jsdom returns all-zero rects); reads the passed object live at call time. */
function mockRect(el: Element, rect: { left: number; top: number; width: number; height: number }): void {
  vi.spyOn(el, 'getBoundingClientRect').mockImplementation(() => ({
    ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => ({}),
  } as DOMRect))
}

/** Wide-sidebar wordmark: an SVG wrapping the stable whale clipPath. */
function mountWordmark(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 182 24')
  const clip = doc.createElementNS('http://www.w3.org/2000/svg', 'clipPath')
  clip.id = 'dsh-wordmark-whale-clip'
  svg.appendChild(clip)
  doc.body.appendChild(svg)
  return svg as SVGSVGElement
}

/** Collapsed-sidebar fish logo: an SVG with the stable viewBox. */
function mountFish(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 23.16 17.04')
  doc.body.appendChild(svg)
  return svg as SVGSVGElement
}

describe('findWhaleRect', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('anchors the whale to the left 23/182 segment of the BrandWordmark svg', () => {
    const svg = mountWordmark(document)
    mockRect(svg, { left: 100, top: 50, width: 182, height: 24 })
    const rect = findWhaleRect(document)
    expect(rect).toBeDefined()
    expect(rect?.left).toBe(100)
    expect(rect?.top).toBe(50)
    expect(rect?.width).toBeCloseTo(23)
    expect(rect?.height).toBe(24)
  })

  it('falls back to the whole FishLogo svg when the wordmark is absent', () => {
    const svg = mountFish(document)
    mockRect(svg, { left: 10, top: 20, width: 24, height: 18 })
    const rect = findWhaleRect(document)
    expect(rect).toBeDefined()
    expect(rect?.left).toBe(10)
    expect(rect?.width).toBe(24)
  })

  it('prefers the wordmark when both logo variants exist', () => {
    const wordmark = mountWordmark(document)
    const fish = mountFish(document)
    mockRect(wordmark, { left: 100, top: 50, width: 182, height: 24 })
    mockRect(fish, { left: 10, top: 20, width: 24, height: 18 })
    expect(findWhaleRect(document)?.left).toBe(100)
  })

  it('returns undefined when no logo is mounted', () => {
    expect(findWhaleRect(document)).toBeUndefined()
  })
})

describe('setWhalesongActive', () => {
  afterEach(() => {
    document.body.classList.remove('dsh-whalesong-on')
  })

  it('toggles the dsh-whalesong-on body class', () => {
    setWhalesongActive(document, true)
    expect(document.body.classList.contains('dsh-whalesong-on')).toBe(true)
    setWhalesongActive(document, false)
    expect(document.body.classList.contains('dsh-whalesong-on')).toBe(false)
  })
})

describe('createWhalesongOverlay', () => {
  let overlay: WhalesongOverlay | undefined

  afterEach(() => {
    overlay?.dispose()
    overlay = undefined
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('falls back to the rail corner when no logo exists; warns only past the grace window', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const created = createWhalesongOverlay(document)
    overlay = created
    const container = document.body.querySelector('div')
    expect(container).not.toBeNull()
    expect(container?.hidden).toBe(false)
    // fallback rect {left:12, top:6, width:24, height:24}: center 24px, top 6-16
    expect(container?.style.left).toBe('24px')
    expect(container?.style.top).toBe('-10px')
    now.mockReturnValue(5_000)
    created.sync()
    expect(warn).not.toHaveBeenCalled() // inside the 5s grace (startup race is silent)
    now.mockReturnValue(7_000)
    created.sync()
    expect(warn).toHaveBeenCalledOnce() // still missing past the grace window
    now.mockReturnValue(13_000)
    created.sync()
    expect(warn).toHaveBeenCalledOnce() // one-time
  })

  it('positions over the whale when the wordmark is mounted', () => {
    const svg = mountWordmark(document)
    mockRect(svg, { left: 100, top: 50, width: 182, height: 24 })
    overlay = createWhalesongOverlay(document)
    const container = document.body.querySelector('div')
    expect(container?.hidden).toBe(false)
    // center of the whale segment: 100 + 23/2; top: 50 - overlay height 16
    expect(container?.style.left).toBe('111.5px')
    expect(container?.style.top).toBe('34px')
    expect(container?.childElementCount).toBe(3)
  })

  it('re-anchors on sync after the logo moves', () => {
    const svg = mountFish(document)
    const rect = { left: 10, top: 20, width: 24, height: 18 }
    mockRect(svg, rect)
    overlay = createWhalesongOverlay(document)
    expect(document.body.querySelector('div')?.style.left).toBe('22px')
    rect.left = 40
    overlay.sync()
    expect(document.body.querySelector('div')?.style.left).toBe('52px')
  })

  it('re-anchors on window resize', () => {
    const svg = mountFish(document)
    const rect = { left: 10, top: 20, width: 24, height: 18 }
    mockRect(svg, rect)
    overlay = createWhalesongOverlay(document)
    expect(document.body.querySelector('div')?.style.left).toBe('22px')
    rect.left = 70
    window.dispatchEvent(new Event('resize'))
    expect(document.body.querySelector('div')?.style.left).toBe('82px')
  })

  it('falls back (stays visible) when the logo disappears', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const svg = mountFish(document)
    mockRect(svg, { left: 10, top: 20, width: 24, height: 18 })
    overlay = createWhalesongOverlay(document)
    expect(document.body.querySelector('div')?.style.left).toBe('22px')
    svg.remove()
    overlay.sync()
    const container = document.body.querySelector('div')
    expect(container?.hidden).toBe(false)
    expect(container?.style.left).toBe('24px') // fallback anchor
  })

  it('coalesces mutation bursts into one sync per throttle window', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    overlay = createWhalesongOverlay(document)
    expect(document.body.querySelector('div')?.style.left).toBe('24px') // fallback initially
    const svg = mountFish(document)
    mockRect(svg, { left: 10, top: 20, width: 24, height: 18 })
    await new Promise(resolve => setTimeout(resolve, 0)) // delivery 1: sync → fish
    expect(document.body.querySelector('div')?.style.left).toBe('22px')
    now.mockReturnValue(1_050) // 50ms later — inside the throttle window
    svg.remove()
    await new Promise(resolve => setTimeout(resolve, 0)) // delivery 2: throttled
    expect(document.body.querySelector('div')?.style.left).toBe('22px') // still the fish position
    now.mockReturnValue(1_400) // outside the window again
    const second = mountFish(document)
    mockRect(second, { left: 60, top: 20, width: 24, height: 18 })
    await new Promise(resolve => setTimeout(resolve, 0)) // delivery 3: re-syncs
    expect(document.body.querySelector('div')?.style.left).toBe('72px')
    vi.restoreAllMocks()
  })

  it('dispose removes the container', () => {
    overlay = createWhalesongOverlay(document)
    expect(document.body.querySelector('div')).not.toBeNull()
    overlay.dispose()
    overlay = undefined
    expect(document.body.querySelector('div')).toBeNull()
  })

  it('works without a window (detached document): no listeners, no poll', () => {
    const doc = document.implementation.createHTMLDocument()
    const created = createWhalesongOverlay(doc)
    expect(doc.body.querySelector('div')).not.toBeNull()
    expect(doc.body.querySelector('div')?.hidden).toBe(false) // fallback position applied
    created.dispose()
    expect(doc.body.querySelector('div')).toBeNull()
  })
})
