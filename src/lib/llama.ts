// Client du moteur IA local llama.cpp (ADR-0032, succède au sidecar Ollama d'ADR-0006/0012). Le
// routeur `llama-server` tourne sur 127.0.0.1:<port éphémère> et parle l'API OpenAI (SSE) ; les
// modèles (catalogue fermé, téléchargement vérifié) sont gérés côté Rust (models.rs). Aucune
// requête distante à l'inférence — seul le téléchargement d'un modèle sort, sur action explicite.
// `splitSse` est pur et testé ; le reste est natif (invoke + fetch), validé en natif.
import { isTauri } from './tauri'

/** Découpe un flux SSE : renvoie les charges `data:` des événements COMPLETS et le reliquat. */
export function splitSse(prev: string, chunk: string): { data: string[]; rest: string } {
  const events = (prev + chunk).replace(/\r\n/g, '\n').split('\n\n')
  const rest = events.pop() ?? ''
  const data: string[] = []
  for (const event of events) {
    const lines = event.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart())
    if (lines.length) data.push(lines.join('\n'))
  }
  return { data, rest }
}

function api(port: number, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`, init)
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

// Démarre le moteur (idempotent côté Rust) et renvoie son port ; null en navigateur.
export async function startEngine(): Promise<number | null> {
  if (!isTauri) return null
  return await invoke<number>('start_engine')
}

// Arrête le moteur (le prochain usage le relance avec la liste de modèles à jour).
export async function stopEngine(): Promise<void> {
  if (isTauri) await invoke('stop_engine')
}

// Attend que le routeur réponde (GET /models 200). Poll borné.
export async function waitReady(port: number, tries = 40, delayMs = 300): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await api(port, '/models')).ok) return true
    } catch {
      // pas encore en écoute
    }
    await new Promise((res) => setTimeout(res, delayMs))
  }
  return false
}

export interface LocalModel {
  name: string
  size: number
  // « voice » = module audio rattaché à LFM3 (ADR-0033), jamais un modèle de chat.
  kind: 'chat' | 'embedding' | 'voice'
}

/** Module audio de LFM3 (mmproj) : transcription et synthèse du mode vocal (ADR-0033). */
export const VOICE_MODULE = 'lfm3-omni-2b-voice'

// Taille lisible (base 1000, virgule française) : octets → « 397 Mo » / « 1,9 Go ».
export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace('.', ',')} Go`
  if (n >= 1e6) return `${Math.round(n / 1e6)} Mo`
  if (n >= 1e3) return `${Math.round(n / 1e3)} Ko`
  return `${n} o`
}

/** Modèles du catalogue présents sur le disque (aucun besoin que le moteur tourne). */
export async function listModels(): Promise<LocalModel[]> {
  return isTauri ? await invoke<LocalModel[]>('local_models') : []
}

type Message = { role: string; content: string }

// Chat multi-tours en flux (SSE `/v1/chat/completions`). `onToken` reçoit chaque fragment ; rend
// le texte complet. L'annulation (`signal`) coupe client ET serveur et rend le texte PARTIEL,
// sans exception. La fenêtre de contexte est fixée par modèle dans le preset (models.rs).
export async function chat(
  port: number,
  model: string,
  messages: Message[],
  onToken: (t: string) => void,
  signal?: AbortSignal,
  options?: { temperature?: number },
): Promise<string> {
  let out = ''
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const r = await api(port, '/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true, ...options }),
      signal,
    })
    if (!r.ok || !r.body) throw new Error(`chat ${r.status}: ${await r.text().catch(() => '')}`)
    reader = r.body.getReader()
    const dec = new TextDecoder()
    let rest = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const parsed = splitSse(rest, dec.decode(value, { stream: true }))
      rest = parsed.rest
      for (const data of parsed.data) {
        if (data === '[DONE]') return out
        const event = JSON.parse(data) as { choices?: { delta?: { content?: string } }[]; error?: { message?: string } }
        if (event.error) throw new Error(event.error.message ?? 'erreur du moteur')
        const piece = event.choices?.[0]?.delta?.content
        if (piece) {
          out += piece
          onToken(piece)
        }
      }
    }
    return out
  } catch (e) {
    if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) return out
    throw e
  } finally {
    reader?.cancel().catch(() => {})
  }
}

// Complétion d'une consigne unique (résumé, reformuler, corriger…) : un tour utilisateur.
export function generate(
  port: number,
  model: string,
  prompt: string,
  onToken: (t: string) => void,
  signal?: AbortSignal,
  options?: { temperature?: number },
): Promise<string> {
  return chat(port, model, [{ role: 'user', content: prompt }], onToken, signal, options)
}

// Télécharge un modèle du catalogue — ACTION RÉSEAU EXPLICITE. Rend `false` si annulé.
export async function downloadModel(id: string, onProgress: (pct: number, done: number, total: number) => void): Promise<boolean> {
  const { listen } = await import('@tauri-apps/api/event')
  const unlisten = await listen<{ id: string; done: number; total: number }>('model-download', ({ payload }) => {
    if (payload.id === id && payload.total > 0) onProgress(Math.round((payload.done / payload.total) * 100), payload.done, payload.total)
  })
  try {
    return await invoke<boolean>('download_model', { id })
  } finally {
    unlisten()
  }
}

export async function cancelDownload(): Promise<void> {
  if (isTauri) await invoke('cancel_model_download')
}

// Supprime un modèle local (le moteur est arrêté côté Rust avant l'effacement).
export async function deleteModel(id: string): Promise<void> {
  await invoke('delete_model', { id })
}

// Embeddings (15.2, ADR-0015) — `/v1/embeddings`, non streamé, `input` batché par l'appelant.
export async function embed(port: number, model: string, input: string[], signal?: AbortSignal): Promise<Float32Array[]> {
  const r = await api(port, '/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input }),
    signal,
  })
  if (!r.ok) throw new Error(`embed ${r.status}: ${await r.text().catch(() => '')}`)
  const json = (await r.json()) as { data?: { index: number; embedding: number[] }[] }
  return (json.data ?? []).sort((a, b) => a.index - b.index).map((d) => Float32Array.from(d.embedding))
}

// Transcription (mode vocal, ADR-0033) : WAV 16 kHz mono → texte. Le modèle doit être chargé
// avec son module audio (preset : `mmproj`), sinon le serveur répond une erreur explicite.
export async function transcribe(port: number, model: string, wav: Uint8Array, signal?: AbortSignal): Promise<string> {
  const form = new FormData()
  form.append('file', new Blob([wav as BlobPart], { type: 'audio/wav' }), 'question.wav')
  form.append('model', model)
  form.append('language', 'fr')
  const r = await api(port, '/v1/audio/transcriptions', { method: 'POST', body: form, signal })
  if (!r.ok) throw new Error(`transcription ${r.status}: ${await r.text().catch(() => '')}`)
  return (((await r.json()) as { text?: string }).text ?? '').trim()
}

// Synthèse vocale d'UNE phrase (déjà verbalisée : nombres en lettres, voice-text.ts) → WAV 24 kHz.
export async function synthesize(port: number, model: string, text: string, signal?: AbortSignal, voice: 'female' | 'male' = 'female'): Promise<ArrayBuffer> {
  const r = await api(port, '/v1/audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: text, voice, response_format: 'wav', lang: 'fr' }),
    signal,
  })
  if (!r.ok) throw new Error(`synthèse ${r.status}: ${await r.text().catch(() => '')}`)
  return r.arrayBuffer()
}
