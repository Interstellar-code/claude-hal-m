// Sound effects for live map events (recall, save, update, forget), made with the Web Audio API: no sound files.
// One palette, cinematic rather than arcade, built like the monolith's chord: low warm tones that swell in and fade,
// soft airy whooshes (filtered noise sweeping up or down), slow beating between close voices, and a long space echo.
// No square waves or fast buzz. A recall rises like data surfacing, a save settles with a low thrum, an update is a
// soft glassy two-note bell, a forget dissolves downwards; a deep soft thud as an event lands; a crackle over a
// distant rumble for the nebula's lightning; and the monolith's deep swelling chord.
// Off by default. A browser starts audio only after a click on the page, so the context is made (or resumed) then.

export type SoundKind = 'recall' | 'save' | 'update' | 'forget' | 'land' | 'storm' | 'monolith'

type Ctx = AudioContext
/**
 * One voice: an oscillator gliding from `from` to `to` Hz, starting `at` s in, lasting `dur` s. `fm` wobbles its
 * pitch `rate` times a second by `depth` Hz (the buzz of a phaser, the warble of a tricorder); `filter` shapes it.
 */
export type Tone = {
  wave: OscillatorType
  from: number
  to: number
  at: number
  dur: number
  gain: number
  fm?: { rate: number; depth: number }
  /** `sweep`: the filter's frequency glides to this over the voice (a whoosh rising or falling). */
  filter?: { type: BiquadFilterType; freq: number; q: number; sweep?: number }
  /** A burst of white noise instead of a tone (its `wave`, `from` and `to` are not used): the crackle of a spark. */
  noise?: true
  /** Seconds to swell in (default 0.01): a slow attack for the monolith's chord. */
  attack?: number
}

// The monolith: a deep chord of close, slowly beating low voices that swells in and dies away, with a faint high
// shimmer. Our own cluster, in the mood of the film, not its music.
const CHORD = [55, 58.3, 82.4, 87.3, 110, 116.5, 164.8]
const chord: Tone[] = CHORD.map((hz, i) => ({ wave: i % 2 === 0 ? 'sine' : 'triangle', from: hz, to: hz * 0.995, at: i * 0.06, dur: 4.6, gain: 0.5 - i * 0.04, attack: 1.6, fm: { rate: 0.3 + i * 0.11, depth: hz * 0.006 }, filter: { type: 'lowpass', freq: 900, q: 0.5 } }))

// A crackle: short noise snaps around the two strikes of a nebula flash (at 0 s and 0.25 s).
const SNAPS = [0, 0.028, 0.061, 0.095, 0.25, 0.272, 0.31]
const crackle: Tone[] = SNAPS.map((at, i) => ({ wave: 'sine', from: 1, to: 1, at, dur: 0.018 + (i % 3) * 0.012, gain: i === 0 || i === 4 ? 0.55 : 0.3, noise: true, filter: { type: 'bandpass', freq: 2600 + (i % 4) * 600, q: 1.4 } }))

// A whoosh: filtered noise whose band sweeps from `from` to `to` Hz.
const whoosh = (from: number, to: number, at: number, dur: number, gain: number, attack = 0.15): Tone => ({ wave: 'sine', from: 1, to: 1, at, dur, gain, attack, noise: true, filter: { type: 'bandpass', freq: from, q: 2.2, sweep: to } })
// A warm low voice: a sine (or triangle) with a slow beat, softened.
const warm = (from: number, to: number, at: number, dur: number, gain: number, attack: number, wave: OscillatorType = 'sine'): Tone => ({ wave, from, to, at, dur, gain, attack, fm: { rate: 0.6 + (from % 7) * 0.1, depth: from * 0.004 }, filter: { type: 'lowpass', freq: 1400, q: 0.5 } })

