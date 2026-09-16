// @vitest-environment jsdom
/**
 * The app-level selection seam: the pure classification (empty selection,
 * editable containment, the menu's own root — each hides the menu) and the
 * real source's event wiring (drag deferral, the debounced keyboard path,
 * the immediate mouseup pass, scroll/resize hide). jsdom's selection carries
 * no layout, so rects are asserted as present, never by value.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { classifySelection, createSelectionSource, type SelectionSnapshot } from '../src/client/selection.ts'

/** jsdom does not implement range geometry; the real host always does. */
const ZERO_RECT = {
  x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0,
  toJSON: () => ({}),
} as DOMRect

beforeAll(() => {
  if (typeof Range.prototype.getBoundingClientRect !== 'function') {
    Range.prototype.getBoundingClientRect = () => ZERO_RECT
  }
})

/** Select the whole content of one element and return the Selection. */
function selectAllOf(element: Element): Selection {
  const selection = window.getSelection()
  if (selection === null) throw new Error('jsdom has no selection')
  selection.setBaseAndExtent(element, 0, element, element.childNodes.length)
  return selection
}

afterEach(() => {
  document.body.innerHTML = ''
  window.getSelection()?.removeAllRanges()
  vi.useRealTimers()
})

describe('classifySelection', () => {
  it('answers null for a null or collapsed selection', () => {
    expect(classifySelection(null, () => false)).toBeNull()
    document.body.innerHTML = '<p>你好</p>'
    const selection = window.getSelection()
    selection?.removeAllRanges()
    expect(classifySelection(selection, () => false)).toBeNull()
  })

  it('answers null for a whitespace-only selection', () => {
    document.body.innerHTML = '<p id="a">   </p>'
    const selection = selectAllOf(document.querySelector('#a')!)
    expect(classifySelection(selection, () => false)).toBeNull()
  })

  it('answers the plain text and a rect for an ordinary selection', () => {
    document.body.innerHTML = '<p id="a">选我<strong>全部</strong></p>'
    const selection = selectAllOf(document.querySelector('#a')!)
    const snapshot = classifySelection(selection, () => false)
    expect(snapshot?.text).toBe('选我全部')
    expect(snapshot?.rect).toMatchObject({ left: expect.any(Number), top: expect.any(Number) })
  })

  it('answers null inside a textarea (the editing exclusion)', () => {
    document.body.innerHTML = '<textarea id="a">正在编辑</textarea>'
    const selection = selectAllOf(document.querySelector('#a')!)
    expect(classifySelection(selection, () => false)).toBeNull()
  })

  it('answers null inside a contenteditable, but not inside a contenteditable="false" island', () => {
    document.body.innerHTML = '<div contenteditable="true" id="a">可编辑</div><div contenteditable="false" id="b">只读岛</div>'
    expect(classifySelection(selectAllOf(document.querySelector('#a')!), () => false)).toBeNull()
    expect(classifySelection(selectAllOf(document.querySelector('#b')!), () => false)).not.toBeNull()
  })

  it("answers null when the selection sits inside the menu's own root", () => {
    document.body.innerHTML = '<p id="a">选我</p>'
    const selection = selectAllOf(document.querySelector('#a')!)
    expect(classifySelection(selection, () => true)).toBeNull()
  })
})

describe('createSelectionSource', () => {
  function sourceBench(): {
    emissions: Array<SelectionSnapshot | null>
    stop: () => void
    source: ReturnType<typeof createSelectionSource>
  } {
    vi.useFakeTimers()
    const emissions: Array<SelectionSnapshot | null> = []
    const source = createSelectionSource(window)
    const stop = source.start(snapshot => { emissions.push(snapshot) })
    return { emissions, stop, source }
  }

  it('debounces a keyboard-driven selectionchange into one emission', () => {
    const { emissions, stop } = sourceBench()
    document.body.innerHTML = '<p id="a">选中这段</p>'
    selectAllOf(document.querySelector('#a')!)
    document.dispatchEvent(new Event('selectionchange'))
    document.dispatchEvent(new Event('selectionchange'))
    expect(emissions).toEqual([])
    vi.advanceTimersByTime(200)
    expect(emissions).toEqual([expect.objectContaining({ text: '选中这段' })])
    stop()
  })

  it('defers while the mouse is held down and reports on mouseup', () => {
    const { emissions, stop } = sourceBench()
    document.body.innerHTML = '<p id="a">拖拽选择</p>'
    selectAllOf(document.querySelector('#a')!)
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    document.dispatchEvent(new Event('selectionchange'))
    vi.advanceTimersByTime(500)
    expect(emissions).toEqual([])
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    vi.advanceTimersByTime(10)
    expect(emissions).toEqual([expect.objectContaining({ text: '拖拽选择' })])
    stop()
  })

  it('emits null on scroll and on resize (the cached rect is stale)', () => {
    const { emissions, stop } = sourceBench()
    document.body.innerHTML = '<p id="a">选中这段</p>'
    selectAllOf(document.querySelector('#a')!)
    window.dispatchEvent(new Event('scroll'))
    window.dispatchEvent(new Event('resize'))
    expect(emissions).toEqual([null, null])
    stop()
  })

  it('never re-arms on a selection inside the attached menu root', () => {
    const { emissions, stop, source } = sourceBench()
    document.body.innerHTML = '<div id="menu"><span id="a">菜单里的字</span></div>'
    source.attachRoot(document.querySelector('#menu') as HTMLElement)
    selectAllOf(document.querySelector('#a')!)
    document.dispatchEvent(new Event('selectionchange'))
    vi.advanceTimersByTime(200)
    expect(emissions).toEqual([null])
    stop()
  })

  it('stops listening after teardown', () => {
    const { emissions, stop } = sourceBench()
    stop()
    document.body.innerHTML = '<p id="a">选中这段</p>'
    selectAllOf(document.querySelector('#a')!)
    document.dispatchEvent(new Event('selectionchange'))
    vi.advanceTimersByTime(200)
    window.dispatchEvent(new Event('scroll'))
    expect(emissions).toEqual([])
  })
})
