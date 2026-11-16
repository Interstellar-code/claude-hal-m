// Sound effects for live map events (recall, save, update, forget), made with the Web Audio API: no sound files.
// The palette is sci-fi console, not arcade: a tricorder scan for a recall, a phaser beam for a save, a tricorder
// chirp for an update and a disruptor zap for a forget, all with a short space echo.
// Off by default. A browser starts audio only after a click on the page, so the context is made (or resumed) then.

export type SoundKind = 'recall' | 'save' | 'update' | 'forget'

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
}

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
const ECHO_SECONDS = 0.14
const ECHO_FEEDBACK = 0.3
const ECHO_LEVEL = 0.35

export type SoundPlayer = { play: (kind: SoundKind) => void; wake: () => void }

export function createSoundPlayer(make: () => Ctx | null = defaultContext, now: () => number = () => Date.now()): SoundPlayer {
  let ctx: Ctx | null = null
  // The shared output: master → speakers, and master → echo → speakers. Made once with the context.
  let master: GainNode | null = null
  let last = -Infinity
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
      if (t - last < MIN_GAP_MS) return
      const c = context()
      if (c === null || master === null || c.state !== 'running') return
      last = t
      const start = c.currentTime + 0.01
      for (const tone of SOUND_SHAPES[kind]) voice(c, master, tone, start)
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

function voice(c: Ctx, out: AudioNode, tone: Tone, start: number) {
  const a = start + tone.at
  const b = a + tone.dur
  const osc = c.createOscillator()
  osc.type = tone.wave
  osc.frequency.setValueAtTime(tone.from, a)
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, tone.to), b)
  const env = c.createGain()
  env.gain.setValueAtTime(0.0001, a)
  env.gain.exponentialRampToValueAtTime(tone.gain, a + 0.01)
  env.gain.setValueAtTime(tone.gain, Math.max(a + 0.01, b - tone.dur * 0.35))
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
