// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearEditorPosition,
  continuationTail,
  loadEditorPosition,
  loadReadingMemory,
  saveEditorPosition,
  saveReadingMemory,
} from '../src/client/reader-memory.ts'

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('chapter reader memory', () => {
  it('round-trips the chapter and mode, and removes them at the contents', () => {
    saveReadingMemory('canvas-a', { n: 3, editing: true })
    expect(loadReadingMemory('canvas-a')).toEqual({ n: 3, editing: true })
    expect(loadReadingMemory('canvas-b')).toBeNull()
    saveReadingMemory('canvas-a', { n: 3 })
    expect(loadReadingMemory('canvas-a')).toEqual({ n: 3 })
    saveReadingMemory('canvas-a', null)
    expect(loadReadingMemory('canvas-a')).toBeNull()
  })

  it('clamps restored offsets to the current draft and isolates chapters', () => {
    saveEditorPosition('canvas-a', 1, { start: 8, end: 20, scrollTop: 160 })
    expect(loadEditorPosition('canvas-a', 1, 10)).toEqual({ start: 8, end: 10, scrollTop: 160 })
    expect(loadEditorPosition('canvas-a', 2, 10)).toBeNull()
    expect(loadEditorPosition('canvas-b', 1, 10)).toBeNull()
    clearEditorPosition('canvas-a', 1)
    expect(loadEditorPosition('canvas-a', 1, 10)).toBeNull()
  })

  it('does not inherit editor position when a chapter number is reused', () => {
    saveEditorPosition('canvas-a', 'chapter-old', { start: 4, end: 8, scrollTop: 120 })
    expect(loadEditorPosition('canvas-a', 'chapter-new', 10)).toBeNull()
    expect(loadEditorPosition('canvas-a', 'chapter-old', 10)).toEqual({ start: 4, end: 8, scrollTop: 120 })
  })

  it('ignores malformed or unavailable storage', () => {
    window.localStorage.setItem('novel-reading:canvas-a', '{bad json')
    window.localStorage.setItem('novel-editor-position:canvas-a:1', JSON.stringify({ version: 1, start: 9, end: 2, scrollTop: 0 }))
    expect(loadReadingMemory('canvas-a')).toBeNull()
    expect(loadEditorPosition('canvas-a', 1, 20)).toBeNull()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    expect(() => saveReadingMemory('canvas-a', { n: 1 })).not.toThrow()
    expect(() => saveEditorPosition('canvas-a', 1, { start: 0, end: 0, scrollTop: 0 })).not.toThrow()
    expect(loadReadingMemory('canvas-a')).toBeNull()
    expect(loadEditorPosition('canvas-a', 1, 20)).toBeNull()
  })

  it('takes the saved ending without its trailing whitespace', () => {
    expect(continuationTail('开头。最后一句。\n\n', 80)).toBe('开头。最后一句。')
    expect(continuationTail('123456', 3)).toBe('456')
  })
})
