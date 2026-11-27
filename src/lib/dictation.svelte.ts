// Dictée de notes (ADR-0034, d'après Handy) : la parole devient du texte au curseur de la note.
// - mains libres : chaque phrase, close par un silence, est transcrite puis écrite ;
// - Espace maintenue : maintenir Espace dans la note enregistre, relâcher écrit.
// Transcription par LFM3 (même moteur que le mode vocal), une à la fois et dans l'ordre.
import { setHoldSpaceHandler } from './editor/hold-space'
import { cleanDictation, joinDictation } from './dictation-text'
import { transcribe } from './llama'
import { claimMic, openMic, releaseMic, silentMicMessage, type Mic } from './mic'
import { SpeechSegmenter, concatBlocks } from './speech-segmenter'
import { activeEditorView, activeTab, app, openCopilot } from './stores.svelte'
import { readyVoiceEngine, VOICE_MODEL } from './voice.svelte'
import { encodeWav } from './wav'

export type DictationMode = 'off' | 'handsfree' | 'hold'

// Un temps de réflexion entre deux idées ne doit pas couper la phrase en deux.
const SILENCE_MS = 900
// Au-delà, le morceau part à la transcription même en pleine parole (le texte arrive au fil).
const MAX_SEGMENT_MS = 20_000
// Pré-roulement de l'Espace maintenue : la parole commence souvent avant la fin du délai d'appui.
const HOLD_PREROLL_BLOCKS = 5
const MIN_SPEECH_S = 0.3
// Mains libres : un micro qui ne livre que du silence numérique se signale.
const SILENT_CHECK_MS = 12_000

class DictationState {
  mode = $state<DictationMode>('off')
  // Le micro s'ouvre (moteur, autorisation) : les boutons attendent.
  starting = $state(false)
  // Parole en cours d'enregistrement (phrase entendue en mains libres, Espace tenue).
  recording = $state(false)
  // Morceaux en attente de transcription.
  pending = $state(0)
  level = $state(0)
}

export const dictation = new DictationState()

let port: number | null = null
let audio: AudioContext | null = null
let mic: Mic | null = null
// Jeton du démarrage en vol : un arrêt pendant l'ouverture du micro l'annule.
let run = 0
let queue: Promise<void> = Promise.resolve()
const segmenter = new SpeechSegmenter({ silenceMs: SILENCE_MS, maxMs: MAX_SEGMENT_MS })
let held: Float32Array[] = []
let preroll: Float32Array[] = []
let heardWhileHeld = false
let since = 0

// Jamais muet : chaque échec passe par l'îlot. Module audio absent → la page Modèles s'ouvre.
function fail(message: string, needsModule = false): void {
  app.banner = { tone: 'error', title: 'Dictée', message }
  if (needsModule) openCopilot('models')
}

export function canDictate(): boolean {
  const kind = activeTab()?.kind
  return (kind === 'md' || kind === 'txt' || kind === 'html') && !!activeEditorView()
}

/** Active un mode (ou change de mode, micro gardé) ; le mode déjà actif s'arrête. */
export async function toggleDictation(mode: Exclude<DictationMode, 'off'>): Promise<void> {
  if (dictation.mode === mode) return stopDictation()
  if (dictation.starting) return
  if (audio) {
    dictation.mode = mode
    resetCapture()
    return
  }
  if (!canDictate()) return fail('La dictée écrit dans une note : ouvrez un document texte (Markdown, txt).')
  const id = ++run
  // Créé DANS le clic (même contrainte WebView2 que le mode vocal).
  const ctx = new AudioContext()
  audio = ctx
  dictation.starting = true
  const bail = (message: string, needsModule = false) => {
    if (id !== run) return
    stopDictation()
    fail(message, needsModule)
  }
  try {
    const engine = await readyVoiceEngine()
    if (id !== run) return
    if ('error' in engine) return bail(engine.error, engine.needsModule)
    port = engine.port
    claimMic(stopDictation)
    const opened = await openMic(ctx, {
      onBlock: capture,
      onSwitch: () => {
        segmenter.resetNoise()
        since = performance.now()
      },
      onDead: (message) => bail(message),
    }).catch((error: unknown) => {
      bail(error instanceof Error ? error.message : String(error))
      return null
    })
    if (!opened) return
    if (id !== run) return opened.close()
    mic = opened
    dictation.mode = mode
    resetCapture()
    activeEditorView()?.focus()
  } finally {
    if (id === run) dictation.starting = false
  }
}

