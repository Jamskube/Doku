// Fournisseurs cloud compatibles OpenAI (ADR-0018) — miroir d'openai.ts pour le chemin
// « clé API » : statut, connexion (validation AVANT stockage, côté Rust), streaming.
// La clé traverse l'IPC une fois à la connexion puis vit dans le Credential Manager ;
// aucune commande ne la renvoie jamais.
import { isTauri } from './tauri'
import { ThinkScrubber } from './think-scrub'

export type CompatProvider = 'minimax'

export const MINIMAX_DEFAULT_MODEL = 'MiniMax-M2.5'

export interface CompatStatus {
  keyPresent: boolean
  connected: boolean
  keyRejected: boolean
  models: string[]
  error?: string
}

export interface CompatMessage {
  // 'developer' (rôle Codex) est accepté en entrée et REMAPPÉ en 'system' à l'envoi :
  // les surfaces compatibles OpenAI classiques ne le connaissent pas.
  role: 'system' | 'developer' | 'user' | 'assistant'
  content: string
}

interface CompatStreamEvent {
  // 'thinking' : premier delta de raisonnement (M-series) — signal sans texte, une fois.
  kind: 'delta' | 'thinking' | 'done' | 'error'
  text?: string
}

const OFFLINE_STATUS: CompatStatus = {
  keyPresent: false,
  connected: false,
  keyRejected: false,
  models: [],
}

function nativeOnly(): Error {
  return new Error('Les fournisseurs cloud sont disponibles uniquement dans l’application native.')
}

export async function getCompatStatus(provider: CompatProvider): Promise<CompatStatus> {
  if (!isTauri) return OFFLINE_STATUS
  const { invoke } = await import('@tauri-apps/api/core')
  return await invoke<CompatStatus>('compat_status', { providerId: provider })
}

export async function setCompatKey(provider: CompatProvider, key: string): Promise<CompatStatus> {
  if (!isTauri) throw nativeOnly()
  const { invoke } = await import('@tauri-apps/api/core')
  return await invoke<CompatStatus>('compat_set_key', { providerId: provider, key })
}

export async function disconnectCompat(provider: CompatProvider): Promise<void> {
  if (!isTauri) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('compat_disconnect', { providerId: provider })
}

export async function compatChat(
  provider: CompatProvider,
  model: string,
  messages: CompatMessage[],
  onToken: (token: string) => void,
  signal?: AbortSignal,
  onThinking?: () => void,
): Promise<string> {
  if (!isTauri) throw nativeOnly()
  const { Channel, invoke } = await import('@tauri-apps/api/core')
  const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
  const onEvent = new Channel<CompatStreamEvent>()
  // Un scrubber PAR REQUÊTE (un état module fuirait entre les retries et les tours).
  // Tokens ET valeur de retour sont scrubés : les consommateurs du retour (résumé
  // map-reduce, reformulation, notes) ne doivent jamais recevoir le monologue interne.
  const scrubber = new ThinkScrubber()
  let output = ''
  let streamError = ''

  onEvent.onmessage = (event) => {
    if (event.kind === 'delta' && event.text) {
      const visible = scrubber.push(event.text)
      if (visible) {
        output += visible
        onToken(visible)
      }
    } else if (event.kind === 'thinking') {
      onThinking?.()
    } else if (event.kind === 'error') {
      streamError = event.text || 'La génération a échoué.'
    }
  }

  const cancel = () => void invoke('cancel_compat', { requestId }).catch(() => {})
  if (signal?.aborted) return output
  signal?.addEventListener('abort', cancel, { once: true })
  const payload = messages.map((m) => (m.role === 'developer' ? { role: 'system', content: m.content } : m))
  try {
    await invoke('stream_compat', {
      request: { requestId, provider, model, messages: payload },
      onEvent,
    })
    if (streamError && !signal?.aborted) throw new Error(streamError)
    const rest = scrubber.flush()
    if (rest) {
      output += rest
      onToken(rest)
    }
    // Aucun texte visible sur un flux ACHEVÉ sans annulation — que le modèle n'ait
    // produit que du raisonnement (bloc jamais fermé, ou tout parti dans
    // reasoning_content ignoré) ou rien du tout : échec franc. Sans lui, l'appelant
    // prendrait la réponse vide pour une annulation et supprimerait silencieusement
    // le tour (question comprise).
    if (!signal?.aborted && output === '') {
      throw new Error('Le modèle n’a renvoyé aucun texte de réponse. Réessayez.')
    }
    return output
  } catch (error) {
    if (signal?.aborted) return output
    throw error
  } finally {
    signal?.removeEventListener('abort', cancel)
  }
}

export function compatGenerate(
  provider: CompatProvider,
  model: string,
  prompt: string,
  onToken: (token: string) => void,
  signal?: AbortSignal,
  onThinking?: () => void,
): Promise<string> {
  return compatChat(provider, model, [{ role: 'user', content: prompt }], onToken, signal, onThinking)
}
