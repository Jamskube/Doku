// Découpage de la parole par l'énergie du signal (mode vocal ADR-0033, dictée ADR-0034).
// Le seuil suit le bruit de fond MESURÉ : un seuil fixe rate les micros discrets, et le gain
// automatique change d'une machine à l'autre. Pré-roulement repris de Handy (le début du premier
// mot précède toujours le bloc qui franchit le seuil).

export interface SegmenterOptions {
  /** Silence qui clôt un segment. */
  silenceMs: number
  /** Durée maximale d'un segment : au-delà, il est clos même en pleine parole. */
  maxMs: number
  minRms?: number
  overNoise?: number
  prerollBlocks?: number
  /** Départ mesuré sur la Surface (silence 0,003-0,018, voix 0,03-0,13). */
  initialNoise?: number
}

export type SegmentEvent = 'start' | 'end' | null

export class SpeechSegmenter {
  noiseFloor: number
  speaking = false
  private chunks: Float32Array[] = []
  private preroll: Float32Array[] = []
  private startedAt = 0
  private lastVoiceAt = 0
  private readonly o: Required<SegmenterOptions>

  constructor(options: SegmenterOptions) {
    this.o = { minRms: 0.006, overNoise: 3, prerollBlocks: 3, initialNoise: 0.008, ...options }
    this.noiseFloor = this.o.initialNoise
  }

  /** Avance d'un bloc. 'start' : la parole commence ; 'end' : le segment est prêt (`take`). */
  feed(block: Float32Array, energy: number, now: number): SegmentEvent {
    const threshold = Math.max(this.o.minRms, this.noiseFloor * this.o.overNoise)
    // Le bruit de fond n'apprend que hors parole (sinon la voix relèverait son propre seuil).
    if (!this.speaking && energy < threshold) this.noiseFloor = this.noiseFloor * 0.9 + energy * 0.1
    let event: SegmentEvent = null
    if (energy > threshold) {
      if (!this.speaking) {
        this.speaking = true
        this.startedAt = now
        this.chunks = this.preroll
        this.preroll = []
        event = 'start'
      }
      this.lastVoiceAt = now
    }
    if (this.speaking) this.chunks.push(block)
    else this.preroll = [...this.preroll, block].slice(-this.o.prerollBlocks)
    if (this.speaking && (now - this.lastVoiceAt > this.o.silenceMs || now - this.startedAt > this.o.maxMs)) return 'end'
    return event
  }

  /** Rend la parole accumulée et repart à l'écoute ; le bruit de fond appris est gardé. */
  take(): Float32Array {
    const samples = concatBlocks(this.chunks)
    this.reset()
    return samples
  }

  reset(): void {
    this.chunks = []
    this.preroll = []
    this.speaking = false
  }

  /** Autre micro : on réapprend son bruit de fond. */
  resetNoise(): void {
    this.reset()
    this.noiseFloor = this.o.initialNoise
  }
}

export function concatBlocks(blocks: Float32Array[]): Float32Array {
  const out = new Float32Array(blocks.reduce((n, b) => n + b.length, 0))
  let at = 0
  for (const b of blocks) {
    out.set(b, at)
    at += b.length
  }
  return out
}
