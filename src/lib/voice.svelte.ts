// Mode vocal de Doku-San (ADR-0033) : une conversation parlée, 100 % locale, en boucle.
// écoute (micro + détection de fin de phrase) → transcription (LFM3) → `sendChat` en style oral,
// dans la discussion ACTIVE (document, historique, citations comme à l'écrit) → synthèse phrase
// par phrase → écoute à nouveau. Le moteur n'a qu'un slot : la voix suit le texte, elle ne
// l'accompagne pas ; la phrase n+1 se synthétise pendant la lecture de la phrase n.
import { copilot, ensureCopilotReady, refreshModels, scheduleConversationPersist, sendChat, stopChat } from './copilot.svelte'
import { REFUSAL_PHRASE } from './copilot-service'
import { synthesize, transcribe, VOICE_MODULE } from './llama'
import { activeTab } from './stores.svelte'
import { isNoiseReply, speakableSentences } from './voice-text'
import { claimMic, openMic, releaseMic, silentMicMessage, type Mic } from './mic'
import { SpeechSegmenter } from './speech-segmenter'
import { encodeWav } from './wav'

export type VoicePhase = 'off' | 'listening' | 'transcribing' | 'thinking' | 'speaking'

// La transcription et la synthèse passent toujours par LFM3, quel que soit le fournisseur du chat.
export const VOICE_MODEL = 'lfm3-omni-2b'
const SILENCE_MS = 1200
const MAX_TURN_MS = 30_000
// Personne ne parle : le mode vocal se referme plutôt que de garder le micro ouvert.
const IDLE_MS = 12_000

class VoiceState {
  phase = $state<VoicePhase>('off')
  // Niveau du micro (0-1) pour l'onde de l'îlot ; 0 hors écoute.
  level = $state(0)
  // Dernière question entendue (transcription), affichée pendant la réflexion.
  heard = $state('')
  error = $state('')
  // Le module audio de LFM3 manque : l'interface propose de le télécharger.
  needsModule = $state(false)
}

export const voice = new VoiceState()

let port: number | null = null
let mic: Mic | null = null
let audio: AudioContext | null = null
let playing: AudioBufferSourceNode | null = null
let abort = new AbortController()
// Jeton de course : un tour interrompu ne reprend jamais la main.
let run = 0
const segmenter = new SpeechSegmenter({ silenceMs: SILENCE_MS, maxMs: MAX_TURN_MS })
let listenSince = 0

/** Moteur prêt à entendre (mode vocal, dictée) : LFM3 et son module audio installés, routeur lancé. */
export async function readyVoiceEngine(): Promise<{ port: number } | { error: string; needsModule: boolean }> {
  await refreshModels()
  const names = new Set(copilot.models.map((m) => m.name))
  if (!names.has(VOICE_MODEL) || !names.has(VOICE_MODULE)) {
    return {
      needsModule: true,
      error: names.has(VOICE_MODEL)
        ? 'La voix a besoin du module audio de LFM3 (507 Mo, une seule fois).'
        : 'La voix a besoin de LFM3 et de son module audio.',
    }
  }
  const ready = await ensureCopilotReady()
  return ready === null ? { error: copilot.error || 'Le moteur IA local n’a pas démarré.', needsModule: false } : { port: ready }
}

/** Démarre la conversation vocale. Sans effet si elle tourne déjà. */
export async function startVoice(): Promise<void> {
  // `audio` posé = un démarrage est déjà en vol (double clic pendant les await).
  if (voice.phase !== 'off' || audio) return
  voice.error = ''
  voice.needsModule = false
  voice.heard = ''
  const id = ++run
  // Créé DANS le clic : après les await qui suivent, WebView2 le laisserait suspendu, et un
  // contexte suspendu ne livre aucun échantillon (le micro « autorisé » n'entend alors rien).
  audio = new AudioContext()
  const ctx = audio
  const bail = (message: string) => {
    release()
    voice.error = message
  }
  const engine = await readyVoiceEngine()
  if (id !== run) return release()
  if ('error' in engine) {
    voice.needsModule = engine.needsModule
    return bail(engine.error)
  }
  port = engine.port
  claimMic(stopVoice)
  try {
    mic = await openMic(ctx, {
      onBlock: capture,
      onSwitch: () => {
        segmenter.resetNoise()
        listenSince = performance.now()
      },
      onDead: (message) => fail(new Error(message)),
    })
  } catch (error) {
    return bail(error instanceof Error ? error.message : String(error))
  }
  if (id !== run || audio !== ctx) return release()
  listen()
}

function listen(): void {
  voice.phase = 'listening'
  voice.level = 0
  segmenter.reset()
  listenSince = performance.now()
}

