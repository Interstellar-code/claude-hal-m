import { describe, expect, test } from 'bun:test'
import { createSoundPlayer, SOUND_SHAPES } from '../../ui/sound'
import { initialSolarPage, readSolarPage, saveSolarPage, toggleShow, LINE_TOGGLES } from '../../ui/map-state'

// The oscillators one sound starts: one per tone, and one more for each tone with a pitch wobble.
const oscillators = (kind: keyof typeof SOUND_SHAPES) => SOUND_SHAPES[kind].reduce((n, tone) => n + (tone.fm && !tone.noise ? 2 : 1), 0)

// A stand-in AudioContext that counts the oscillators started.
function fakeContext(state: 'running' | 'suspended' = 'running') {
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} })
  const node = () => ({ connect() {}, gain: param(), frequency: param(), Q: param(), delayTime: param(), type: '' })
  const ctx: any = {
    state,
    currentTime: 0,
    destination: {},
    started: 0,
    resumed: 0,
    resume() {
      ctx.resumed++
      ctx.state = 'running'
      return Promise.resolve()
    },
    createGain: node,
    createBiquadFilter: node,
    createDelay: node,
    sampleRate: 100,
    createBuffer: (_c: number, length: number) => ({ getChannelData: () => new Float32Array(length) }),
    createBufferSource: () => ({ ...node(), buffer: null, start() { ctx.started++ }, stop() {} }),
    createOscillator: () => ({ ...node(), start() { ctx.started++ }, stop() {} }),
  }
  return ctx
}

describe('sound effects', () => {
  test('each kind plays its own tones', () => {
    for (const kind of ['recall', 'save', 'update', 'forget', 'land', 'storm', 'monolith'] as const) {
      const ctx = fakeContext()
      createSoundPlayer(() => ctx, () => 0).play(kind)
      expect(ctx.started).toBe(oscillators(kind))
    }
  })

  test('a burst of events does not stack: one sound per 110 ms', () => {
    const ctx = fakeContext()
    let t = 0
    const player = createSoundPlayer(() => ctx, () => t)
    player.play('recall')
    t = 50
    player.play('recall')
    expect(ctx.started).toBe(oscillators('recall'))
    t = 200
    player.play('recall')
    expect(ctx.started).toBe(2 * oscillators('recall'))
  })

  test('a landing tone is spaced on its own: a launch never silences it', () => {
    const ctx = fakeContext()
    const player = createSoundPlayer(() => ctx, () => 0)
    player.play('save')
    player.play('land')
    expect(ctx.started).toBe(oscillators('save') + oscillators('land'))
  })

  test('lightning crackles at most once every 3.5 s, and never silences an event', () => {
    const ctx = fakeContext()
    let t = 0
    const player = createSoundPlayer(() => ctx, () => t)
    player.play('storm')
    player.play('recall')
    expect(ctx.started).toBe(oscillators('storm') + oscillators('recall'))
    t = 2000
    player.play('storm')
    expect(ctx.started).toBe(oscillators('storm') + oscillators('recall'))
    t = 4000
    player.play('storm')
    expect(ctx.started).toBe(2 * oscillators('storm') + oscillators('recall'))
  })

  test('nothing plays until the page wakes the audio; no audio at all is quiet', () => {
    const ctx = fakeContext('suspended')
    const player = createSoundPlayer(() => ctx, () => 0)
    player.play('save')
    expect(ctx.started).toBe(0)
    player.wake()
    expect(ctx.resumed).toBe(1)
    expect(() => createSoundPlayer(() => null).play('forget')).not.toThrow()
  })

  test('the Sound switch is off by default, sits with Links and Ties, and is remembered', () => {
    expect(initialSolarPage().sound).toBe(false)
    expect(LINE_TOGGLES.map(t => t.key)).toEqual(['bonds', 'ties', 'sound'])
    const store = new Map<string, string>()
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
    saveSolarPage(storage, toggleShow(initialSolarPage(), 'sound'))
    expect(readSolarPage(storage).sound).toBe(true)
  })
})
