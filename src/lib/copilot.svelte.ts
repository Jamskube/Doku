// État runtime du copilote (13.4, réutilisé par 14.1) — éphémère, `$state` module-level
// (même motif que `app` dans stores.svelte.ts). Le port du sidecar est stable (start_ollama
// idempotent côté Rust) → on le cache ; `ensureReady` déduplique les appels concurrents
// (motif indexBuild de la recherche). Le modèle ACTIF (persisté) vit dans `app.activeModel`.
import { app, type DocKind } from './stores.svelte'
import { chat, deleteModel, listModels, pull, startOllama, waitReady, type OllamaModel } from './ollama'
import { buildChatMessages, type ChatTurn } from './copilot-service'

// Un tour de conversation (14.1). `streaming` = réponse en cours (bulle en texte brut,
// rendu Markdown à la fin) ; `failed` = carte d'erreur. Conversation éphémère (non persistée).
export interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  failed?: boolean
}

export const copilot = $state({
  port: null as number | null,
  ready: false,
  loading: false,
  models: [] as OllamaModel[],
  pulling: null as { name: string; pct: number } | null,
  error: '',
  messages: [] as ChatMsg[],
  generating: false,
})

let readyPromise: Promise<number | null> | null = null
let pullController: AbortController | null = null
let genController: AbortController | null = null
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

// Envoie un message au copilote et streame la réponse (14.1). `doc` = SNAPSHOT du document
// courant capturé À L'ENVOI → un changement d'onglet pendant la génération ne la perturbe pas.
// Anti-TOCTOU : `generating`/`genController` posés SYNCHRONEMENT avant tout `await` (deux
// envois rapprochés ne peuvent pas s'entrelacer). Aucun spawn moteur si pas de modèle actif.
export async function sendChat(
  question: string,
  doc: { name: string | null; text: string; kind: DocKind },
): Promise<void> {
  const q = question.trim()
  if (!q || copilot.generating) return

  // Garde modèle : carte d'erreur sans démarrer le sidecar (préserve le boot-safety 14.0).
  if (!app.activeModel) {
    copilot.messages.push({ role: 'user', content: q })
    copilot.messages.push({
      role: 'assistant',
      content: 'Aucun modèle actif. Ouvrez la gestion des modèles (icône calques) pour en choisir ou en télécharger un.',
      failed: true,
    })
    return
  }

  copilot.generating = true
  genController = new AbortController()
  const signal = genController.signal
  // Historique = paires user→assistant RÉUSSIES uniquement (une question à réponse échouée
  // ou vide est écartée → jamais deux tours `user` consécutifs envoyés à /api/chat).
  const history: ChatTurn[] = []
  for (let k = 0; k < copilot.messages.length; k++) {
    const m = copilot.messages[k]
    if (m.role === 'assistant' && !m.failed && m.content) {
      const prev = copilot.messages[k - 1]
      if (prev?.role === 'user') history.push({ role: 'user', content: prev.content })
      history.push({ role: 'assistant', content: m.content })
    }
  }

  copilot.messages.push({ role: 'user', content: q })
  copilot.messages.push({ role: 'assistant', content: '', streaming: true })
  const idx = copilot.messages.length - 1 // index stable (generating sérialise les envois)

  try {
    const p = await ensureReady()
    if (p === null) {
      copilot.messages[idx].content = copilot.error || 'Le moteur IA est indisponible.'
      copilot.messages[idx].failed = true
      return
    }
    const messages = buildChatMessages({ docName: doc.name, docText: doc.text, kind: doc.kind, history, question: q })
    // Mutation via l'index (élément proxifié du $state array) → réactif ; muter la ref locale
    // poussée ne le serait PAS (piège $state profond de Svelte 5).
    await chat(p, app.activeModel, messages, (t) => (copilot.messages[idx].content += t), signal)
  } catch (e) {
    console.error('[copilot] chat', e)
    copilot.messages[idx].content = copilot.messages[idx].content || 'La génération a échoué. Vérifiez que le moteur est prêt, puis réessayez.'
    copilot.messages[idx].failed = true
  } finally {
    const m = copilot.messages[idx]
    if (m) {
      m.streaming = false
      // Annulé avant le 1er token → tour fantôme (question + réponse vide) : on retire les deux
      // (la bulle assistant vide À idx ET la question user à idx-1), pas de moitié orpheline.
      if (m.content === '' && !m.failed) copilot.messages.splice(idx - 1, 2)
    }
    copilot.generating = false
    genController = null
  }
}

// Interrompt la génération en cours (abort → texte partiel conservé, < 500 ms côté serveur).
export function stopChat(): void {
  genController?.abort()
}

// Nouvelle conversation : annule d'abord une génération en cours, puis vide l'historique.
export function newChat(): void {
  genController?.abort()
  copilot.messages = []
}
