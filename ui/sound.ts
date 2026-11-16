// Sound effects for live map events (recall, save, update, forget), made with the Web Audio API: no sound files.
// The palette is sci-fi console, not arcade: a tricorder scan for a recall, a phaser beam for a save, a tricorder
// chirp for an update and a disruptor zap for a forget, all with a short space echo; a soft shimmer as it lands;
// an electric crackle with a low rumble when a nebula cloud's lightning flashes; and a deep swelling chord when
// the monolith (The Human) answers.
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
  filter?: { type: BiquadFilterType; freq: number; q: number }
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
const crackle: Tone[] = SNAPS.map((at, i) => ({ wave: 'sine', from: 1, to: 1, at, dur: 0.018 + (i % 3) * 0.012, gain: i === 0 || i === 4 ? 0.9 : 0.5, noise: true, filter: { type: 'bandpass', freq: 2600 + (i % 4) * 600, q: 1.4 } }))

// A tricorder scan: quick soft beeps hopping between high pitches.
const SCAN = [2100, 2650, 1900, 2950, 2300, 3150, 2700]
const scan: Tone[] = SCAN.map((hz, i) => ({ wave: 'sine', from: hz, to: hz * 1.04, at: i * 0.045, dur: 0.034, gain: 0.55, fm: { rate: 70, depth: 110 }, filter: { type: 'bandpass', freq: 2600, q: 0.9 } }))

export const SOUND_SHAPES: Readonly<Record<SoundKind, readonly Tone[]>> = {
  recall: scan,
  save: [
    // The phaser: a buzzing saw whine with a fast wobble, through a narrow band, sliding down a little.
    { wave: 'sawtooth', from: 1550, to: 1280, at: 0, dur: 0.62, gain: 0.85, fm: { rate: 55, depth: 170 }, filter: { type: 'bandpass', freq: 1700, q: 4 } },
    { wave: 'sine', from: 3100, to: 2650, at: 0, dur: 0.6, gain: 0.22, fm: { rate: 55, depth: 220 } },
  ],
  update: [
    // A tricorder chirp: two soft rising notes with a little warble.
    { wave: 'sine', from: 1750, to: 1900, at: 0, dur: 0.07, gain: 0.55, fm: { rate: 90, depth: 70 }, filter: { type: 'lowpass', freq: 5200, q: 0.7 } },
    { wave: 'sine', from: 2350, to: 2550, at: 0.085, dur: 0.11, gain: 0.55, fm: { rate: 90, depth: 70 }, filter: { type: 'lowpass', freq: 5200, q: 0.7 } },
  ],
  land: [
    // The landing: a soft low shimmer as the event reaches its planet.
    { wave: 'sine', from: 660, to: 520, at: 0, dur: 0.38, gain: 0.45, fm: { rate: 6, depth: 12 } },
    { wave: 'triangle', from: 165, to: 140, at: 0, dur: 0.42, gain: 0.5, filter: { type: 'lowpass', freq: 900, q: 0.7 } },
  ],
  monolith: [
    ...chord,
    { wave: 'sine', from: 1760, to: 1740, at: 0.5, dur: 3.6, gain: 0.06, attack: 1.4, fm: { rate: 4.5, depth: 6 } },
  ],
  storm: [
    // The nebula's lightning: an electric crackle over a low hum and a soft distant rumble.
    ...crackle,
    { wave: 'sawtooth', from: 110, to: 92, at: 0, dur: 0.7, gain: 0.22, fm: { rate: 40, depth: 22 }, filter: { type: 'lowpass', freq: 650, q: 1 } },
    { wave: 'sine', from: 72, to: 38, at: 0.05, dur: 1.1, gain: 0.6, fm: { rate: 9, depth: 8 } },
  ],
  forget: [
    // The disruptor: a deep buzz falling fast through a resonant band, with a low body under it.
    { wave: 'sawtooth', from: 950, to: 70, at: 0, dur: 0.5, gain: 0.8, fm: { rate: 34, depth: 280 }, filter: { type: 'bandpass', freq: 850, q: 6 } },
    { wave: 'sine', from: 320, to: 42, at: 0, dur: 0.5, gain: 0.55 },
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
const ECHO_SECONDS = 0.14
const ECHO_FEEDBACK = 0.3
const ECHO_LEVEL = 0.35

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

// One second of white noise per audio context, shared by every crackle.
const noiseOf = new WeakMap<object, AudioBuffer>()
function noiseBuffer(c: Ctx): AudioBuffer {
  let buffer = noiseOf.get(c)
  if (buffer === undefined) {
    buffer = c.createBuffer(1, c.sampleRate, c.sampleRate)
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
    const env = c.createGain()
    env.gain.setValueAtTime(tone.gain, a)
    env.gain.exponentialRampToValueAtTime(0.0001, b)
    src.connect(env)
    const f = c.createBiquadFilter()
    f.type = tone.filter?.type ?? 'bandpass'
    f.frequency.value = tone.filter?.freq ?? 3000
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
    f.frequency.value = tone.filter.freq
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
