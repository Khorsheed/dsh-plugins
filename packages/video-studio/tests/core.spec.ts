import { describe, expect, it } from 'vitest'
import { alignEnvelopes, envelope } from '../src/core/align.ts'
import { scanTranscript } from '../src/core/scan.ts'
import { DEFAULT_SETTINGS, effectiveSettings, resetProjectSetting, saveAsShowDefault, setProjectSetting } from '../src/core/settings.ts'
import { buildCues, toSrt } from '../src/core/subtitles.ts'
import { keptRanges, outputDuration, removedRanges, toOutputTime, toReferenceTime } from '../src/core/timeline.ts'
import type { Edit, Segment, Speaker } from '../src/core/types.ts'

const edit = (p: Partial<Edit>): Edit => ({ id: 'e', kind: 'cut', start: 0, end: 0, origin: 'user', state: 'applied', group: 'g', ...p })

function tokens(text: string, start: number, step = 0.2) {
  return [...text].map((ch, i) => ({ text: ch, start: start + i * step, end: start + i * step + step * 0.9, kind: 'word' as const }))
}

describe('timeline', () => {
  it('merges cuts and centres shortenings', () => {
    const edits = [
      edit({ start: 10, end: 20 }),
      edit({ start: 15, end: 25 }),
      edit({ kind: 'shorten', start: 40, end: 43, value: 0.6 }),
      edit({ start: 50, end: 60, state: 'proposed' }),
    ]
    expect(removedRanges(100, edits)).toEqual([
      { start: 10, end: 25 },
      { start: 40.3, end: expect.closeTo(42.7, 6) },
    ])
    expect(keptRanges(100, edits).map((r) => [r.start, +r.end.toFixed(3)])).toEqual([
      [0, 10],
      [25, 40.3],
      [expect.closeTo(42.7, 6), 100],
    ])
    expect(outputDuration(100, edits)).toBeCloseTo(100 - 15 - 2.4, 6)
  })

  it('maps reference and output time both ways', () => {
    const removed = removedRanges(100, [edit({ start: 10, end: 20 }), edit({ start: 30, end: 35 })])
    expect(toOutputTime(5, removed)).toBe(5)
    expect(toOutputTime(15, removed)).toBe(10)
    expect(toOutputTime(25, removed)).toBe(15)
    expect(toOutputTime(40, removed)).toBe(25)
    expect(toReferenceTime(25, removed)).toBe(40)
    expect(toReferenceTime(12, removed)).toBe(22)
  })
})

describe('settings layers', () => {
  it('tracks overrides, saves to show and resets', () => {
    const show = { settings: { ...DEFAULT_SETTINGS } }
    const project = { settings: { ...DEFAULT_SETTINGS }, overrides: [] as (keyof typeof DEFAULT_SETTINGS)[], showId: 's' }
    setProjectSetting(project, show.settings, 'subtitleStyle', 'big-center')
    expect(project.overrides).toEqual(['subtitleStyle'])
    const eff = effectiveSettings(project, show.settings, DEFAULT_SETTINGS)
    expect(eff.find((e) => e.key === 'subtitleStyle')).toMatchObject({ source: 'project', value: 'big-center', fallback: 'standard' })
    expect(eff.find((e) => e.key === 'audioLoudness')?.source).toBe('show')
    saveAsShowDefault(project, show, 'subtitleStyle')
    expect(show.settings.subtitleStyle).toBe('big-center')
    expect(project.overrides).toEqual([])
    setProjectSetting(project, show.settings, 'audioLoudness', -14)
    resetProjectSetting(project, show.settings, 'audioLoudness')
    expect(project.settings.audioLoudness).toBe(-16)
    expect(project.overrides).toEqual([])
    // setting back to the fallback value drops the override
    setProjectSetting(project, show.settings, 'pauseKeep', 1)
    setProjectSetting(project, show.settings, 'pauseKeep', 0.6)
    expect(project.overrides).toEqual([])
  })

  it('reports global as the source without a show', () => {
    const project = { settings: { ...DEFAULT_SETTINGS }, overrides: [], showId: null }
    expect(effectiveSettings(project, null, DEFAULT_SETTINGS)[0].source).toBe('global')
  })
})

