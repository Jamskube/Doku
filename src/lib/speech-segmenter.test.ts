import { describe, expect, it } from 'vitest'
import { concatBlocks, SpeechSegmenter } from './speech-segmenter'

const BLOCK_MS = 85 // 4096 échantillons à 48 kHz
const block = (v: number) => new Float32Array(4).fill(v)

// Rejoue des niveaux (un par bloc) jusqu'à la fin du premier segment, comme l'appelant qui `take`.
function play(seg: SpeechSegmenter, levels: number[]) {
  const events: [number, string][] = []
  for (const [i, e] of levels.entries()) {
    const ev = seg.feed(block(e), e, i * BLOCK_MS)
    if (ev) events.push([i, ev])
    if (ev === 'end') break
  }
  return events
}

describe('SpeechSegmenter (niveaux mesurés sur la Surface)', () => {
  it('silence de pièce seul : aucun segment', () => {
    const seg = new SpeechSegmenter({ silenceMs: 900, maxMs: 30_000 })
    expect(play(seg, [0.003, 0.008, 0.016, 0.018, 0.01, 0.004, 0.012, 0.009])).toEqual([])
  })

  it('voix puis silence : début, puis fin après le silence, avec le pré-roulement', () => {
    const seg = new SpeechSegmenter({ silenceMs: 900, maxMs: 30_000 })
    const levels = [0.005, 0.006, 0.007, 0.05, 0.09, 0.07, ...Array(12).fill(0.005)]
    const events = play(seg, levels)
    expect(events[0]).toEqual([3, 'start'])
    expect(events[1][1]).toBe('end')
    const samples = seg.take()
    // 3 blocs de pré-roulement + la parole + le silence jusqu'à la fin du segment
    expect(samples.length).toBe((events[1][0] + 1) * 4)
    expect(seg.speaking).toBe(false)
  })

  it('un bruit de fond fort et constant (ventilateur) finit par ne plus compter comme de la voix', () => {
    const seg = new SpeechSegmenter({ silenceMs: 900, maxMs: 30_000, initialNoise: 0.02 })
    expect(play(seg, Array(40).fill(0.03))).toEqual([])
    expect(seg.noiseFloor).toBeGreaterThan(0.02)
  })

  it('parole continue : coupée à la durée maximale', () => {
    const seg = new SpeechSegmenter({ silenceMs: 900, maxMs: 1000 })
    const events = play(seg, Array(20).fill(0.08))
    expect(events[0]).toEqual([0, 'start'])
    expect(events[1]).toEqual([12, 'end'])
  })
})

describe('concatBlocks', () => {
  it('met bout à bout', () => {
    expect([...concatBlocks([new Float32Array([1, 2]), new Float32Array([3])])]).toEqual([1, 2, 3])
  })
})
