// Micro partagé par le mode vocal (ADR-0033) et la dictée (ADR-0034) : capture dans la webview,
// blocs PCM à la fréquence du contexte audio, avec l'énergie de chaque bloc.
//
// Le micro « par défaut » de Windows peut être un périphérique qui ne capte rien (mesuré :
// « Realtek USB2.0 Audio » muet pendant que le micro de la Surface entend). Un micro qui ne livre
// que du silence numérique est remplacé par le suivant, et celui qui entend une voix est retenu.
import { rms } from './wav'

const MIC_KEY = 'doku-voice-mic'
const SILENT_PEAK = 0.001
const SILENT_SWITCH_MS = 1500
// Aucun bloc audio reçu après ce délai : le micro (ou le contexte audio) ne livre rien.
const NO_SIGNAL_MS = 2000
// Un périphérique peut ne jamais répondre à l'ouverture : borné, on passe au suivant.
const OPEN_TIMEOUT_MS = 3000

export interface Mic {
  readonly sampleRate: number
  readonly label: string
  /** Nombre de micros essayés (bascule sur silence comprise). */
  readonly tried: number
  /** Plus haut niveau reçu du micro courant : sous 0,001, il ne livre que du silence. */
  readonly peak: number
  /** Ce micro entend une voix : il sera ouvert en premier la prochaine fois. */
  remember(): void
  close(): void
}

export interface MicHandlers {
  onBlock(block: Float32Array, energy: number): void
  /** Bascule vers un autre micro : le bruit de fond appris ne vaut plus. */
  onSwitch?(): void
  /** Le micro ne livre aucun bloc : message prêt à afficher. */
  onDead(message: string): void
}

// Un seul propriétaire du micro à la fois (mode vocal OU dictée) : le nouveau ferme l'ancien.
let owner: (() => void) | null = null

export function claimMic(release: () => void): void {
  const previous = owner
  owner = release
  if (previous && previous !== release) previous()
}

export function releaseMic(release: () => void): void {
  if (owner === release) owner = null
}

export function micError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Accès au micro refusé. Autorisez le micro pour Doku dans les paramètres de Windows.'
  if (name === 'NotFoundError') return 'Aucun micro détecté.'
  return `Micro indisponible : ${error instanceof Error ? error.message : String(error)}`
}

/** Phrase d'erreur quand rien n'est venu du micro pendant toute une écoute. */
export function silentMicMessage(mic: Mic): string {
  return `Aucun micro ne renvoie de son (${mic.tried} essayé${mic.tried > 1 ? 's' : ''}, dernier : « ${mic.label} ») : vérifiez qu'ils ne sont pas coupés dans les paramètres son de Windows.`
}

function rememberedMic(): string | null {
  try {
    return localStorage.getItem(MIC_KEY)
  } catch {
    return null
  }
}

function request(deviceId?: string | null): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { deviceId: deviceId ? { exact: deviceId } : undefined, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
}

const stop = (stream: MediaStream) => stream.getTracks().forEach((t) => t.stop())

/**
 * Ouvre le micro retenu (sinon celui par défaut) sur `ctx`. `ctx` doit avoir été créé dans le
 * geste de l'utilisateur : créé après des await, WebView2 le laisse suspendu, sans échantillons.
 */
export async function openMic(ctx: AudioContext, handlers: MicHandlers): Promise<Mic> {
  const remembered = rememberedMic()
  let current: MediaStream
  try {
    current = await request(remembered).catch((error) => (remembered ? request() : Promise.reject(error)))
  } catch (error) {
    throw new Error(micError(error))
  }
  const first = current.getAudioTracks()[0]
  if (!first || first.readyState !== 'live' || first.muted) {
    stop(current)
    throw new Error(`Le micro ${first?.label ? `« ${first.label} » ` : ''}est coupé ou indisponible.`)
  }
  try {
    await ctx.resume()
  } catch {
    // l'état est vérifié par le chien de garde ci-dessous
  }

  let source: MediaStreamAudioSourceNode | null = null
  let label = ''
  let frames = 0
  let peak = 0
  let since = 0
  let switching = false
  let exhausted = false
  let closed = false
  const tried = new Set<string>()
  // ponytail: ScriptProcessorNode est déprécié mais universel ; un AudioWorklet exigerait un
  // module chargé hors CSP (script-src). À remplacer si le fil principal saccade à l'écoute.
  const processor = ctx.createScriptProcessor(4096, 1, 1)
  // Relié à la sortie pour que le nœud tourne ; il n'écrit rien, donc rien ne s'entend.
  processor.connect(ctx.destination)

  const plug = (next: MediaStream) => {
    source?.disconnect()
    if (next !== current) stop(current)
    current = next
    const track = next.getAudioTracks()[0]
    label = track?.label ?? ''
    tried.add(track?.getSettings().groupId || label)
    source = ctx.createMediaStreamSource(next)
    source.connect(processor)
    frames = 0
    peak = 0
    since = performance.now()
    console.info('[mic]', label, track?.getSettings(), 'contexte', ctx.state, ctx.sampleRate)
  }

  const switchMic = async () => {
    switching = true
    try {
      const next = (await navigator.mediaDevices.enumerateDevices()).find(
        (d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications' && !tried.has(d.groupId || d.label),
      )
      if (!next) {
        exhausted = true
        return
      }
      tried.add(next.groupId || next.label)
      const pending = request(next.deviceId)
      const opened = await Promise.race([pending, new Promise<null>((resolve) => setTimeout(() => resolve(null), OPEN_TIMEOUT_MS))])
      if (!opened) {
        void pending.then(stop, () => {})
        return
      }
      if (closed) return stop(opened)
      console.info('[mic] micro muet, bascule vers', next.label)
      plug(opened)
      handlers.onSwitch?.()
    } catch (error) {
      console.warn('[mic] bascule', error)
    } finally {
      switching = false
    }
  }

  processor.onaudioprocess = (e) => {
    if (closed) return
    const block = new Float32Array(e.inputBuffer.getChannelData(0))
    const energy = rms(block)
    frames++
    peak = Math.max(peak, energy)
    if (!switching && !exhausted && peak < SILENT_PEAK && performance.now() - since > SILENT_SWITCH_MS) void switchMic()
    handlers.onBlock(block, energy)
  }
  plug(current)
  // Jamais muet : un micro qui ne livre aucun bloc se dit, au lieu d'une écoute sans fin.
  setTimeout(() => {
    if (!closed && frames === 0) handlers.onDead(`Le micro ne transmet aucun son (audio ${ctx.state}${label ? `, « ${label} »` : ''}).`)
  }, NO_SIGNAL_MS)

  return {
    sampleRate: ctx.sampleRate,
    get label() { return label },
    get tried() { return tried.size },
    get peak() { return peak },
    remember() {
      // Sauf l'alias « par défaut », qui suit le choix de Windows.
      const id = current.getAudioTracks()[0]?.getSettings().deviceId
      if (!id || id === 'default' || id === 'communications') return
      try {
        localStorage.setItem(MIC_KEY, id)
      } catch {
        // stockage indisponible : on rebasculera la prochaine fois, sans plus
      }
    },
    close() {
      closed = true
      source?.disconnect()
      processor.disconnect()
      stop(current)
    },
  }
}