describe('scan', () => {
  const speakers: Speaker[] = [
    { id: 'a', name: '阿遥', color: '', origin: { kind: 'diarization', cluster: 0 }, speechSec: 0 },
    { id: 'z', name: '老周', color: '', origin: { kind: 'diarization', cluster: 1 }, speechSec: 0 },
  ]
  const settings = { ...DEFAULT_SETTINGS, speakerPauseThreshold: { 老周: 2.5 } }

  it('finds fillers, repeats and per-speaker pauses', () => {
    const seg1: Segment = { id: 's1', speakerId: 'a', start: 0, end: 3, tokens: tokens('嗯所以你搬了', 0) }
    // 老周: "主要是主要是想离近" then a 2.0 s gap (under his 2.5 s threshold) then more
    const zt = [...tokens('主要是主要是想离近', 5), ...tokens('一点', 5 + 9 * 0.2 + 2.0)]
    const seg2: Segment = { id: 's2', speakerId: 'z', start: 5, end: 9, tokens: zt }
    // gaps BETWEEN segments belong to the speaker before them: 阿遥→老周 3.8 s (阿遥 1.2 s → flagged),
    // 老周→阿遥 2.8 s (老周 2.5 s → flagged); 老周's in-turn 2.0 s gap stays under his threshold
    const seg3: Segment = { id: 's3', speakerId: 'a', start: 12, end: 13, tokens: tokens('那你家猫呢', 12) }
    const res = scanTranscript([seg1, seg2, seg3], speakers, settings)
    expect(res.counts.fillers).toBe(1)
    expect(res.counts.repeats).toBe(1)
    expect(res.counts.pauses).toBe(2)
    const rep = res.edits.find((e) => e.reason?.startsWith('说重复'))!
    expect(rep.start).toBeCloseTo(5, 6)
    expect(rep.end).toBeCloseTo(5.6, 6)

    const tight = { ...settings, speakerPauseThreshold: {} }
    const res2 = scanTranscript([seg1, seg2, seg3], speakers, tight)
    expect(res2.counts.pauses).toBe(3)
    expect(res2.edits.filter((e) => e.kind === 'shorten').every((e) => e.value === 0.6)).toBe(true)
  })

  it('treats multi-char fillers as fillers only at a phrase edge', () => {
    const inside: Segment = { id: 's', speakerId: 'a', start: 0, end: 2, tokens: tokens('那个人', 0) }
    expect(scanTranscript([inside], speakers, settings).counts.fillers).toBe(0)
    const edge: Segment = { id: 's', speakerId: 'a', start: 0, end: 2, tokens: [...tokens('那个', 0), ...tokens('其实', 0.8)] }
    expect(scanTranscript([edge], speakers, settings).counts.fillers).toBe(1)
  })

  it('skips ranges already covered by a non-rejected edit', () => {
    const seg: Segment = { id: 's', speakerId: 'a', start: 0, end: 2, tokens: tokens('嗯好', 0) }
    const prior = [edit({ start: 0, end: 0.18 })]
    expect(scanTranscript([seg], speakers, settings, prior).counts.fillers).toBe(0)
    expect(scanTranscript([seg], speakers, settings, [{ ...prior[0], state: 'rejected' }]).counts.fillers).toBe(1)
  })
})

describe('subtitles', () => {
  it('drops removed tokens and maps to output time', () => {
    const seg: Segment = { id: 's', speakerId: 'a', start: 0, end: 4, tokens: [...tokens('嗯', 0), ...tokens('你好', 1), { text: '。', start: 1.4, end: 1.4, kind: 'word' }, ...tokens('再见', 3)] }
    const removed = removedRanges(10, [edit({ start: 0, end: 0.9 })])
    const cues = buildCues([seg], [], removed)
    expect(cues.map((c) => c.text)).toEqual(['你好', '再见'])
    expect(cues[0].start).toBeCloseTo(0.1, 6)
    expect(toSrt(cues)).toContain('00:00:00,100 --> ')
  })
})

