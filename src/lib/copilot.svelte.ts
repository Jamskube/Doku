// État runtime du copilote (13.4, réutilisé par 14.1) — éphémère, `$state` module-level
// (même motif que `app` dans stores.svelte.ts). Le port du sidecar est stable (start_ollama
// idempotent côté Rust) → on le cache ; `ensureReady` déduplique les appels concurrents
// (motif indexBuild de la recherche). Le modèle ACTIF (persisté) vit dans `app.activeModel`.
import { app } from './stores.svelte'
import { deleteModel, listModels, pull, startOllama, waitReady, type OllamaModel } from './ollama'

export const copilot = $state({
  port: null as number | null,
  ready: false,
  loading: false,
  models: [] as OllamaModel[],
  pulling: null as { name: string; pct: number } | null,
  error: '',
})

let readyPromise: Promise<number | null> | null = null
let pullController: AbortController | null = null
let refreshToken = 0

// Démarre le sidecar (idempotent) et renvoie son port ; null en navigateur / échec. Un appel
// en vol est partagé (pas de double démarrage si la vue s'ouvre pendant un pull).
async function ensureReady(): Promise<number | null> {
  if (copilot.port !== null) return copilot.port
  if (readyPromise) return readyPromise
  readyPromise = (async () => {
    copilot.loading = true
    try {
      const p = await startOllama()
      if (p === null) {
        copilot.error = 'Copilote indisponible (mode navigateur — lancer en natif).'
        return null
      }
      if (!(await waitReady(p))) {
        copilot.error = "Le moteur IA n'a pas répondu."
        return null
      }
      copilot.port = p
      copilot.ready = true
      copilot.error = ''
      return p
    } catch (e) {
      // start_ollama (Rust) peut rejeter (binaire absent, spawn échoué) : ne pas laisser
      // remonter un rejet non géré, afficher une erreur claire (sinon la vue montre à tort
      // « aucun modèle » alors que le moteur n'a jamais démarré).
      console.error('[copilot] ensureReady', e)
      copilot.error = "Le moteur IA n'a pas pu démarrer."
      return null
    } finally {
      copilot.loading = false
      readyPromise = null
    }
  })()
  return readyPromise
}

// Rafraîchit la liste des modèles installés. Garde anti-périmé (le dernier appel gagne).
export async function refreshModels(): Promise<void> {
  const p = await ensureReady()
  if (p === null) return
  const token = ++refreshToken
  try {
    const models = await listModels(p)
    if (token === refreshToken) copilot.models = models
  } catch (e) {
    console.error('[copilot] listModels', e)
    if (token === refreshToken) copilot.error = 'Liste des modèles indisponible.'
  }
}

// Télécharge un modèle — ACTION RÉSEAU EXPLICITE, avec progression et annulation. Refuse un
// nom vide ou un 2e téléchargement concurrent.
export async function pullModel(name: string): Promise<void> {
  const model = name.trim()
  if (!model || copilot.pulling) return
  const p = await ensureReady()
  if (p === null) return
  pullController = new AbortController()
  copilot.pulling = { name: model, pct: 0 }
  copilot.error = ''
  try {
    await pull(
      p,
      model,
      (pct) => {
        if (copilot.pulling) copilot.pulling.pct = pct
      },
      pullController.signal,
    )
    await refreshModels()
  } catch (e) {
    console.error('[copilot] pull', e)
    copilot.error = `Échec du téléchargement de ${model}.`
  } finally {
    copilot.pulling = null
    pullController = null
  }
}

export function cancelPull(): void {
  pullController?.abort()
}

// Supprime un modèle local (purge disque). Efface le modèle actif s'il disparaît.
export async function removeModel(name: string): Promise<void> {
  const p = await ensureReady()
  if (p === null) return
  try {
    await deleteModel(p, name)
    if (app.activeModel === name) app.activeModel = ''
    await refreshModels()
  } catch (e) {
    console.error('[copilot] delete', e)
    copilot.error = `Échec de la suppression de ${name}.`
  }
}

export function setActiveModel(name: string): void {
  app.activeModel = name
}