function resetCapture(): void {
  segmenter.reset()
  held = []
  preroll = []
  dictation.recording = false
  dictation.level = 0
  since = performance.now()
}

function capture(block: Float32Array, energy: number): void {
  if (!mic || dictation.mode === 'off') return
  const now = performance.now()
  const event = segmenter.feed(block, energy, now)
  if (event === 'start') mic.remember()
  if (dictation.mode === 'handsfree') {
    dictation.level = Math.min(1, energy * 12)
    if (event === 'start') dictation.recording = true
    else if (event === 'end') {
      dictation.recording = false
      enqueue(segmenter.take())
    } else if (!segmenter.speaking && mic.peak < 0.001 && now - since > SILENT_CHECK_MS) {
      const message = silentMicMessage(mic)
      stopDictation()
      fail(message)
    }
    return
  }
  // Espace maintenue : le segmenteur ne sert qu'à apprendre le bruit et à savoir si l'on a parlé.
  if (event === 'end') segmenter.reset()
  if (dictation.recording) {
    dictation.level = Math.min(1, energy * 12)
    heardWhileHeld ||= segmenter.speaking
    held.push(block)
    if (held.length * block.length > (MAX_SEGMENT_MS / 1000) * mic.sampleRate) flushHeld()
  } else {
    preroll = [...preroll, block].slice(-HOLD_PREROLL_BLOCKS)
  }
}

function flushHeld(): void {
  const samples = concatBlocks(held)
  held = []
  if (heardWhileHeld) enqueue(samples)
  heardWhileHeld = segmenter.speaking
}

// Les morceaux déjà entendus s'écrivent même après l'arrêt : arrêter juste après avoir parlé
// ne perd pas la dernière phrase.
function enqueue(samples: Float32Array): void {
  if (!audio || port === null || samples.length < audio.sampleRate * MIN_SPEECH_S) return
  const p = port
  const wav = encodeWav(samples, audio.sampleRate)
  dictation.pending++
  queue = queue.then(async () => {
    try {
      write(cleanDictation(await transcribe(p, VOICE_MODEL, wav)))
    } catch (error) {
      console.error('[dictation]', error)
      stopDictation()
      fail(`Transcription impossible : ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      dictation.pending--
    }
  })
}

// Écrit au curseur de la note active (l'éditeur est partagé entre onglets : on écrit là où
// l'utilisateur se trouve, comme le ferait le clavier).
function write(text: string): void {
  if (!text) return
  const view = canDictate() ? activeEditorView() : null
  if (!view) {
    stopDictation()
    fail(`Dictée arrêtée : aucune note ouverte pour écrire « ${text} ».`)
    return
  }
  const { from, to } = view.state.selection.main
  const insert = joinDictation(view.state.sliceDoc(Math.max(0, from - 300), from), text)
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true, userEvent: 'input.dictation' })
}

setHoldSpaceHandler({
  enabled: () => dictation.mode === 'hold' && !!mic,
  start() {
    held = [...preroll]
    preroll = []
    heardWhileHeld = segmenter.speaking
    dictation.recording = true
  },
  stop() {
    if (!dictation.recording) return
    dictation.recording = false
    dictation.level = 0
    flushHeld()
  },
})

function release(): void {
  mic?.close()
  mic = null
  void audio?.close()
  audio = null
  releaseMic(stopDictation)
}

/** Arrête la dictée et libère le micro ; ce qui a déjà été dit s'écrit quand même. */
export function stopDictation(): void {
  run++
  if (dictation.mode === 'handsfree' && segmenter.speaking) enqueue(segmenter.take())
  else if (dictation.recording) flushHeld()
  release()
  dictation.mode = 'off'
  dictation.starting = false
  dictation.recording = false
  dictation.level = 0
}
