// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createSoundPlayer, type AudioContextCtor, type WhalesongSoundPlayer } from '../src/client/sound.ts'

/** Recorded oscillator invocation (glide: from → to over startAt → stopAt). */
interface NoteRecord {
  from: number
  to: number
  type: OscillatorType
  startAt: number
  stopAt: number
}

/** Minimal AudioContext fake: records notes and gain peaks, controllable state. */
class FakeAudioContext {
  state: AudioContextState = 'running'
  readonly currentTime = 1
  readonly destination = {}
  readonly notes: NoteRecord[] = []
  readonly gainPeaks: number[] = []
  closed = false

  createOscillator(): OscillatorNode {
    const notes = this.notes
    const record: NoteRecord = { from: 0, to: 0, type: 'sine', startAt: 0, stopAt: 0 }
    return {
      get type() { return record.type },
      set type(value: OscillatorType) { record.type = value },
      frequency: {
        setValueAtTime: (value: number) => { record.from = value },
        exponentialRampToValueAtTime: (value: number) => { record.to = value },
      },
      connect: () => ({}),
      start: (at: number) => { record.startAt = at },
      stop: (at: number) => {
        record.stopAt = at
        notes.push(record)
      },
    } as unknown as OscillatorNode
  }

  createGain(): GainNode {
    const gainPeaks = this.gainPeaks
    return {
      gain: {
        setValueAtTime: (value: number) => { gainPeaks.push(value) },
        exponentialRampToValueAtTime: () => {},
      },
      connect: () => ({}),
    } as unknown as GainNode
  }

  async resume(): Promise<void> { this.state = 'running' }
  async close(): Promise<void> { this.closed = true; this.state = 'closed' }
}

/** Player plus the contexts its fake constructor mints. */
function setup(options: { volume?: number; reducedMotion?: () => boolean } = {}): { player: WhalesongSoundPlayer; contexts: FakeAudioContext[] } {
  const contexts: FakeAudioContext[] = []
  const Ctor = class extends FakeAudioContext {
    constructor() {
      super()
      contexts.push(this as FakeAudioContext)
    }
  } as unknown as AudioContextCtor
  return { player: createSoundPlayer(window, { Ctor, ...options }), contexts }
}

function gesture(win: Window): void {
  win.dispatchEvent(new KeyboardEvent('keydown'))
}

