import { describe, expect, it } from 'vitest'
import { attachPunctuation, consolidate, mergeTurns, planChunks, repairSeam } from '../src/speech-worker-core.ts'

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

describe('planChunks', () => {
  const seg = (start: number, end: number) => ({ start, end })

  it('keeps short recordings whole', () => {
    expect(planChunks([seg(0, 4), seg(4.5, 9)])).toEqual([{ start: 0, end: 9, gapBefore: 0 }])
  })

  it('cuts at the longest pause that leaves a chunk long enough', () => {
    // pauses after 6 s (0.3 s), 12 s (1.2 s — a sentence end), 18 s (0.4 s); the next speech ends past 25 s
    const speech = [seg(0, 6), seg(6.3, 12), seg(13.2, 18), seg(18.4, 23), seg(23.5, 27)]
    const chunks = planChunks(speech, 25, 8)
    expect(chunks[0]).toEqual({ start: 0, end: 12, gapBefore: 0 })
    expect(chunks[1]!.start).toBe(13.2)
    expect(chunks[1]!.gapBefore).toBeCloseTo(1.2)
  })

  it('never makes a chunk shorter than the minimum to chase a pause', () => {
    // the longest pause comes after 3 s: too short a chunk, so the later one wins
    const speech = [seg(0, 3), seg(5, 14), seg(14.5, 22), seg(22.6, 30)]
    expect(planChunks(speech, 25, 8)[0]!.end).toBe(22)
  })

  it('hands back an over-long single stretch for the caller to split', () => {
    expect(planChunks([seg(0, 40)])).toEqual([{ start: 0, end: 40, gapBefore: 0 }])
  })
})

describe('repairSeam', () => {
  const tok = (text: string) => ({ text, start: 0, end: 0.1 })

  it('removes the invented period and lowers the next capital', () => {
    const prev = [tok(' history'), tok(' another'), tok('.')]
    const next = [tok(' Entity'), tok(' is'), tok(' talking')]
    repairSeam(prev, next)
    expect(prev.map((t) => t.text).join('') + next.map((t) => t.text).join('')).toBe(' history another entity is talking')
  })

  it('handles a period inside the last token, and Chinese', () => {
    const prev = [tok('他'), tok('说。')]
    const next = [tok('我们')]
    repairSeam(prev, next)
    expect(prev[1]!.text).toBe('说')
  })

  it('keeps question marks and the pronoun I', () => {
    const asked = [tok(' right'), tok('?')]
    const next = [tok(' I'), tok("'m")]
    repairSeam(asked, next)
    expect(asked[1]!.text).toBe('?')
    const said = [tok(' so'), tok('.')]
    const me = [tok(" I'm")]
    repairSeam(said, me)
    expect(me[0]!.text).toBe(" I'm")
  })
})
