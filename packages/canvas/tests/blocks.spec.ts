/**
 * A card's body as a flow of blocks: the pointer lines that place drawings
 * and lift images, the fence that keeps code as code, the trailing home of an
 * unplaced drawing, and the text a flow saves back as.
 */
import { describe, expect, it } from 'vitest'
import {
  blocksOf, cardBlocksOf, drawIdOf, drawLineOf, freshDrawingId, textOfBlocks, withoutDrawLines,
} from '../src/blocks.ts'
import type { CanvasStroke } from '../src/types.ts'

const INK: readonly CanvasStroke[] = [{ pts: [[0, 0, 0.5], [10, 10, 0.5]], color: 'ink' }] as unknown as CanvasStroke[]

describe('blocksOf', () => {
  it('splits words around a drawing line', () => {
    expect(blocksOf('开头\n\n![](draw://d1)\n\n结尾')).toEqual([
      { kind: 'text', text: '开头' },
      { kind: 'draw', id: 'd1' },
      { kind: 'text', text: '结尾' },
    ])
  })

  it('keeps a pointer inside a code fence as code', () => {
    const text = '```md\n![](draw://d1)\n```'
    expect(blocksOf(text)).toEqual([{ kind: 'text', text }])
  })

  it('lifts a lone attachment image only when asked', () => {
    const text = '看\n![截图](attachment://abc.png)\n完'
    expect(blocksOf(text).map(block => block.kind)).toEqual(['text'])
    expect(blocksOf(text, { images: true })).toEqual([
      { kind: 'text', text: '看' },
      { kind: 'image', line: '![截图](attachment://abc.png)', src: 'attachment://abc.png' },
      { kind: 'text', text: '完' },
    ])
  })

  it('leaves an inline pointer and a malformed id as words', () => {
    expect(blocksOf('见 ![](draw://d1) 这里')).toEqual([{ kind: 'text', text: '见 ![](draw://d1) 这里' }])
    expect(blocksOf('![](draw://NOT OK)').map(block => block.kind)).toEqual(['text'])
    expect(drawIdOf('draw://Bad')).toBeUndefined()
    expect(drawIdOf('draw://d2')).toBe('d2')
  })
})

describe('cardBlocksOf', () => {
  it('flows an unplaced drawing at the end, the legacy one first', () => {
    const blocks = cardBlocksOf('字', { d1: INK, main: INK })
    expect(blocks).toEqual([
      { kind: 'text', text: '字' },
      { kind: 'draw', id: 'main' },
      { kind: 'draw', id: 'd1' },
    ])
  })

  it('drops a pointer to a missing drawing and a second pointer to the same one', () => {
    const blocks = cardBlocksOf('![](draw://d1)\n\n![](draw://gone)\n\n![](draw://d1)', { d1: INK })
    expect(blocks).toEqual([{ kind: 'draw', id: 'd1' }])
  })
})

describe('textOfBlocks', () => {
  it('round-trips a flow', () => {
    const text = '开头\n\n![](draw://d1)\n\n![图](attachment://x.png)\n\n结尾'
    expect(textOfBlocks(blocksOf(text, { images: true }))).toBe(text)
  })

  it('drops empty words', () => {
    expect(textOfBlocks([{ kind: 'text', text: '  \n' }, { kind: 'draw', id: 'd1' }])).toBe(drawLineOf('d1'))
  })
})

describe('freshDrawingId / withoutDrawLines', () => {
  it('picks the first free id', () => {
    expect(freshDrawingId([])).toBe('d1')
    expect(freshDrawingId(['d1', 'main', 'd3'])).toBe('d2')
  })

  it('strips drawing lines, optionally leaving a mark', () => {
    const text = '甲\n\n![](draw://d1)\n\n乙'
    expect(withoutDrawLines(text)).toBe('甲\n\n乙')
    expect(withoutDrawLines(text, '[手绘]')).toBe('甲\n\n[手绘]\n\n乙')
    expect(withoutDrawLines('```\n![](draw://d1)\n```')).toBe('```\n![](draw://d1)\n```')
  })
})
