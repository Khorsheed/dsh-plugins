/** The named-question registry: one place for wording, thresholds and ids. */
import { describe, expect, it } from 'vitest'
import { isQuestionId, QUESTION_IDS, QUESTION_REGISTRY, questionSpec, thresholdOf } from '../src/questions.ts'

describe('question registry', () => {
  it('lists every registered id exactly once', () => {
    expect([...QUESTION_IDS].sort()).toEqual(Object.keys(QUESTION_REGISTRY).sort())
    expect(new Set(QUESTION_IDS).size).toBe(QUESTION_IDS.length)
  })

  it('projects a registry entry onto a wire spec', () => {
    const spec = questionSpec('NEEDS_REPLY')
    expect(spec).toMatchObject({ id: 'NEEDS_REPLY', type: 'noul' })
    expect(spec.criteria).toBeUndefined()
    expect(typeof spec.instructions).toBe('string')
    expect(String(spec.instructions).length).toBeGreaterThan(40)
  })

  it('carries a threshold for every gate question', () => {
    for (const id of QUESTION_IDS) {
      expect(typeof thresholdOf(id)).toBe('number')
      expect(QUESTION_REGISTRY[id].note.length).toBeGreaterThan(10)
    }
  })

  it('guards ids', () => {
    expect(isQuestionId('NEEDS_REPLY')).toBe(true)
    expect(isQuestionId('SHOULD_START_WORK')).toBe(true)
    expect(isQuestionId('needs_reply')).toBe(false)
    expect(isQuestionId('constructor')).toBe(false)
  })
})
