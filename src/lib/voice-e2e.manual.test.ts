// Banc manuel (exclu de la CI) : VOICE_E2E_PORT=8131 npx vitest run src/lib/voice-e2e.manual.test.ts
import { appendFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { synthesize, transcribe } from './llama'
import { cleanDictation, joinDictation } from './dictation-text'
import { SpeechSegmenter } from './speech-segmenter'
import { speakableSentences } from './voice-text'
import { rms } from './wav'
import { encodeWav } from './wav'

const port = Number(process.env.VOICE_E2E_PORT)
const log = (s: string) => appendFileSync(process.env.VOICE_E2E_LOG ?? 'voice-e2e.log', `${s}\n`)

function pcm(wav: ArrayBuffer): { samples: Float32Array; rate: number } {
  const v = new DataView(wav)
  let at = 12
  let rate = 0
  while (at < v.byteLength) {
    const id = String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3))
    const size = v.getUint32(at + 4, true)
    if (id === 'fmt ') rate = v.getUint32(at + 12, true)
    if (id === 'data') {
      const n = size / 2
      const samples = new Float32Array(n)
      for (let i = 0; i < n; i++) samples[i] = v.getInt16(at + 8 + i * 2, true) / 0x8000
      return { samples, rate }
    }
    at += 8 + size
  }
  throw new Error('pas de bloc data')
}

describe.skipIf(!port)('voix de bout en bout', () => {
  it('texte → synthèse → WAV 16 kHz → transcription', async () => {
    const [sentence] = speakableSentences('Le rendez-vous est fixé au **14 octobre** à 9 h 30, salle 212 [1].')
    log(`parlé : ${sentence}`)
    let t = performance.now()
    const wav = await synthesize(port, 'lfm3-omni-2b', sentence)
    const { samples, rate } = pcm(wav)
    log(`synthèse : ${Math.round(performance.now() - t)} ms, ${(samples.length / rate).toFixed(1)} s à ${rate} Hz`)
    t = performance.now()
    const heard = await transcribe(port, 'lfm3-omni-2b', encodeWav(samples, rate))
    log(`transcription : ${Math.round(performance.now() - t)} ms → ${heard}`)
    expect(heard.toLowerCase()).toMatch(/octobre/)
    expect(heard).toMatch(/212|deux cent douze/i)
  }, 120_000)

  it('dictée : deux phrases séparées par une pause → segmenteur → transcription → raccord dans la note', async () => {
    const said = ['Acheter du pain et du lait.', 'Appeler Camille demain matin.']
    const parts = await Promise.all(said.map(async (t) => pcm(await synthesize(port, 'lfm3-omni-2b', t))))
    const rate = parts[0].rate
    // Bruit de pièce faible entre les phrases (niveau mesuré sur la Surface ≈ 0,005).
    const room = (sec: number) => Float32Array.from({ length: Math.round(sec * rate) }, () => (Math.random() - 0.5) * 0.015)
    const stream = [room(1), parts[0].samples, room(1.5), parts[1].samples, room(1.5)]
    const all = new Float32Array(stream.reduce((n, p) => n + p.length, 0))
    stream.reduce((at, p) => (all.set(p, at), at + p.length), 0)
    const seg = new SpeechSegmenter({ silenceMs: 900, maxMs: 20_000 })
    const segments: Float32Array[] = []
    for (let at = 0; at + 4096 <= all.length; at += 4096) {
      const block = all.subarray(at, at + 4096)
      if (seg.feed(block, rms(block), (at / rate) * 1000) === 'end') segments.push(seg.take())
    }
    log(`segments : ${segments.map((x) => (x.length / rate).toFixed(1) + ' s').join(', ')}`)
    expect(segments).toHaveLength(2)
    let doc = '# Courses\n- '
    for (const samples of segments) {
      const t = performance.now()
      const raw = await transcribe(port, 'lfm3-omni-2b', encodeWav(samples, rate))
      const text = cleanDictation(raw)
      log(`dictée : ${Math.round(performance.now() - t)} ms, brut « ${raw} » → « ${text} »`)
      doc += joinDictation(doc, text)
    }
    log(`note : ${JSON.stringify(doc)}`)
    // -er / -ez : homophones, la synthèse ne les distingue pas ; on vérifie le raccord.
    expect(doc).toMatch(/^# Courses\n- Achet\S+ du pain/)
    expect(doc).toMatch(/lait\. Appel\S+ Camille/)
  }, 180_000)
})

