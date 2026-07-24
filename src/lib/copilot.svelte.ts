// État runtime du copilote (13.4, réutilisé par 14.1) — éphémère, `$state` module-level
// (même motif que `app` dans stores.svelte.ts). Le port du sidecar est stable (start_ollama
// idempotent côté Rust) → on le cache ; `ensureReady` déduplique les appels concurrents
// (motif indexBuild de la recherche). Le modèle ACTIF (persisté) vit dans `app.activeModel`.
import { activeTab, app, editorRef, type CopilotProvider, type DocKind } from './stores.svelte'
import { setRephrasePreview } from './editor/rephrase-preview'
import { chat, deleteModel, generate, listModels, pull, startOllama, waitReady, type OllamaModel } from './ollama'
import {
  cancelOpenAiAuth,
  disconnectOpenAi,
  getOpenAiStatus,
  openAiChat,
  openAiGenerate,
  openOpenAiAuthPage,
  pollOpenAiAuth,
  startOpenAiAuth,
  OPENAI_MODEL,
  type OpenAiAuthStart,
  type OpenAiMessage,
} from './openai'
import {
  buildChatMessages,
  buildReduceSummaryPrompt,
  buildRephrasePrompt,
  buildSegmentSummaryPrompt,
  buildWholeSummaryPrompt,
  COPILOT_NUM_CTX,
  COPILOT_TEMPERATURE,
  segmentDoc,
  SUMMARY_MAP_MAX_TOKENS,
  type ChatTurn,
  type PersonaProfile,
  type RephraseMode,
  type SummaryMode,
} from './copilot-service'

// Un tour de conversation (14.1). `streaming` = réponse en cours (bulle en texte brut,
// rendu Markdown à la fin) ; `failed` = carte d'erreur ; `status` = ligne de progression
// transitoire pendant la phase « map » d'un résumé (14.2). Conversation éphémère (non persistée).
export interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  failed?: boolean
  // État de CONFIGURATION (pas un échec de génération) : aucun modèle actif. Rendu en carte
  // neutre « Aucun modèle actif » avec un bouton vers la vue Modèles — pas en carte d'erreur
  // rouge (rien n'a échoué, rien n'a même été tenté).
  config?: 'model' | 'openai'
  status?: string
  // Posé sur une carte `failed` : ce qu'il faut rejouer pour « Réessayer » (la question ou le
  // mode de résumé). Le document est re-capturé au moment du retry.
  retry?: { kind: 'chat'; question: string } | { kind: 'summary'; mode: SummaryMode }
}

export const copilot = $state({
  port: null as number | null,
  ready: false,
  loading: false,
  models: [] as OllamaModel[],
  pulling: null as { name: string; pct: number; done: number; total: number } | null,
  error: '',
  messages: [] as ChatMsg[],
  generating: false,
  openAiAuthenticated: null as boolean | null,
  openAiPreferredAvailable: null as boolean | null,
  openAiModels: [] as string[],
  openAiStatusError: '',
  openAiChecking: false,
  openAiAuth: null as OpenAiAuthStart | null,
  openAiAuthPhase: 'idle' as 'idle' | 'starting' | 'waiting' | 'error',
  openAiAuthError: '',
})

let readyPromise: Promise<number | null> | null = null
let pullController: AbortController | null = null
let genController: AbortController | null = null
let refreshToken = 0
let openAiAuthAttempt = 0

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

