import { describe, expect, it } from 'vitest'
import { encodeWav, rms } from './wav'

describe('encodeWav', () => {
  it('48 kHz → en-tête WAV 16 kHz mono 16 bits, durée conservée', () => {
    const second = new Float32Array(48_000).map((_, i) => Math.sin((2 * Math.PI * 440 * i) / 48_000) * 0.5)
    const wav = encodeWav(second, 48_000)
    const view = new DataView(wav.buffer)
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe('WAVE')
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(16_000)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(16_000 * 2)
    expect(wav.length).toBe(44 + 16_000 * 2)
  })

  it('écrête au lieu de déborder', () => {
    const wav = encodeWav(new Float32Array([2, -2, 2, -2, 2, -2]), 16_000)
    const view = new DataView(wav.buffer)
    expect(view.getInt16(44, true)).toBe(0x7fff)
    expect(view.getInt16(46, true)).toBe(-0x8000)
  })
})

describe('rms', () => {
  it('silence = 0, signal constant = sa valeur', () => {
    expect(rms(new Float32Array(10))).toBe(0)
    expect(rms(new Float32Array(10).fill(0.5))).toBeCloseTo(0.5)
  })
})
