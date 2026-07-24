// Client du sidecar Ollama (13.1, ADR-0006/0012). Le moteur tourne en local ; on le pilote
// par l'API HTTP sur 127.0.0.1:<port éphémère> (fetch webview, autorisé par la CSP
// connect-src). Aucune requête distante à l'inférence — SEUL `pull` sort (réseau explicite).
// `splitNdjson` est pur et testé ; le reste est natif (invoke + fetch), validé en natif.
import { isTauri } from './tauri'

// Découpe un flux NDJSON : concatène le reliquat précédent + le chunk, renvoie les objets
// des lignes COMPLÈTES et le reste (ligne partielle) à re-préfixer au prochain chunk.
export function splitNdjson(prev: string, chunk: string): { objects: unknown[]; rest: string } {
  const combined = prev + chunk
  const parts = combined.split('\n')
  const rest = parts.pop() ?? ''
  const objects: unknown[] = []
  for (const line of parts) {
    const t = line.trim()
    if (t) objects.push(JSON.parse(t))
  }
  return { objects, rest }
}

function api(port: number, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`, init)
}

// Démarre le sidecar (idempotent côté Rust) et renvoie son port ; null en navigateur.
export async function startOllama(): Promise<number | null> {
  if (!isTauri) return null
  const { invoke } = await import('@tauri-apps/api/core')
  return await invoke<number>('start_ollama')
}

export async function stopOllama(): Promise<void> {
  if (!isTauri) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('stop_ollama')
}

// Attend que `ollama serve` réponde (GET /api/tags 200). Poll borné.
export async function waitReady(port: number, tries = 40, delayMs = 300): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await api(port, '/api/tags')
      if (r.ok) return true
    } catch {
      // pas encore en écoute
    }
    await new Promise((res) => setTimeout(res, delayMs))
  }
  return false
}

export interface OllamaModel {
  name: string
  size: number
}

// Taille lisible (base 1000) : octets → « 397 Mo » / « 2.0 Go ».
export function formatBytes(n: number): string {
  // Virgule décimale : on affiche du français (« 1,9 Go », pas « 1.9 Go »).
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace('.', ',')} Go`
  if (n >= 1e6) return `${Math.round(n / 1e6)} Mo`
  if (n >= 1e3) return `${Math.round(n / 1e3)} Ko`
  return `${n} o`
}

export async function listModels(port: number): Promise<OllamaModel[]> {
  const r = await api(port, '/api/tags')
  if (!r.ok) throw new Error(`tags ${r.status}`)
  const json = (await r.json()) as { models?: OllamaModel[] }
  return json.models ?? []
}

// Complétion single-shot en streaming (/api/generate). Primitive conservée pour les usages
// SANS conversation (ex. « résumer » 14.2, reformuler/corriger 16.x) ; le chat multi-tours
// utilise `chat()` (/api/chat). `onToken` reçoit chaque fragment. Renvoie le texte complet.
// `signal` (AbortController) permet l'annulation : abort coupe le fetch → arrêt quasi-instantané
// côté client ET serveur (Ollama stoppe la génération quand le client se déconnecte). On rend
// alors le texte PARTIEL produit jusque-là (pas d'exception qui remonte).
// `options` = options Ollama (ex. `{ num_ctx }`). Le résumé 14.2 FIXE num_ctx pour empêcher
// la troncature silencieuse À GAUCHE d'un prompt plus long que la fenêtre par défaut du modèle.
export async function generate(
  port: number,
  model: string,
  prompt: string,
  onToken: (t: string) => void,
  signal?: AbortSignal,
  options?: Record<string, unknown>,
): Promise<string> {
  let out = ''
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const r = await api(port, '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: true, options }),
      signal,
    })
    if (!r.ok || !r.body) throw new Error(`generate ${r.status}`)
    reader = r.body.getReader()
    const dec = new TextDecoder()
    let rest = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const parsed = splitNdjson(rest, dec.decode(value, { stream: true }))
      rest = parsed.rest
      for (const o of parsed.objects) {
        const line = o as { response?: string; done?: boolean; error?: string }
        if (line.error) throw new Error(line.error)
        if (line.response) {
          out += line.response
          onToken(line.response)
        }
        if (line.done) return out
      }
    }
    return out
  } catch (e) {
    // Annulation (même pendant la phase de connexion, avant le 1er chunk) → texte partiel.
    if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) return out
    throw e
  } finally {
    reader?.cancel().catch(() => {})
  }
}