describe('createSoundPlayer', () => {
  let player: WhalesongSoundPlayer | undefined

  afterEach(() => {
    player?.dispose()
    player = undefined
  })

  it('drops chimes that arrive before the first user gesture', () => {
    const setup_ = setup()
    player = setup_.player
    expect(setup_.contexts).toHaveLength(0)
    player.play('completed')
    expect(setup_.contexts).toHaveLength(0) // nothing created, nothing queued
    expect(player.unlocked).toBe(false)
  })

  it('unlocks the AudioContext on the first pointerdown/keydown', () => {
    const setup_ = setup()
    player = setup_.player
    gesture(window)
    expect(setup_.contexts).toHaveLength(1)
    expect(player.unlocked).toBe(true)
    // unlock listeners are one-shot: further gestures create nothing new
    gesture(window)
    expect(setup_.contexts).toHaveLength(1)
  })

  it('resumes a suspended context on the next gesture', () => {
    const setup_ = setup()
    player = setup_.player
    gesture(window)
    setup_.contexts[0].state = 'suspended'
    expect(player.unlocked).toBe(false)
    gesture(window)
    expect(setup_.contexts[0].state).toBe('running')
    expect(player.unlocked).toBe(true)
  })

  it('plays the completed chime as a bubble triple: three rising sine glides', () => {
    const setup_ = setup()
    player = setup_.player
    gesture(window)
    player.play('completed')
    const context = setup_.contexts[0]!
    expect(context.notes).toHaveLength(3)
    const first = context.notes[0]!
    const second = context.notes[1]!
    const third = context.notes[2]!
    expect(first.from).toBeCloseTo(380)
    expect(first.to).toBeCloseTo(520)
    expect(first.stopAt - first.startAt).toBeCloseTo(0.09, 5)
    expect(second.from).toBeCloseTo(520)
    expect(second.to).toBeCloseTo(700)
    expect(second.startAt - first.startAt).toBeCloseTo(0.1, 5)
    expect(second.stopAt - second.startAt).toBeCloseTo(0.09, 5)
    expect(third.from).toBeCloseTo(700)
    expect(third.to).toBeCloseTo(990)
    expect(third.startAt - first.startAt).toBeCloseTo(0.2, 5)
    expect(third.stopAt - third.startAt).toBeCloseTo(0.14, 5)
    for (const note of context.notes) {
      expect(note.type).toBe('sine')
      expect(note.to).toBeGreaterThan(note.from) // every bubble rises
    }
    expect(context.gainPeaks).toEqual([0.1, 0.1, 0.1])
    expect(third.stopAt - first.startAt).toBeLessThan(0.5)
  })

  it('plays the blocked chime as two questioning sine glides (440 → 660), distinct from completed', () => {
    const setup_ = setup()
    player = setup_.player
    gesture(window)
    player.play('blocked')
    const notes = setup_.contexts[0]!.notes
    expect(notes).toHaveLength(2)
    for (const note of notes) {
      expect(note.from).toBeCloseTo(440)
      expect(note.to).toBeCloseTo(660)
      expect(note.type).toBe('sine')
      expect(note.stopAt - note.startAt).toBeCloseTo(0.16, 5)
    }
    expect(notes[1]!.startAt - notes[0]!.startAt).toBeCloseTo(0.22, 5)
  })

  it('drops chimes while the context is suspended', () => {
    const setup_ = setup()
    player = setup_.player
    gesture(window)
    setup_.contexts[0]!.state = 'suspended'
    expect(player.unlocked).toBe(false)
    player.play('completed')
    expect(setup_.contexts[0]!.notes).toHaveLength(0)
  })

  it('dispose closes the context and stops listening for gestures', () => {
    const setup_ = setup()
    player = setup_.player
    gesture(window)
    player.dispose()
    expect(setup_.contexts[0]!.closed).toBe(true)
    gesture(window)
    expect(setup_.contexts).toHaveLength(1)
    player = undefined
  })

  it('does not close an already-closed context on dispose', () => {
    const setup_ = setup()
    player = setup_.player
    gesture(window)
    setup_.contexts[0]!.state = 'closed'
    player.dispose()
    expect(setup_.contexts[0]!.closed).toBe(false) // close skipped for a closed context
    player = undefined
  })

  it('stays silent when the platform has no AudioContext constructor', () => {
    player = createSoundPlayer(window, {})
    gesture(window)
    expect(player.unlocked).toBe(false)
    expect(() => player?.play('completed')).not.toThrow()
  })

  it('stays silent and keeps listening when AudioContext construction is denied', () => {
    const Ctor = class {
      constructor() { throw new Error('denied') }
    } as unknown as AudioContextCtor
    player = createSoundPlayer(window, { Ctor })
    gesture(window)
    expect(player.unlocked).toBe(false)
    expect(() => player?.play('completed')).not.toThrow()
    gesture(window) // the catch keeps the unlock listeners: a later gesture retries
    expect(player.unlocked).toBe(false)
  })

  it('maps volume onto the oscillator gain (0.1 × volume), default 1 = v1 loudness', () => {
    const setup_ = setup({ volume: 0.5 })
    player = setup_.player
    gesture(window)
    player.play('completed')
    expect(setup_.contexts[0]!.gainPeaks).toEqual([0.05, 0.05, 0.05])
  })

  it('setVolume retunes subsequent chimes; volume 0 schedules silent notes', () => {
    const setup_ = setup()
    player = setup_.player
    gesture(window)
    player.play('completed')
    expect(setup_.contexts[0]!.gainPeaks).toEqual([0.1, 0.1, 0.1])
    player.setVolume(0.2)
    player.play('completed')
    player.setVolume(0)
    player.play('blocked')
    const notes = setup_.contexts[0]!.notes
    expect(notes).toHaveLength(8) // 3 + 3 + 2: silent, not disabled — notes still scheduled
    // 0.1 × 0.2 is not exact in binary floating point; compare rounded.
    expect(setup_.contexts[0]!.gainPeaks.map(g => Number(g.toFixed(4)))).toEqual([
      0.1, 0.1, 0.1, 0.02, 0.02, 0.02, 0, 0,
    ])
  })

  it('drops chimes under an explicit reduced-motion probe', () => {
    const setup_ = setup({ reducedMotion: () => true })
    player = setup_.player
    gesture(window)
    expect(player.unlocked).toBe(true)
    player.play('completed')
    player.play('blocked')
    expect(setup_.contexts[0]!.notes).toHaveLength(0)
  })

  it('drops chimes under prefers-reduced-motion via the default matchMedia probe', () => {
    const original = window.matchMedia
    const media = { matches: false }
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => media,
    })
    try {
      const setup_ = setup()
      player = setup_.player
      gesture(window)
      player.play('completed')
      expect(setup_.contexts[0]!.notes).toHaveLength(3) // no reduction yet: chimes sound
      media.matches = true
      player.play('blocked')
      expect(setup_.contexts[0]!.notes).toHaveLength(3) // reduced: dropped
    } finally {
      Object.defineProperty(window, 'matchMedia', { configurable: true, value: original })
    }
  })
})
