/**
 * The 题集 tab's layer word (T80b): known layer names become 「只看题面 /
 * 含答案」, and a name outside the word table is shown as written — never
 * classified by guess.
 */
import { describe, expect, it } from 'vitest'
import { layersPhrase } from '../src/client/vocab.ts'

describe('layersPhrase', () => {
  it('the task face alone reads 只看题面', () => {
    expect(layersPhrase(['visible'])).toEqual({ phrase: { key: 'layers.faceOnly' }, unknown: [] })
  })

  it('any answer-bearing layer reads 含答案', () => {
    expect(layersPhrase(['visible', 'grading']).phrase).toEqual({ key: 'layers.withAnswers' })
    expect(layersPhrase(['verify']).phrase).toEqual({ key: 'layers.withAnswers' })
  })

  it('an unknown name next to an answer layer rides after 含答案 instead of hiding', () => {
    expect(layersPhrase(['grading', 'notes'])).toEqual({
      phrase: { key: 'layers.withAnswersPlus', params: { layers: 'notes' } },
      unknown: ['notes'],
    })
  })

  it('an unknown name with no answer layer is undecidable: the raw names are the word', () => {
    expect(layersPhrase(['visible', 'notes'])).toEqual({
      phrase: { key: 'layers.raw', params: { layers: 'visible, notes' } },
      unknown: ['notes'],
    })
  })

  it('no layer at all has its own word', () => {
    expect(layersPhrase([]).phrase).toEqual({ key: 'layers.none' })
  })
})