// Expose ensureReady aux consommateurs externes (index sémantique 15.2 : la vue Modèles
// démarre le sidecar puis passe le port au service RAG, qui n'importe pas ce module).
export function ensureCopilotReady(): Promise<number | null> {
  return ensureReady()
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
  copilot.pulling = { name: model, pct: 0, done: 0, total: 0 }
  copilot.error = ''
  try {
    await pull(
      p,
      model,
      (pct, done, total) => {
        if (copilot.pulling) {
          copilot.pulling.pct = pct
          copilot.pulling.done = done
          copilot.pulling.total = total
        }
      },
      pullController.signal,
    )
    await refreshModels()
    // Premier modèle installé → on l'ACTIVE automatiquement (sinon le parcours d'onboarding se
    // termine sur une bibliothèque au point éteint, et la première question échoue « sans
    // raison »). Conditions : ne jamais voler la place d'un modèle déjà actif, et n'activer que
    // si le modèle EST dans la liste rafraîchie (un pull annulé sort silencieusement d'ici —
    // sans ce contrôle on activerait un modèle à moitié téléchargé).
    const installed = copilot.models.find((m) => m.name === model || m.name === `${model}:latest`)
    // JAMAIS d'auto-activation d'un modèle d'embedding (index 15.2) : il ne sait pas
    // générer — l'activer casserait chat/résumé (« does not support generate ») sans
    // cause visible pour l'utilisateur dont le PREMIER pull est le modèle d'index.
    const isEmbed = installed && (installed.name === app.embedModel || /embed|bge-m3/i.test(installed.name))
    if (!app.activeModel && installed && !isEmbed) app.activeModel = installed.name
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
    // Modèle d'embedding supprimé : effacer le réglage (sinon le prochain index part
    // en 404) — l'UI de l'index repropose alors le défaut à télécharger. Alias :latest
    // couvert (pull de « bge-m3 » → installé « bge-m3:latest »).
    if (name === app.embedModel || name === `${app.embedModel}:latest`) app.embedModel = ''
    await refreshModels()
  } catch (e) {
    console.error('[copilot] delete', e)
    copilot.error = `Échec de la suppression de ${name}.`
  }
}

export function setActiveModel(name: string): void {
  app.activeModel = name
  app.copilotProvider = 'ollama'
}

