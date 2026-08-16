/**
 * Whalesong sound: WebAudio oscillator chimes, no audio assets (nothing to bundle
 * or serve). Autoplay policy: the AudioContext is created on the first
 * pointerdown/keydown (capture listeners stay attached until dispose, so a
 * later gesture resumes a context the browser suspended); chimes arriving
 * before the unlock are dropped (v1 keeps no queue). Loudness maps the plugin
 * config's `volume` (0..1) onto the oscillator gain as `0.1 × volume`, so
 * volume 1 reproduces v1's restrained loudness and 0 mutes without disabling.
 * Under `prefers-reduced-motion` every chime is dropped (silence pairs with
 * the hidden animation). Every chime ends well under 0.5s.
 * @module @khorsheed/dsh-whalesong/client/sound
 */

/** Chime kinds: task finished vs. task waiting on the user. */
export type WhalesongSound = 'completed' | 'blocked'

interface ChimeSpec {
  /** Notes in schedule order. */
  readonly notes: readonly NoteSpec[]
  /** Oscillator waveform — both chimes sine (user-picked set D/G, 2026-08-12 listening test). */
  readonly type: OscillatorType
}

/** One gliding note: frequency ramps from → to over `dur` seconds, starting `at` seconds after the chime's t0. */
interface NoteSpec {
  readonly from: number
  readonly to: number
  readonly at: number
  readonly dur: number
}

/**
 * User-picked chimes (v1.3 listening test):
 * - completed = "bubble triple": three rising sine glides (380→520, 520→700, 700→990);
 * - blocked = "questioning chirp": the same 440→660 rise twice.
 */
const CHIMES: Record<WhalesongSound, ChimeSpec> = {
  completed: {
    type: 'sine',
    notes: [
      { from: 380, to: 520, at: 0, dur: 0.09 },
      { from: 520, to: 700, at: 0.1, dur: 0.09 },
      { from: 700, to: 990, at: 0.2, dur: 0.14 },
    ],
  },
  blocked: {
    type: 'sine',
    notes: [
      { from: 440, to: 660, at: 0, dur: 0.16 },
      { from: 440, to: 660, at: 0.22, dur: 0.16 },
    ],
  },
}

/** Peak gain at volume 1 (restrained; v1's fixed loudness). */
const BASE_GAIN = 0.1

/** The AudioContext constructor shape this module needs (real or test fake). */
export type AudioContextCtor = new () => AudioContext

/** Player creation options. */
export interface SoundPlayerOptions {
  /** AudioContext constructor override (tests inject a fake; absent = silent). */
  readonly Ctor?: AudioContextCtor
  /** Initial loudness 0..1 (default 1); gain = 0.1 × volume. */
  readonly volume?: number
  /** Reduced-motion probe (default: matchMedia); true = every chime dropped. */
  readonly reducedMotion?: () => boolean
}

/** Player lifecycle handle. */
export interface WhalesongSoundPlayer {
  /** Whether the AudioContext is unlocked and running (chimes actually sound). */
  readonly unlocked: boolean
  /**
   * Play a chime; silently dropped while the context is locked/suspended,
   * and always dropped under prefers-reduced-motion.
   * @param kind - which chime to play.
   */
  play(kind: WhalesongSound): void
  /** Retune subsequent chimes (hot volume config; 0 = silent, not disabled). */
  setVolume(volume: number): void
  /** Remove the unlock listeners and close the context. */
  dispose(): void
}

/** Default reduced-motion probe; matchMedia is absent in jsdom and non-browser runtimes. */
function defaultReducedMotion(win: Window): () => boolean {
  return () => win.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/** Clamp a config volume into 0..1 and scale to the oscillator gain. */
function gainFor(volume: number): number {
  return BASE_GAIN * Math.min(1, Math.max(0, volume))
}

/**
 * Create the sound player bound to a window's user gestures.
 * @param win - target window (defaults to the global one).
 * @param options - constructor override, initial volume, reduced-motion probe.
 * @returns the player handle.
 */
export function createSoundPlayer(
  win: Window = window,
  options: SoundPlayerOptions = {},
): WhalesongSoundPlayer {
  const Ctor = options.Ctor ?? (win as { AudioContext?: AudioContextCtor }).AudioContext
  const reducedMotion = options.reducedMotion ?? defaultReducedMotion(win)
  let volume = options.volume ?? 1
  let ac: AudioContext | undefined

  const removeUnlockListeners = (): void => {
    win.removeEventListener('pointerdown', unlock, true)
    win.removeEventListener('keydown', unlock, true)
  }

  function unlock(): void {
    if (ac !== undefined) {
      if (ac.state === 'suspended') void ac.resume()
      return
    }
    if (Ctor === undefined) return // no WebAudio on this platform: stay silent
    try {
      ac = new Ctor()
    } catch {
      return // construction denied: stay silent, keep listening for the next gesture
    }
    // Listeners stay attached until dispose: a context the browser suspends
    // (idle autoplay policy) resumes on the next gesture.
  }

  win.addEventListener('pointerdown', unlock, true)
  win.addEventListener('keydown', unlock, true)

  function playNote(context: AudioContext, startAt: number, note: NoteSpec, type: OscillatorType): void {
    const osc = context.createOscillator()
    const gain = context.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(note.from, startAt)
    osc.frequency.exponentialRampToValueAtTime(note.to, startAt + note.dur)
    gain.gain.setValueAtTime(gainFor(volume), startAt)
    gain.gain.exponentialRampToValueAtTime(0.001, startAt + note.dur)
    osc.connect(gain)
    gain.connect(context.destination)
    osc.start(startAt)
    osc.stop(startAt + note.dur)
  }

  return {
    get unlocked() {
      return ac !== undefined && ac.state === 'running'
    },
    play(kind: WhalesongSound) {
      if (ac === undefined || ac.state !== 'running') return
      if (reducedMotion()) return
      const chime = CHIMES[kind]
      const t0 = ac.currentTime
      for (const note of chime.notes) {
        playNote(ac, t0 + note.at, note, chime.type)
      }
    },
    setVolume(next: number) {
      volume = next
    },
    dispose() {
      removeUnlockListeners()
      const context = ac
      ac = undefined
      if (context !== undefined && context.state !== 'closed') void context.close()
    },
  }
}