export const SOUND_SHAPES: Readonly<Record<SoundKind, readonly Tone[]>> = {
  recall: [
    // Data surfacing: a soft rising fifth over a whoosh sweeping up.
    warm(196, 262, 0, 0.9, 0.5, 0.18),
    warm(294, 392, 0.06, 0.85, 0.3, 0.2, 'triangle'),
    whoosh(500, 3200, 0, 0.8, 0.5, 0.2),
  ],
  save: [
    // Committed: a low thrum settling on an octave, a whoosh falling into it.
    warm(110, 98, 0, 1.1, 0.6, 0.08),
    warm(196, 147, 0.02, 1.0, 0.3, 0.1, 'triangle'),
    whoosh(2600, 400, 0, 0.7, 0.45, 0.1),
  ],
  update: [
    // A soft glassy two-note bell, low and slow to fade.
    warm(392, 392, 0, 0.9, 0.35, 0.02),
    warm(587, 587, 0.14, 1.0, 0.3, 0.02),
    warm(784, 784, 0.14, 0.6, 0.08, 0.02),
  ],
  forget: [
    // Dissolving: a low tone sinking away under a whoosh that falls and thins out.
    warm(147, 73, 0, 1.4, 0.5, 0.06),
    warm(220, 104, 0.05, 1.3, 0.22, 0.08, 'triangle'),
    whoosh(1800, 160, 0, 1.2, 0.5, 0.05),
  ],
  land: [
    // The landing: a deep soft thud with a breath of air.
    { wave: 'sine', from: 82, to: 55, at: 0, dur: 0.6, gain: 0.7, attack: 0.01 },
    whoosh(900, 300, 0, 0.35, 0.18, 0.02),
  ],
  monolith: [
    ...chord,
    { wave: 'sine', from: 1760, to: 1740, at: 0.5, dur: 3.6, gain: 0.06, attack: 1.4, fm: { rate: 4.5, depth: 6 } },
  ],
  storm: [
    // The nebula's lightning: a soft crackle over a distant rolling rumble.
    ...crackle,
    { wave: 'sine', from: 64, to: 40, at: 0.05, dur: 1.6, gain: 0.6, attack: 0.15, fm: { rate: 7, depth: 6 } },
    whoosh(700, 120, 0.05, 1.4, 0.25, 0.2),
  ],
}

// The loudest a sound gets, the shortest gap between two sounds (a burst of events does not become a buzz),
// and the space echo: its delay, how much of it feeds back, and how loud it is.
const VOLUME = 0.08
const MIN_GAP_MS = 110
// The landing tone is quieter and has its own spacing, so a launch never silences a landing.
const LAND_LEVEL = 0.6
// Lightning is quieter still, and at most one crackle every STORM_GAP_MS (many clouds flash).
const STORM_LEVEL = 0.7
const STORM_GAP_MS = 3500
// The monolith's chord: never two at once.
const MONOLITH_GAP_MS = 3000
const ECHO_SECONDS = 0.29
const ECHO_FEEDBACK = 0.38
const ECHO_LEVEL = 0.42

export type SoundPlayer = { play: (kind: SoundKind) => void; wake: () => void }

export function createSoundPlayer(make: () => Ctx | null = defaultContext, now: () => number = () => Date.now()): SoundPlayer {
  let ctx: Ctx | null = null
  // The shared output: master → speakers, and master → echo → speakers. Made once with the context.
  let master: GainNode | null = null
  const lasts: Record<string, number> = {}
  const context = () => {
    if (ctx === null) {
      ctx = make()
      if (ctx !== null) master = wire(ctx)
    }
    return ctx
  }
  return {
    wake() {
      const c = context()
      if (c && c.state === 'suspended') void c.resume().catch(() => {})
    },
    play(kind) {
      const t = now()
      // Launches, landings and lightning each keep their own spacing, so one never silences another.
      const lane = kind === 'land' || kind === 'storm' || kind === 'monolith' ? kind : 'event'
      const gap = lane === 'storm' ? STORM_GAP_MS : lane === 'monolith' ? MONOLITH_GAP_MS : MIN_GAP_MS
      if (t - (lasts[lane] ?? -Infinity) < gap) return
      const c = context()
      if (c === null || master === null || c.state !== 'running') return
      lasts[lane] = t
      const level = kind === 'land' ? LAND_LEVEL : kind === 'storm' ? STORM_LEVEL : 1
      const start = c.currentTime + 0.01
      for (const tone of SOUND_SHAPES[kind]) voice(c, master, level === 1 ? tone : { ...tone, gain: tone.gain * level }, start)
    },
  }
}