export async function refreshOpenAiStatus(): Promise<void> {
  copilot.openAiChecking = true
  try {
    const status = await getOpenAiStatus()
    copilot.openAiAuthenticated = status.authenticated
    copilot.openAiPreferredAvailable = status.preferredModelAvailable
    copilot.openAiModels = status.models
    copilot.openAiStatusError = status.error ?? ''
  } catch (error) {
    console.error('[copilot] openai status', error)
    copilot.openAiAuthenticated = false
    copilot.openAiPreferredAvailable = null
    copilot.openAiModels = []
    copilot.openAiStatusError = 'État de la connexion OpenAI indisponible.'
  } finally {
    copilot.openAiChecking = false
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function beginOpenAiAuth(): Promise<void> {
  const attempt = ++openAiAuthAttempt
  copilot.openAiAuthPhase = 'starting'
  copilot.openAiAuthError = ''
  try {
    const auth = await startOpenAiAuth()
    if (attempt !== openAiAuthAttempt) {
      await cancelOpenAiAuth(auth.sessionId)
      return
    }
    copilot.openAiAuth = auth
    copilot.openAiAuthPhase = 'waiting'
    try {
      await openOpenAiAuthPage(auth.verificationUrl)
    } catch (error) {
      console.error('[copilot] open OpenAI auth page', error)
      copilot.openAiAuthError = 'La page ne s’est pas ouverte. Copiez le code puis ouvrez le lien indiqué.'
    }

    const expiresAt = Date.now() + auth.expiresIn * 1000
    while (attempt === openAiAuthAttempt && Date.now() < expiresAt) {
      await delay(auth.interval * 1000)
      if (attempt !== openAiAuthAttempt) return
      const poll = await pollOpenAiAuth(auth.sessionId)
      if (poll.status === 'pending') continue
      if (poll.status === 'approved') {
        copilot.openAiAuth = null
        copilot.openAiAuthPhase = 'idle'
        copilot.openAiAuthError = ''
        await refreshOpenAiStatus()
        return
      }
      break
    }
    if (attempt === openAiAuthAttempt) {
      copilot.openAiAuthPhase = 'error'
      copilot.openAiAuthError = 'Le code a expiré. Relancez la connexion pour en obtenir un nouveau.'
    }
  } catch (error) {
    if (attempt !== openAiAuthAttempt) return
    console.error('[copilot] OpenAI auth', error)
    copilot.openAiAuthPhase = 'error'
    copilot.openAiAuthError = error instanceof Error ? error.message : String(error)
  }
}

export async function cancelOpenAiConnection(): Promise<void> {
  const auth = copilot.openAiAuth
  ++openAiAuthAttempt
  copilot.openAiAuth = null
  copilot.openAiAuthPhase = 'idle'
  copilot.openAiAuthError = ''
  if (auth) await cancelOpenAiAuth(auth.sessionId).catch(() => {})
}

export async function disconnectOpenAiAccount(): Promise<void> {
  await cancelOpenAiConnection()
  try {
    await disconnectOpenAi()
    copilot.openAiAuthenticated = false
    copilot.openAiPreferredAvailable = null
    copilot.openAiModels = []
    copilot.openAiStatusError = ''
  } catch (error) {
    console.error('[copilot] OpenAI disconnect', error)
    copilot.openAiStatusError = 'Impossible de déconnecter le compte OpenAI.'
  }
}

export function setCopilotProvider(provider: CopilotProvider): void {
  app.copilotProvider = provider
  if (provider === 'openai') void refreshOpenAiStatus()
}

type ProviderRuntime =
  | { provider: 'ollama'; port: number; model: string }
  | { provider: 'openai'; model: typeof OPENAI_MODEL }

function personaFor(runtime: ProviderRuntime): PersonaProfile {
  return runtime.provider === 'openai' ? 'cloud' : 'local'
}

async function resolveRuntime(provider: CopilotProvider, localModel: string): Promise<ProviderRuntime | null> {
  if (provider === 'openai') {
    if (copilot.openAiAuthenticated === null) await refreshOpenAiStatus()
    return copilot.openAiAuthenticated && copilot.openAiPreferredAvailable !== false
      ? { provider: 'openai', model: OPENAI_MODEL }
      : null
  }
  if (!localModel) return null
  const port = await ensureReady()
  return port === null ? null : { provider: 'ollama', port, model: localModel }
}

function streamChat(
  runtime: ProviderRuntime,
  messages: OpenAiMessage[],
  onToken: (token: string) => void,
  signal: AbortSignal,
): Promise<string> {
  if (runtime.provider === 'openai') return openAiChat(messages, onToken, signal)
  return chat(runtime.port, runtime.model, messages, onToken, signal, {
    num_ctx: COPILOT_NUM_CTX,
    temperature: COPILOT_TEMPERATURE,
  })
}

function streamGenerate(
  runtime: ProviderRuntime,
  prompt: string,
  onToken: (token: string) => void,
  signal: AbortSignal,
  options: { map?: boolean } = {},
): Promise<string> {
  if (runtime.provider === 'openai') {
    return openAiGenerate(prompt, onToken, signal)
  }
  return generate(runtime.port, runtime.model, prompt, onToken, signal, {
    num_ctx: COPILOT_NUM_CTX,
    temperature: COPILOT_TEMPERATURE,
    ...(options.map ? { num_predict: SUMMARY_MAP_MAX_TOKENS } : {}),
  })
}

function providerSetupMessage(provider: CopilotProvider): string {
  return provider === 'openai'
    ? copilot.openAiPreferredAvailable === false
      ? 'Votre compte OpenAI est connecté, mais GPT‑5.6 Luna n’est pas disponible pour cet abonnement.'
      : 'Connectez votre compte OpenAI dans Modèles. Doku ne vous demandera jamais de clé API.'
    : 'Choisissez ou téléchargez un modèle local pour utiliser le copilote — tout reste sur votre machine.'
}

function generationFailure(error: unknown, provider: CopilotProvider, fallback: string): string {
  if (provider !== 'openai') return fallback
  const detail = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return detail.trim() ? `OpenAI : ${detail.trim()}` : fallback
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
  const provider = app.copilotProvider
  const localModel = app.activeModel

  // Garde modèle : carte de CONFIG sans démarrer le sidecar (préserve le boot-safety 14.0).
  if (provider === 'ollama' && !localModel) {
    copilot.messages.push({ role: 'user', content: q })
    copilot.messages.push({
      role: 'assistant',
      content: providerSetupMessage(provider),
      config: 'model',
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
    // `config` écarté aussi : la carte « Aucun modèle actif » est de l'UI, pas un tour de dialogue.
    if (m.role === 'assistant' && !m.failed && !m.config && m.content) {
      const prev = copilot.messages[k - 1]
      if (prev?.role === 'user') history.push({ role: 'user', content: prev.content })
      history.push({ role: 'assistant', content: m.content })
    }
  }

  copilot.messages.push({ role: 'user', content: q })
  // `status` couvre le démarrage moteur + le PREFILL (ingestion du doc, longue sur CPU) : sans
  // lui, le skeleton muet se lit comme un blocage. Effacé au 1er token (voir stream ci-dessous).
  copilot.messages.push({ role: 'assistant', content: '', streaming: true, status: 'Doku-San lit le document…' })
  const idx = copilot.messages.length - 1 // index stable (generating sérialise les envois)

  try {
    const runtime = await resolveRuntime(provider, localModel)
    if (runtime === null) {
      const message = copilot.messages[idx]
      if (provider === 'openai') {
        message.content = providerSetupMessage(provider)
        message.config = 'openai'
      } else {
        message.content = copilot.error || 'Le moteur IA est indisponible.'
        message.failed = true
        message.retry = { kind: 'chat', question: q }
      }
      return
    }
    const messages = buildChatMessages({
      docName: doc.name,
      docText: doc.text,
      kind: doc.kind,
      history,
      question: q,
      persona: personaFor(runtime),
    })
    // num_ctx fixé (14.3) : le doc + la consigne d'ancrage doivent rester en contexte sur plusieurs
    // tours ; au défaut Ollama (4096) l'historique les évincerait par troncature gauche silencieuse.
    // Mutation via l'index (élément proxifié du $state array) → réactif ; muter la ref locale
    // poussée ne le serait PAS (piège $state profond de Svelte 5).
    await streamChat(
      runtime,
      messages,
      (t) => {
        const m = copilot.messages[idx]
        m.status = undefined // 1er token : le prefill est fini, le texte prend le relais
        m.content += t
      },
      signal,
    )
  } catch (e) {
    console.error('[copilot] chat', e)
    copilot.messages[idx].content = copilot.messages[idx].content || generationFailure(e, provider, 'La génération a échoué. Vérifiez que le moteur est prêt, puis réessayez.')
    copilot.messages[idx].failed = true
    copilot.messages[idx].retry = { kind: 'chat', question: q }
  } finally {
    const m = copilot.messages[idx]
    if (m) {
      m.streaming = false
      m.status = undefined
      // Annulé avant le 1er token → tour fantôme (question + réponse vide) : on retire les deux
      // (la bulle assistant vide À idx ET la question user à idx-1), pas de moitié orpheline.
      if (m.content === '' && !m.failed) copilot.messages.splice(idx - 1, 2)
    }
    copilot.generating = false
    genController = null
  }
}

// Plafond de passes de réduction : garde-fou contre un modèle qui ne « contracterait » pas ses
// résumés (boucle infinie théorique). Au-delà, on synthétise par groupe et on concatène — ça
// termine et ne perd rien (jamais de troncature silencieuse).
const MAX_REDUCE_PASSES = 3

// Résume le document courant (14.2). Contrairement au chat, on n'envoie PAS le doc en un bloc
// (troncature interdite par FR-4) : on SEGMENTE (map-reduce) via generate() single-shot, avec
// num_ctx fixé pour qu'Ollama ne tronque pas non plus. La phase « map » affiche une progression
// (`status`) ; la synthèse finale est streamée. `doc` = SNAPSHOT (changement d'onglet sans effet).
// Anti-TOCTOU et boot-safety identiques à sendChat.
export async function summarizeDoc(
  doc: { name: string | null; text: string; kind: DocKind },
  mode: SummaryMode = 'summary',
): Promise<void> {
  if (copilot.generating) return
  const provider = app.copilotProvider
  const localModel = app.activeModel
  const userLabel = mode === 'keypoints' ? 'Quels sont les points clés de ce document ?' : 'Résume ce document.'
  const reply = (content: string, flags: { failed?: boolean; config?: 'model' | 'openai' } = {}) => {
    copilot.messages.push({ role: 'user', content: userLabel })
    copilot.messages.push({ role: 'assistant', content, ...flags })
  }

  // Garde modèle : carte de CONFIG sans démarrer le sidecar (préserve le boot-safety 14.0).
  if (provider === 'ollama' && !localModel) {
    reply(providerSetupMessage(provider), { config: 'model' })
    return
  }
  // Rien de valable à résumer → message clair, pas de résumé bidon (FR-4). L'extraction du texte
  // des PDF (pdf.js) est une dette non soldée → tout PDF passe par ce message pour l'instant.
  if (doc.kind === 'pdf') {
    reply("Je ne peux pas encore résumer les PDF — l'extraction de leur texte arrive prochainement. Je résume les documents Markdown, texte et HTML.")
    return
  }
  if (!doc.text.trim()) {
    reply("Ce document est vide — il n'y a rien à résumer.")
    return
  }

  copilot.generating = true
  genController = new AbortController()
  const signal = genController.signal

  copilot.messages.push({ role: 'user', content: userLabel })
  copilot.messages.push({ role: 'assistant', content: '', streaming: true, status: 'Lecture du document…' })
  const idx = copilot.messages.length - 1
  // `opts` = synthèse finale (sortie libre pour un résumé complet). `mapOpts` = phases
  // intermédiaires (map + réductions non finales) : sortie bornée → plus rapide et pas de débordement.
  const setStatus = (s: string | undefined) => {
    const m = copilot.messages[idx]
    if (m) m.status = s
  }
  // Le statut tient JUSQU'AU 1er token (l'effacer avant le generate laisserait un skeleton muet
  // pendant tout le prefill — long sur CPU) ; le flux de texte prend alors le relais.
  const stream = (t: string) => {
    const m = copilot.messages[idx]
    m.status = undefined
    m.content += t
  }

  try {
    const runtime = await resolveRuntime(provider, localModel)
    if (runtime === null) {
      const m = copilot.messages[idx]
      if (provider === 'openai') {
        m.content = providerSetupMessage(provider)
        m.config = 'openai'
      } else {
        m.content = copilot.error || 'Le moteur IA est indisponible.'
        m.failed = true
        m.retry = { kind: 'summary', mode }
      }
      return
    }

    const segments = segmentDoc(doc.text)
    const persona = personaFor(runtime)
    if (segments.length <= 1) {
      // Tient dans une fenêtre → résumé direct, streamé (le statut initial couvre le prefill).
      await streamGenerate(runtime, buildWholeSummaryPrompt(doc.text, doc.name, mode, persona), stream, signal)
    } else {
      // map : un résumé par segment (non streamé, avec progression).
      const partials: string[] = []
      for (let i = 0; i < segments.length; i++) {
        setStatus(`Lecture du document — partie ${i + 1}/${segments.length}…`)
        const s = await streamGenerate(runtime, buildSegmentSummaryPrompt(segments[i], i + 1, segments.length, doc.name, persona), () => {}, signal, { map: true })
        if (signal.aborted) return
        partials.push(s)
      }
      // reduce hiérarchique borné : réduire tant que la concaténation déborde d'une fenêtre.
      let joined = partials.join('\n\n')
      let passes = 0
      while (segmentDoc(joined).length > 1 && passes < MAX_REDUCE_PASSES) {
        setStatus('Synthèse en cours…')
        const groups = segmentDoc(joined)
        const reduced: string[] = []
        for (const g of groups) {
          const s = await streamGenerate(runtime, buildReduceSummaryPrompt(g, doc.name, mode, persona), () => {}, signal, { map: true })
          if (signal.aborted) return
          reduced.push(s)
        }
        joined = reduced.join('\n\n')
        passes++
      }
      // Synthèse finale streamée. Normalement 1 groupe ; si le plafond de passes est atteint, on
      // streame chaque groupe à la suite (concaténation) plutôt que d'en écarter — jamais de perte.
      // Le statut reste affiché pendant le prefill de la synthèse ; `stream` l'efface au 1er token.
      setStatus('Synthèse en cours…')
      const finalGroups = segmentDoc(joined)
      for (let i = 0; i < finalGroups.length; i++) {
        if (i > 0) copilot.messages[idx].content += '\n\n'
        await streamGenerate(runtime, buildReduceSummaryPrompt(finalGroups[i], doc.name, mode, persona), stream, signal)
        if (signal.aborted) return
      }
    }
  } catch (e) {
    console.error('[copilot] summarize', e)
    const m = copilot.messages[idx]
    if (m) {
      m.content = m.content || generationFailure(e, provider, 'Le résumé a échoué. Vérifiez que le moteur est prêt, puis réessayez.')
      m.failed = true
      m.retry = { kind: 'summary', mode }
    }
  } finally {
    const m = copilot.messages[idx]
    if (m) {
      m.streaming = false
      m.status = undefined
      // Annulé avant tout texte → tour fantôme (question + réponse vide) : on retire les deux.
      if (m.content === '' && !m.failed) copilot.messages.splice(idx - 1, 2)
    }
    copilot.generating = false
    genController = null
  }
}

// --- Assistance d'écriture en place (16.1 + 16.2, brief w3) ---------------------------------
// La proposition ne vit PLUS dans le panneau : elle est rendue PAR-DESSUS la sélection dans
// l'éditeur (rephrase-preview.ts, câblé par DocumentView). `current` est le run unique en
// cours ; `id` déjoue les callbacks d'un run annulé — comparer par id, JAMAIS par identité
// d'objet (une ref locale pointe le raw, pas le proxy $state).
export interface RephraseRun {
  id: number
  tabId: number
  from: number
  to: number
  original: string
  mode: RephraseMode
  text: string
  phase: 'streaming' | 'ready' | 'error' | 'config'
  error: string
}

export const rephrase = $state({ current: null as RephraseRun | null })
let rephraseSeq = 0

// Reformule/corrige la sélection courante (FR-7/FR-8). Streame une PROPOSITION — n'écrit RIEN
// dans le document ; l'aperçu en place la rend avec un diff, l'utilisateur accepte (remplace,
// une transaction → Ctrl+Z restaure) ou refuse. Anti-TOCTOU et boot-safety identiques à
// sendChat ; le tabId fige l'onglet cible (éditeur CM6 PARTAGÉ entre onglets).
export async function rephraseSelection(mode: RephraseMode): Promise<void> {
  if (copilot.generating || rephrase.current) return
  const view = editorRef.view
  if (!view) return
  const sel = view.state.selection.main
  if (sel.empty) return
  await runRephrase({ tabId: app.activeId, from: sel.from, to: sel.to, original: view.state.sliceDoc(sel.from, sel.to), mode })
}

async function runRephrase(params: { tabId: number; from: number; to: number; original: string; mode: RephraseMode }): Promise<void> {
  const provider = app.copilotProvider
  const localModel = app.activeModel
  const id = ++rephraseSeq
  copilot.generating = true
  genController = new AbortController()
  const signal = genController.signal
  rephrase.current = { id, ...params, text: '', phase: 'streaming', error: '' }

  try {
    // Garde modèle : note de config en place, sans démarrer le sidecar (boot-safety 14.0).
    if (provider === 'ollama' && !localModel) {
      const cur = rephrase.current
      if (cur?.id === id) {
        cur.phase = 'config'
        cur.error = providerSetupMessage(provider)
      }
      return
    }
    const runtime = await resolveRuntime(provider, localModel)
    let cur = rephrase.current
    if (cur?.id !== id) return
    if (runtime === null) {
      if (provider === 'openai') {
        cur.phase = 'config'
        cur.error = providerSetupMessage(provider)
      } else {
        cur.phase = 'error'
        cur.error = copilot.error || 'Le moteur IA est indisponible.'
      }
      return
    }
    const text = await streamGenerate(
      runtime,
      buildRephrasePrompt(params.original, params.mode, personaFor(runtime)),
      (t) => {
        const c = rephrase.current
        if (c?.id === id) c.text += t
      },
      signal,
    )
    cur = rephrase.current
    if (cur?.id !== id) return
    // Abort externe (Échap a déjà nettoyé, mais aussi stop/nouvelle conversation du panneau —
    // le contrôleur est partagé) : écarter l'aperçu, ne jamais le laisser figé en streaming.
    if (signal.aborted) {
      rephrase.current = null
      return
    }
    const trimmed = text.trim()
    if (!trimmed) {
      cur.phase = 'error'
      cur.error = 'Aucune proposition reçue. Réessayez, ou changez de modèle.'
      return
    }
    // Les blancs de bord de l'ORIGINAL sont réappliqués : le remplacement ne mange jamais un
    // saut de ligne de frontière, et le diff ne montre pas de suppression d'espace fantôme.
    cur.text = (params.original.match(/^\s*/)?.[0] ?? '') + trimmed + (params.original.match(/\s*$/)?.[0] ?? '')
    cur.phase = 'ready' // posé AVANT le finally : cancelRephrase n'aborte que la phase streaming
  } catch (e) {
    console.error('[copilot] rephrase', e)
    const cur = rephrase.current
    if (cur?.id !== id) return
    if (signal.aborted) {
      rephrase.current = null
      return
    }
    cur.phase = 'error'
    cur.error = generationFailure(e, provider, 'La génération a échoué. Vérifiez que le moteur est prêt, puis réessayez.')
  } finally {
    copilot.generating = false
    genController = null
  }
}

// Applique la proposition : remplace la plage d'origine par le texte proposé — UNE transaction
// (annulable Ctrl+Z) qui porte AUSSI le retrait de l'aperçu (l'auto-dismiss du champ ne doit
// pas la prendre pour une édition étrangère). Garde zéro-perte 16.1 conservée en défense en
// profondeur : mauvais onglet ou région qui n'est plus l'original → on n'écrit RIEN.
export function acceptRephrase(): void {
  const cur = rephrase.current
  if (!cur || cur.phase !== 'ready') return
  const view = editorRef.view
  if (!view || !cur.text) return
  if (app.activeId !== cur.tabId || cur.to > view.state.doc.length || view.state.sliceDoc(cur.from, cur.to) !== cur.original) {
    rephrase.current = null
    return
  }
  view.dispatch({
    changes: { from: cur.from, to: cur.to, insert: cur.text },
    selection: { anchor: cur.from + cur.text.length },
    effects: setRephrasePreview.of(null),
  })
  rephrase.current = null
  view.focus()
}

// Écarte l'aperçu sans rien écrire (Refuser, Échap, édition du doc, changement d'onglet…).
// N'aborte le contrôleur partagé QUE si c'est la reformulation qui streame — un aperçu `ready`
// peut coexister avec une génération de chat, ne pas la tuer.
export function cancelRephrase(): void {
  const cur = rephrase.current
  if (!cur) return
  if (cur.phase === 'streaming') genController?.abort()
  rephrase.current = null
}

// Relance après échec, avec les MÊMES bornes (toujours valides : toute édition du document
// auto-dismisse l'aperçu, phase error comprise).
export function retryRephrase(): void {
  const cur = rephrase.current
  if (!cur || cur.phase !== 'error' || copilot.generating) return
  const { tabId, from, to, original, mode } = cur
  rephrase.current = null
  void runRephrase({ tabId, from, to, original, mode })
}

// Rejoue une génération échouée (bouton « Réessayer » de la carte d'erreur). Retire la paire
// échouée (question + carte) puis re-dispatche l'action d'origine avec un SNAPSHOT FRAIS du
// document courant — l'utilisateur a pu corriger la cause (moteur redémarré, doc modifié).
export function retryGeneration(idx: number): void {
  const m = copilot.messages[idx]
  if (!m?.retry || copilot.generating) return
  const r = m.retry
  copilot.messages.splice(idx - 1, 2)
  const t = activeTab()
  const doc = { name: t?.name ?? null, text: t?.content ?? '', kind: t?.kind ?? ('md' as DocKind) }
  if (r.kind === 'chat') void sendChat(r.question, doc)
  else void summarizeDoc(doc, r.mode)
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
