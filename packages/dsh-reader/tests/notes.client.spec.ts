// @vitest-environment jsdom
/**
 * The browser half of notes: a selection becomes an excerpt (original text,
 * whichever view it was made in), an excerpt is found again on screen, the
 * snapshot numbers blocks the way the pane does, and the discussion draft
 * carries what the model needs to match it to reader_read.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { ReaderNote } from '../src/notes.ts'
import {
  blockIndexOf, captureSelection, findText, formatNotesDraft, noteRanges, noteTargetForSelection,
  overlaps, paragraphsOf, registerNoteTarget,
} from '../src/client/notes.ts'
import { applyTranslation, buildArticle, setView, type TranslateClasses } from '../src/client/translate.ts'

const classes: TranslateClasses = { unit: 'u', reveal: 'r', line: 'l' } as TranslateClasses

function mount(html: string): HTMLDivElement {
  const article = document.createElement('div')
  article.innerHTML = html
  document.body.append(article)
  return article
}

function select(start: Node, startOffset: number, end: Node, endOffset: number): Selection {
  const selection = window.getSelection()!
  selection.removeAllRanges()
  const range = document.createRange()
  range.setStart(start, startOffset)
  range.setEnd(end, endOffset)
  selection.addRange(range)
  return selection
}

function note(id: string, block: number, quote: string): ReaderNote {
  return { id, anchor: { block, quote }, createdAt: '', updatedAt: '' }
}

afterEach(() => {
  document.body.innerHTML = ''
  window.getSelection()?.removeAllRanges()
})

describe('a selection becomes an excerpt', () => {
  it('records the block, the offset into it, and the collapsed text', () => {
    const article = mount('<p>Intro.</p><p>Attention is   order-blind. It sees sets.</p>')
    const text = article.children[1]!.firstChild!
    const selection = select(text, 0, text, 'Attention is   order-blind.'.length)
    expect(captureSelection(article, null, selection)).toEqual({ block: 1, start: 0, quote: 'Attention is order-blind.' })
  })

  it('ignores a selection outside the article', () => {
    const article = mount('<p>Inside.</p>')
    const outside = document.createElement('p')
    outside.textContent = 'Outside.'
    document.body.append(outside)
    const selection = select(outside.firstChild!, 0, outside.firstChild!, 3)
    expect(captureSelection(article, null, selection)).toBeNull()
  })

  it('stores the original sentences when the selection is in the translation', () => {
    const article = mount('<p>Attention is order-blind. It sees sets.</p>')
    const built = buildArticle(article, classes)!
    const [first] = built.blocks[0]!.segments
    applyTranslation(built, first!, '注意力不看顺序。', 'en→zh')
    setView(built, 'trans', classes)
    const span = first!.span
    const selection = select(span.firstChild!, 0, span.firstChild!, 4)
    expect(captureSelection(article, built, selection)).toEqual({ block: 0, quote: 'Attention is order-blind.', translated: '注意力不' })
  })

  it('maps a node inside a sibling reveal to the block it follows', () => {
    const article = mount('<p>One.</p><div data-reader-reveal="1"><p>orig</p></div><p>Two.</p>')
    expect(blockIndexOf(article, article.children[1]!.firstChild!)).toBe(0)
    expect(blockIndexOf(article, article.children[2]!.firstChild!)).toBe(1)
  })
})

describe('excerpts are found again', () => {
  it('finds text across nodes with whitespace collapsed', () => {
    const article = mount('<p>Rotate the <em>query</em>\n and key.</p>')
    const range = findText(article, 'the query and key')
    expect(range?.toString()).toBe('the query\n and key')
  })

  it('searches the anchored block first and every block after a refetch moved it', () => {
    const article = mount('<p>New intro.</p><p>Alpha.</p><p>Beta.</p>')
    const found = noteRanges(article, null, [note('n1', 1, 'Beta.'), note('n2', 0, 'Gone.')])
    expect(found.get('n1')?.[0]?.toString()).toBe('Beta.')
    expect(found.get('n2')).toEqual([])
  })

  it('lights the whole translated sentence in the translated view', () => {
    const article = mount('<p>Attention is order-blind. It sees sets.</p>')
    const built = buildArticle(article, classes)!
    const [first, second] = built.blocks[0]!.segments
    applyTranslation(built, first!, '注意力不看顺序。', 'en→zh')
    applyTranslation(built, second!, '它看到集合。', 'en→zh')
    setView(built, 'trans', classes)
    const ranges = noteRanges(article, built, [note('n1', 0, 'order-blind.')]).get('n1') ?? []
    expect(ranges.map(range => range.toString().trim())).toEqual(['注意力不看顺序。'])
  })

  it('treats texts that run into each other as overlapping', () => {
    expect(overlaps('It sees whole sets.', 'whole sets. And more')).toBe(true)
    expect(overlaps('Alpha.', 'Beta.')).toBe(false)
  })
})

describe('the snapshot and the draft', () => {
  it('numbers top-level blocks like the pane, from the markup not the screen', () => {
    expect(paragraphsOf('<p>A  b</p><ul><li>x</li><li>y</li></ul><p></p>')).toEqual(['A b', 'xy', ''])
    expect(paragraphsOf('bare text only')).toEqual(['bare text only'])
  })

  it('formats notes as quotes with ¶, id, comment and the article id', () => {
    const draft = formatNotesDraft(
      { entryId: 'e1', title: 'T', source: 'S', link: 'https://x' },
      [{ ...note('n2', 2, 'quoted'), comment: 'line one\nline two' }],
      { heading: count => `notes (${String(count)})`, comment: 'my comment: ', hint: id => `(id ${id})` },
    )
    expect(draft).toBe([
      'notes (1)',
      '',
      '> n2 ¶3「quoted」',
      '> my comment: line one',
      '> line two',
      '',
      '— 《T》 · S',
      'https://x',
      '(id e1)',
    ].join('\n'))
  })

  it('routes the quote menu to the pane that owns the selection', () => {
    const article = mount('<p>Mine.</p>')
    let started = 0
    const dispose = registerNoteTarget({ owns: node => article.contains(node), start: () => { started += 1 } })
    select(article.firstChild!.firstChild!, 0, article.firstChild!.firstChild!, 4)
    noteTargetForSelection()?.start()
    dispose()
    expect(started).toBe(1)
    expect(noteTargetForSelection()).toBeUndefined()
  })
})
