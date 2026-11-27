// Audio du micro → WAV que llama-server sait lire (ADR-0033). `MediaRecorder` ne produit que du
// WebM/Opus, que le serveur refuse : on capture le PCM et on l'encode ici, en 16 kHz mono 16 bits
// (le format attendu par l'encodeur audio de LFM3 ; 4× plus léger que 48 kHz stéréo).

export const ASR_RATE = 16_000

/** Énergie RMS d'un bloc (0 = silence, ~0,3 = voix forte au micro). */
export function rms(samples: Float32Array): number {
  let sum = 0
  for (const s of samples) sum += s * s
  return samples.length ? Math.sqrt(sum / samples.length) : 0
}

/** Rééchantillonne (moyenne par fenêtre : pas de repliement des aigus) puis encode en WAV PCM 16 bits mono. */
export function encodeWav(samples: Float32Array, rate: number, outRate = ASR_RATE): Uint8Array {
  const ratio = rate / outRate
  const n = Math.floor(samples.length / ratio)
  const out = new Uint8Array(44 + n * 2)
  const view = new DataView(out.buffer)
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + n * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, outRate, true)
  view.setUint32(28, outRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) {
    const from = Math.floor(i * ratio)
    const to = Math.max(from + 1, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let j = from; j < to; j++) sum += samples[j]
    const s = Math.max(-1, Math.min(1, sum / (to - from)))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return out
}