// Chat multi-tours (14.1) — /api/chat, messages à rôles (system/user/assistant). Streaming
// NDJSON : chaque ligne porte `message.content` (fragment). Même annulation que `generate`
// (AbortSignal coupe client ET serveur ; texte partiel rendu sans exception). Préféré à
// `generate` pour le dialogue : les rôles évitent la dérive de complétion (faux tours).
export async function chat(
  port: number,
  model: string,
  messages: { role: string; content: string }[],
  onToken: (t: string) => void,
  signal?: AbortSignal,
  options?: Record<string, unknown>,
): Promise<string> {
  let out = ''
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const r = await api(port, '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true, options }),
      signal,
    })
    if (!r.ok || !r.body) throw new Error(`chat ${r.status}`)
    reader = r.body.getReader()
    const dec = new TextDecoder()
    let rest = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const parsed = splitNdjson(rest, dec.decode(value, { stream: true }))
      rest = parsed.rest
      for (const o of parsed.objects) {
        const line = o as { message?: { content?: string }; done?: boolean; error?: string }
        if (line.error) throw new Error(line.error)
        const piece = line.message?.content
        if (piece) {
          out += piece
          onToken(piece)
        }
        if (line.done) return out
      }
    }
    return out
  } catch (e) {
    // Annulation (même pendant la connexion) → texte partiel produit jusque-là.
    if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) return out
    throw e
  } finally {
    reader?.cancel().catch(() => {})
  }
}

// Télécharge un modèle — ACTION RÉSEAU EXPLICITE (seule sortie réseau autorisée, ADR-0006).
// `onProgress` reçoit un pourcentage (0-100). `signal` permet d'annuler le téléchargement.
export async function pull(
  port: number,
  model: string,
  onProgress: (pct: number, completed: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const r = await api(port, '/api/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: true }),
      signal,
    })
    if (!r.ok || !r.body) throw new Error(`pull ${r.status}`)
    reader = r.body.getReader()
    const dec = new TextDecoder()
    let rest = ''
    // Un pull comporte PLUSIEURS couches (blobs), chacune avec son propre `total`. Agréger sur
    // toutes les couches vues (clé = digest) → % global monotone ; sinon la barre repart à 0 %
    // à chaque nouvelle couche et « boucle » (0→100 par blob).
    const layers = new Map<string, { completed: number; total: number }>()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const parsed = splitNdjson(rest, dec.decode(value, { stream: true }))
      rest = parsed.rest
      for (const o of parsed.objects) {
        const line = o as { digest?: string; total?: number; completed?: number; error?: string }
        if (line.error) throw new Error(line.error)
        if (line.digest && line.total) {
          layers.set(line.digest, { completed: line.completed ?? 0, total: line.total })
          let completed = 0
          let total = 0
          for (const l of layers.values()) {
            completed += l.completed
            total += l.total
          }
          // Octets relayés en plus du % : sur un pull multi-Go, « 395 Mo / 935 Mo » distingue
          // une progression réelle d'un blocage (le % seul ne le dit pas).
          if (total > 0) onProgress(Math.round((completed / total) * 100), completed, total)
        }
      }
    }
  } catch (e) {
    // Annulation (même pendant la connexion) → sortie silencieuse, rien à signaler.
    if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) return
    throw e
  } finally {
    reader?.cancel().catch(() => {})
  }
}

// Embeddings (15.2, ADR-0015) — POST /api/embed, non streamé. `input` batché par
// l'appelant (16 : le débit mesuré au spike). Même localhost que le reste : 0 réseau.
// `keep_alive` par défaut d'Ollama (5 min) conservé : le modèle reste chaud pendant
// l'indexation et une session de questions, puis se décharge seul — ne PAS envoyer
// keep_alive:0 par lot (décharge/recharge à chaque batch = débit détruit).
export async function embed(port: number, model: string, input: string[], signal?: AbortSignal): Promise<Float32Array[]> {
  const r = await api(port, '/api/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input }),
    signal,
  })
  if (!r.ok) throw new Error(`embed ${r.status}: ${await r.text().catch(() => '')}`)
  const json = (await r.json()) as { embeddings?: number[][] }
  return (json.embeddings ?? []).map((e) => Float32Array.from(e))
}

// Supprime un modèle local (purge, 13.4). DELETE /api/delete. Requiert le sidecar prêt.
export async function deleteModel(port: number, name: string): Promise<void> {
  const r = await api(port, '/api/delete', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: name }),
  })
  if (!r.ok) throw new Error(`delete ${r.status}`)
}