function capture(block: Float32Array, energy: number): void {
  if (voice.phase !== 'listening' || !mic) return
  voice.level = Math.min(1, energy * 12)
  const now = performance.now()
  const event = segmenter.feed(block, energy, now)
  if (event === 'start') mic.remember()
  else if (event === 'end') void endTurn()
  else if (!segmenter.speaking && now - listenSince > IDLE_MS) {
    const message = mic.peak < 0.001 ? silentMicMessage(mic) : 'Je n’ai rien entendu : mode vocal arrêté.'
    stopVoice()
    voice.error = message
  }
}

async function endTurn(): Promise<void> {
  if (!audio || port === null) return
  const id = run
  voice.phase = 'transcribing'
  voice.level = 0
  const samples = segmenter.take()
  try {
    const question = await transcribe(port, VOICE_MODEL, encodeWav(samples, audio.sampleRate), abort.signal)
    if (id !== run) return
    if (!question) return listen()
    voice.heard = question
    await answer(question, id)
  } catch (error) {
    if (id !== run || abort.signal.aborted) return
    fail(error)
  }
}

async function answer(question: string, id: number): Promise<void> {
  if (copilot.generating) throw new Error('Doku-San répond déjà. Attendez la fin de sa réponse.')
  voice.phase = 'thinking'
  const before = copilot.messages.length
  const tab = activeTab()
  const done = sendChat(question, { name: tab?.name ?? null, text: tab?.content ?? '', kind: tab?.kind ?? 'md', path: tab?.path ?? null }, copilot.scope, { voice: true })
  // sendChat pousse question + réponse AVANT son premier await (même contrat que quick-ask).
  const reply = copilot.messages.length > before ? copilot.messages.at(-1) : undefined
  await done
  if (id !== run) return
  if (!reply || reply.role !== 'assistant') throw new Error('Doku-San n’a pas pu prendre la question.')
  if (reply.config || reply.failed) throw new Error(reply.content || 'Doku-San n’a pas pu répondre.')
  if (isNoiseReply(question, reply.content, REFUSAL_PHRASE)) {
    // Du bruit, pas une question : le tour sort de la discussion, rien n'est dit.
    const at = copilot.messages.indexOf(reply)
    if (at > 0) {
      copilot.messages.splice(at - 1, 2)
      scheduleConversationPersist()
    }
    voice.heard = ''
    listen()
    return
  }
  await speak(speakableSentences(reply.content), id)
  if (id === run) listen()
}

async function speak(sentences: string[], id: number): Promise<void> {
  if (!sentences.length || port === null) return
  voice.phase = 'speaking'
  const p = port
  const synth = (text: string) => synthesize(p, VOICE_MODEL, text, abort.signal)
  let next: Promise<ArrayBuffer> | null = synth(sentences[0])
  for (let i = 0; next; i++) {
    const wav = await next
    if (id !== run) return
    next = i + 1 < sentences.length ? synth(sentences[i + 1]) : null
    // Une synthèse en avance qui échoue ne doit pas lever hors de la boucle (rejet non géré).
    next?.catch(() => {})
    await play(wav)
    if (id !== run) return
  }
}

async function play(wav: ArrayBuffer): Promise<void> {
  if (!audio) return
  const buffer = await audio.decodeAudioData(wav)
  const source = audio.createBufferSource()
  source.buffer = buffer
  source.connect(audio.destination)
  playing = source
  await new Promise<void>((resolve) => {
    source.onended = () => resolve()
    source.start()
  })
  if (playing === source) playing = null
}

function fail(error: unknown): void {
  console.error('[voice]', error)
  const message = error instanceof Error ? error.message : String(error)
  stopVoice()
  voice.error = message
}

// Coupe ce qui est en vol (transcription, réponse, synthèse, lecture) sans fermer le micro.
function cancelTurn(): void {
  run++
  abort.abort()
  abort = new AbortController()
  if (voice.phase === 'thinking' && copilot.generating) stopChat()
  try {
    playing?.stop()
  } catch {
    // déjà terminé
  }
  playing = null
}

/** Interrompt Doku-San (réflexion ou parole) et rend la parole à l'utilisateur. */
export function interruptVoice(): void {
  if (voice.phase === 'off' || voice.phase === 'listening') return
  cancelTurn()
  listen()
}

function release(): void {
  mic?.close()
  mic = null
  void audio?.close()
  audio = null
  releaseMic(stopVoice)
}

/** Termine la conversation vocale et libère le micro. */
export function stopVoice(): void {
  if (voice.phase === 'off' && !audio) return
  cancelTurn()
  release()
  voice.phase = 'off'
  voice.level = 0
}