function wire(c: Ctx): GainNode {
  const master = c.createGain()
  master.gain.value = VOLUME
  master.connect(c.destination)
  const delay = c.createDelay(1)
  delay.delayTime.value = ECHO_SECONDS
  const feedback = c.createGain()
  feedback.gain.value = ECHO_FEEDBACK
  const wet = c.createGain()
  wet.gain.value = ECHO_LEVEL
  master.connect(delay)
  delay.connect(feedback)
  feedback.connect(delay)
  delay.connect(wet)
  wet.connect(c.destination)
  return master
}

// Two seconds of white noise per audio context, shared by every crackle and whoosh (looped, so none runs out).
const noiseOf = new WeakMap<object, AudioBuffer>()
function noiseBuffer(c: Ctx): AudioBuffer {
  let buffer = noiseOf.get(c)
  if (buffer === undefined) {
    buffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    noiseOf.set(c, buffer)
  }
  return buffer
}

function voice(c: Ctx, out: AudioNode, tone: Tone, start: number) {
  const a = start + tone.at
  const b = a + tone.dur
  if (tone.noise) {
    const src = c.createBufferSource()
    src.buffer = noiseBuffer(c)
    src.loop = true
    const env = c.createGain()
    const rise = tone.attack ?? 0.001
    env.gain.setValueAtTime(0.0001, a)
    env.gain.exponentialRampToValueAtTime(tone.gain, a + rise)
    env.gain.exponentialRampToValueAtTime(0.0001, b)
    src.connect(env)
    const f = c.createBiquadFilter()
    f.type = tone.filter?.type ?? 'bandpass'
    f.frequency.setValueAtTime(tone.filter?.freq ?? 3000, a)
    if (tone.filter?.sweep) f.frequency.exponentialRampToValueAtTime(tone.filter.sweep, b)
    f.Q.value = tone.filter?.q ?? 1
    env.connect(f)
    f.connect(out)
    src.start(a, Math.random() * 0.5)
    src.stop(b + 0.01)
    return
  }
  const osc = c.createOscillator()
  osc.type = tone.wave
  osc.frequency.setValueAtTime(tone.from, a)
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, tone.to), b)
  const env = c.createGain()
  const attack = tone.attack ?? 0.01
  env.gain.setValueAtTime(0.0001, a)
  env.gain.exponentialRampToValueAtTime(tone.gain, a + attack)
  env.gain.setValueAtTime(tone.gain, Math.max(a + attack, b - tone.dur * 0.35))
  env.gain.exponentialRampToValueAtTime(0.0001, b)
  osc.connect(env)
  if (tone.filter) {
    const f = c.createBiquadFilter()
    f.type = tone.filter.type
    f.frequency.setValueAtTime(tone.filter.freq, a)
    if (tone.filter.sweep) f.frequency.exponentialRampToValueAtTime(tone.filter.sweep, b)
    f.Q.value = tone.filter.q
    env.connect(f)
    f.connect(out)
  } else env.connect(out)
  if (tone.fm) {
    const mod = c.createOscillator()
    mod.type = 'sine'
    mod.frequency.value = tone.fm.rate
    const depth = c.createGain()
    depth.gain.value = tone.fm.depth
    mod.connect(depth)
    depth.connect(osc.frequency)
    mod.start(a)
    mod.stop(b + 0.02)
  }
  osc.start(a)
  osc.stop(b + 0.02)
}

function defaultContext(): Ctx | null {
  const g = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
  const Make = g.AudioContext ?? g.webkitAudioContext
  try {
    return Make ? new Make() : null
  } catch {
    return null
  }
}
