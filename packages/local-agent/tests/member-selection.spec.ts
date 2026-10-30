/** The member control's selection as an edit form's draft, and back. */
import { describe, expect, it } from 'vitest'
import { draftOf, selectionOf } from '../src/client/member-selection.ts'

describe('member selection draft', () => {
  it('drafts explicit values as-is and following choices as what they resolve to', () => {
    expect(draftOf({ model: { mode: 'value', value: 'gpt-6.1-sol' }, effort: { mode: 'value', value: 'high' } })).toEqual({ model: 'gpt-6.1-sol', effort: 'high' })
    expect(draftOf({ model: { mode: 'default' }, effort: { mode: 'inherit' } }, { model: 'k3.1-pro', effort: 'high' })).toEqual({ model: 'k3.1-pro', effort: 'high' })
    expect(draftOf({ model: { mode: 'default' }, effort: { mode: 'default' } })).toEqual({ model: '', effort: '' })
  })

  it('saves an empty field as follow-the-default and trims values', () => {
    expect(selectionOf({ model: ' gpt-6.1-sol ', effort: '' })).toEqual({ model: { mode: 'value', value: 'gpt-6.1-sol' }, effort: { mode: 'default' } })
  })
})