describe('text corrections', () => {
  const seg: Segment = { id: 's', speakerId: 'a', start: 0, end: 4, tokens: tokens('门阀和坚顾', 0) }

  it('displayTokens swaps corrected ranges and leaves the rest', async () => {
    const { displayTokens } = await import('../src/core/text.ts')
    expect(displayTokens(seg, []).map((t) => t.text).join('')).toBe('门阀和坚顾')
    const fixes = [edit({ kind: 'text', start: 0, end: 0.38, text: '门法', from: '门阀' })]
    expect(displayTokens(seg, fixes).map((t) => t.text).join('')).toBe('门法和坚顾')
    // proposed or rejected corrections never touch the display
    expect(displayTokens(seg, [{ ...fixes[0], state: 'proposed' }]).map((t) => t.text).join('')).toBe('门阀和坚顾')
    expect(displayTokens(seg, [{ ...fixes[0], state: 'rejected' }]).map((t) => t.text).join('')).toBe('门阀和坚顾')
  })

  it('findOccurrences matches across token boundaries, case-insensitively', async () => {
    const { findOccurrences } = await import('../src/core/text.ts')
    const seg2: Segment = { id: 's2', speakerId: 'a', start: 5, end: 9, tokens: tokens('又说门阀了', 5) }
    const hits = findOccurrences([seg, seg2], [], '门阀')
    expect(hits.map((h) => [h.segmentId, h.start])).toEqual([['s', 0], ['s2', 5.4]])
    expect(hits[0]!.end).toBeCloseTo(0.38, 6)
    // matches the corrected text, and an empty needle finds nothing
    const fixes = [edit({ kind: 'text', start: 0, end: 0.38, text: '门法', from: '门阀' })]
    expect(findOccurrences([seg], fixes, '门法')).toHaveLength(1)
    expect(findOccurrences([seg], fixes, '门阀')).toHaveLength(0)
    expect(findOccurrences([seg], [], '  ')).toEqual([])
  })
})

describe('align', () => {
  it('recovers a known offset between two envelopes', () => {
    const rate = 8000
    const ref = new Float32Array(rate * 20)
    let seed = 7
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1
    // bursts of "speech"
    for (let b = 0; b < 30; b++) {
      const at = Math.floor(((b * 0.61) % 1) * (ref.length - rate))
      const len = Math.floor(rate * (0.2 + ((b * 0.37) % 1) * 0.6))
      for (let i = 0; i < len; i++) ref[at + i] += rnd() * 0.5
    }
    // the phone started 0.42 s earlier → content is 0.42 s later in its own timeline
    const shift = Math.round(0.42 * rate)
    const other = new Float32Array(ref.length + shift)
    other.set(ref, shift)
    const res = alignEnvelopes(envelope(ref, rate), envelope(other, rate), 100, 5)
    expect(res.offsetSec).toBeCloseTo(-0.42, 1)
    expect(res.confidence).toBeGreaterThan(0.5)
  })
})

describe('speaker consolidation', () => {
  it('trims overlaps and drops contained turns', async () => {
    const { mergeTurns } = await import('../src/media/speech-worker-core.ts')
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

  it('merges same-voice clusters and folds fragments into the nearest voice', async () => {
    const { consolidate } = await import('../src/media/speech-worker-core.ts')
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

describe('export graph helpers', () => {
  it('snaps ranges to the frame grid and builds a balanced select sum', async () => {
    const { balancedSum, snapToFrames } = await import('../src/media/export.ts')
    expect(balancedSum(['a', 'b', 'c'])).toBe('(a+(b+c))')
    expect(balancedSum([])).toBe('0')
    const snapped = snapToFrames([{ start: 1.01, end: 2.02 }, { start: 3, end: 3.01 }], -0.42, 100)
    expect(snapped).toHaveLength(1)
    expect(snapped[0]!.start * 30).toBeCloseTo(Math.round(snapped[0]!.start * 30), 9)
    expect((snapped[0]!.end - snapped[0]!.start) * 30).toBeCloseTo(Math.round((snapped[0]!.end - snapped[0]!.start) * 30), 9)
  })
})
