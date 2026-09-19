/**
 * The shared vocabulary's pure helpers: the ref-label derivation, the ref
 * fold a send performs, and the tolerant document reader the store trusts.
 */
import { describe, expect, it } from 'vitest'
import {
  emptyContextsDoc, foldRefsIntoText, MAX_REF_LABEL_LENGTH, normalizeContextsDoc, refLabelOf,
} from '../src/types.ts'

describe('refLabelOf', () => {
  it('takes the first non-empty line, whitespace-collapsed', () => {
    expect(refLabelOf('\n\n  沉默\n并不总是\t 金的 \n第二行')).toBe('沉默')
    expect(refLabelOf('沉默并不总是\t 金的 \n第二行')).toBe('沉默并不总是 金的')
  })

  it('truncates with an ellipsis at the label cap', () => {
    const long = 'a'.repeat(MAX_REF_LABEL_LENGTH + 20)
    const label = refLabelOf(long)
    expect(label).toHaveLength(MAX_REF_LABEL_LENGTH)
    expect(label.endsWith('…')).toBe(true)
  })

  it('answers the placeholder for an empty body', () => {
    expect(refLabelOf('   \n \n')).toBe('…')
  })
})

describe('foldRefsIntoText', () => {
  it('wraps each ref as a quoted_context block ahead of the user text', () => {
    const folded = foldRefsIntoText([
      { label: '第一条', text: '引用一' },
      { label: '第二条', text: '引用二' },
    ], '怎么看？')
    expect(folded).toBe(
      '<quoted_context label="第一条">\n引用一\n</quoted_context>\n\n'
      + '<quoted_context label="第二条">\n引用二\n</quoted_context>\n\n怎么看？',
    )
  })

  it('passes the text through untouched when no refs ride along', () => {
    expect(foldRefsIntoText([], '就问这个')).toBe('就问这个')
  })

  it('escapes a label through JSON so the block header stays one line', () => {
    const folded = foldRefsIntoText([{ label: '带"引号"', text: 'x' }], 'y')
    expect(folded.startsWith('<quoted_context label="带\\"引号\\"">')).toBe(true)
  })
})

describe('normalizeContextsDoc', () => {
  it('defaults a non-object to the empty document', () => {
    expect(normalizeContextsDoc(undefined)).toEqual(emptyContextsDoc())
    expect(normalizeContextsDoc('junk')).toEqual(emptyContextsDoc())
    expect(normalizeContextsDoc({ contexts: 'no' })).toEqual(emptyContextsDoc())
  })

  it('drops malformed records and malformed refs, keeping the good ones', () => {
    const doc = normalizeContextsDoc({
      version: 1,
      contexts: [
        { contextKey: 'k', label: 'l', refs: [{ label: 'a', text: 'b' }, { label: 1 }], createdAt: 't1', updatedAt: 't2' },
        { label: 'no key' },
        'junk',
        { contextKey: '', label: 'empty key', refs: [], createdAt: 't', updatedAt: 't' },
      ],
    })
    expect(doc.contexts).toEqual([
      { contextKey: 'k', label: 'l', refs: [{ label: 'a', text: 'b' }], createdAt: 't1', updatedAt: 't2' },
    ])
  })

  it('keeps the optional session/segment/preset fields when they are strings', () => {
    const doc = normalizeContextsDoc({
      version: 1,
      contexts: [{ contextKey: 'k', label: 'l', sessionId: 's', segment: 'seg', agentPreset: 'p', refs: [], createdAt: 't', updatedAt: 't' }],
    })
    expect(doc.contexts[0]).toMatchObject({ sessionId: 's', segment: 'seg', agentPreset: 'p' })
  })
})
