import { describe, expect, it } from 'vitest'
import { attachPunctuation, consolidate, mergeTurns } from '../src/speech-worker-core.ts'

describe('speaker consolidation', () => {
  it('trims overlaps and drops contained turns', () => {
    expect(mergeTurns([
      { cluster: 0, start: 0, end: 5 },
      { cluster: 1, start: 4, end: 8 },
      { cluster: 2, start: 5, end: 6 },
      { cluster: 1, start: 8.2, end: 9 },
    ])).toEqual([
      { cluster: 0, start: 0, end: 5 },
      { cluster: 1, start: 5, end: 9 },
    ])
  })

  it('merges same-voice clusters and folds fragments into the nearest voice', () => {
    const voice = (x: number, y: number) => new Float32Array([x, y])
    // clusters 0 and 1 are the same person, 2 is another, 3 is a 2 s fragment of 2
    const vec: Record<number, Float32Array> = { 0: voice(1, 0), 1: voice(0.98, 0.1), 2: voice(0, 1), 3: voice(0.1, 0.9) }
    const turns = [
      { cluster: 0, start: 0, end: 20 },
      { cluster: 2, start: 21, end: 40 },
      { cluster: 1, start: 41, end: 60 },
      { cluster: 3, start: 61, end: 63 },
    ]
    const embed = (list: typeof turns, c: number) => (list.some((t) => t.cluster === c) ? vec[c]! : null)
    const out = consolidate(turns, embed)
    expect(new Set(out.map((t) => t.cluster))).toEqual(new Set([0, 2]))
    expect(out.find((t) => t.start === 61)?.cluster).toBe(2)
  })
})

describe('attachPunctuation', () => {
  const tok = (text: string, start: number) => ({ text, start, end: start + 0.2 })

  it('re-inserts punctuation after the token it follows', () => {
    const out = attachPunctuation([tok('大', 0), tok('家', 0.2), tok('好', 0.4), tok('欢', 1), tok('迎', 1.2)], '大家好，欢迎。')
    expect(out.map((t) => t.text).join('')).toBe('大家好，欢迎。')
    expect(out[3]).toEqual({ text: '，', start: 0.6000000000000001, end: 0.6000000000000001 })
  })

  it('matches Latin words across the spacing the tokens and the punctuated text disagree on', () => {
    const tokens = [tok('聊', 0), tok(' lar', 0.2), tok('ge', 0.4), tok(' model', 0.6), tok('是', 0.8)]
    const out = attachPunctuation(tokens, '聊large model，是。')
    expect(out.map((t) => t.text).join('')).toBe('聊 large model，是。')
  })
})
