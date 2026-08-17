// État runtime du copilote (13.4, réutilisé par 14.1) — éphémère, `$state` module-level
// (même motif que `app` dans stores.svelte.ts). Le port du sidecar est stable (start_ollama
// idempotent côté Rust) → on le cache ; `ensureReady` déduplique les appels concurrents
// (motif indexBuild de la recherche). Le modèle ACTIF (persisté) vit dans `app.activeModel`.
import {
  activeTab,
  app,
  activeEditorView,
  isCloudProvider,
  openPath,
  refreshExplorer,
  visibleTabs,
  type CopilotProvider,
  type DocKind,
} from './stores.svelte'
import {
  compatChat,
  compatGenerate,
  disconnectCompat,
  getCompatStatus,
  MINIMAX_DEFAULT_MODEL,
  setCompatKey,
  type CompatStatus,
} from './compat'
import { citedNumbers, locateOffset, locatePassage, type CitedPassage } from './citations'
import { isBinaryKind } from './doc-kind'
import { setRephrasePreview } from './editor/rephrase-preview'
import { baseName, joinPath, parentPath } from './explorer'
import { noteContent, noteFileName } from './notes'
import { createFileWithContent, isTauri } from './tauri'
import { chunkText, DEFAULT_EMBED_MODEL, noteTitle, RAG_TOP_K } from './rag'
import { cancelRagIndexing, ragState, searchDocEphemeral, searchRag, type RagHit } from './rag-index.svelte'
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
  applyVerbosity,
  buildChatMessages,
  buildCitedDocChatMessages,
  buildDocIndexChatMessages,
  buildFolderChatMessages,
  verbosityNote,
  REFUSAL_PHRASE,
  DOC_INDEX_REFUSAL_PHRASE,
  FOLDER_REFUSAL_PHRASE,
  MAX_DOC_CHARS,
  MAX_DOC_CHARS_CLOUD,
  buildCitedSummaryPrompt,
  buildReduceSummaryPrompt,
  buildRephrasePrompt,
  buildSegmentSummaryPrompt,
  buildWholeSummaryPrompt,
  COPILOT_NUM_CTX,
  COPILOT_TEMPERATURE,
  normalizeInstruction,
  SEGMENT_CHARS,
  segmentDoc,
  SUMMARY_MAP_MAX_TOKENS,
  type ChatTurn,
  type OllamaMessage,
  type PersonaProfile,
  type RephraseMode,
  type SummaryMode,
} from './copilot-service'
import {
  buildPdfCorrectionPrompt,
  parsePdfCorrections,
  type CorrectableLine,
  type DroppedEdit,
  type PdfEdit,
} from './pdf-correction'
import {
  buildContextBundle,
  mergeAutomaticContextItems,
  pathBelongsToFolder,
  upsertContextItems,
  type ContextBundle,
  type CopilotContextItem,
  type SentContextSource,
} from './copilot-context'
import {
  memoryWorkspace,
  queueMemoryExtraction,
  recallCloudMemories,
  type MemoryWorkspace,
} from './copilot-memory.svelte'
import type { CloudMemoryProvider, MemoryPromptSource } from './copilot-memory'

// Un tour de conversation (14.1). `streaming` = réponse en cours (bulle en texte brut,
// rendu Markdown à la fin) ; `failed` = carte d'erreur ; `status` = ligne de progression
// transitoire pendant la phase « map » d'un résumé (14.2). Conversation éphémère (non persistée).
// Portée d'une question (15.3) : le document courant ou le dossier entier (RAG).
export type ChatScope = 'doc' | 'folder'

export interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  failed?: boolean
  // État de CONFIGURATION (pas un échec de génération) : aucun modèle actif / compte
  // OpenAI absent / clé MiniMax absente / modèle d'EMBEDDING manquant (mode dossier,
  // 15.3). Rendu en carte neutre avec un bouton vers la vue Modèles — pas en erreur rouge.
  config?: 'model' | 'openai' | 'minimax' | 'embed'
  // Message d'INFO de l'app (« dossier pas encore indexé »…) : affiché comme une réponse
  // mais exclu de l'historique envoyé au modèle (ce n'est pas un tour de dialogue).
  notice?: boolean
  status?: string
  // Passages top-k réellement fournis au modèle (15.3, enrichi 21.x) : UN PAR EXTRAIT,
  // numérotés comme dans le prompt. Alimente le pied « Passages consultés » DÉTERMINISTE
  // ET les puces [n] inline (citations ancrées) — on affiche toujours les passages
  // réellement fournis, on ne dépend jamais du modèle pour la liste.
  // `text` = contenu du chunk : le clic le relocalise dans le document (locatePassage).
  // `path` null = document sans chemin (non enregistré) : puce affichée, saut best-effort
  // dans l'onglet actif.
  sources?: CitedPassage[]
  // Mode « document complet en extraits » (21.x) : les sources couvrent TOUT le document —
  // le pied n'affiche que les numéros réellement cités (`cited`), la liste complète
  // serait du bruit. Absent en mode top-k (le pied liste les passages consultés).
  citedOnly?: boolean
  cited?: number[]
  // Libellé de la source de la réponse, CAPTURÉ à la fin de la génération (nom du doc ou
  // « les notes du dossier ») : la provenance d'une note sauvée ne dépend jamais de
  // l'onglet actif au moment du clic — il a pu changer, elle mentirait.
  sourceLabel?: string
  // Sources additionnelles réellement transmises pour CETTE réponse. Elles sont séparées
  // des citations ancrables : un fichier ponctuel n'est pas nécessairement ouvert dans Doku.
  contextSources?: SentContextSource[]
  // Souvenirs effectivement rappelés avant CETTE réponse. L'UI affiche les entrées
  // injectées par Doku, sans dépendre d'une citation produite par le modèle.
  memorySources?: MemoryPromptSource[]
  // Posé sur une carte `failed` : ce qu'il faut rejouer pour « Réessayer » (la question ou le
  // mode de résumé). Le document est re-capturé au moment du retry (le dossier aussi, 15.3).
  retry?: { kind: 'chat'; question: string; scope: ChatScope; contextRevision: number; workspaceContextKey?: string } | { kind: 'summary'; mode: SummaryMode }
}

export const copilot = $state({
  port: null as number | null,
  ready: false,
  loading: false,
  models: [] as OllamaModel[],
  // true après une PREMIÈRE liste réussie : « aucun modèle » / « introuvable » ne
  // s'affirment jamais sur une liste simplement jamais lue (moteur pas démarré).
  modelsLoaded: false,
  pulling: null as { name: string; pct: number; done: number; total: number } | null,
  error: '',
  messages: [] as ChatMsg[],
  generating: false,
  // Sauvegarde de note en cours (anti double-clic — une seule à la fois suffit).
  savingNote: false,
  // Portée courante des questions (15.3) — éphémère, choisie dans la face « Contexte ».
  scope: 'doc' as ChatScope,
  contextItems: [] as CopilotContextItem[],
  contextFolder: null as { path: string; label: string } | null,
  // Mémoire partagée volontairement avec un dossier. null = portée document, qui est
  // toujours le défaut. Séparée de l'explorateur ET du contexte : parcourir ou ajouter
  // Desktop n'en fait jamais implicitement un « travail » mémorisé.
  memoryFolder: null as { path: string; label: string } | null,
  contextRevision: 0,
  contextError: '',
  // Dernière extraction PDF résolue (18.2) : alimente le badge de contexte HONNÊTEMENT
  // (le texte d'un PDF n'est pas dans tab.content → le badge ne peut le connaître qu'après
  // une première lecture). null tant qu'aucun PDF n'a été lu ce cycle.
  pdfDoc: null as { path: string; charCount: number; scanned: boolean } | null,
  openAiAuthenticated: null as boolean | null,
  openAiPreferredAvailable: null as boolean | null,
  openAiModels: [] as string[],
  openAiStatusError: '',
  openAiChecking: false,
  openAiAuth: null as OpenAiAuthStart | null,
  openAiAuthPhase: 'idle' as 'idle' | 'starting' | 'waiting' | 'error',
  openAiAuthError: '',
  // MiniMax (ADR-0018) : statut de la clé + connexion en cours. null = jamais interrogé.
  minimaxStatus: null as CompatStatus | null,
  minimaxChecking: false,
  minimaxConnecting: false,
  minimaxConnectError: '',
})

export function addCopilotContext(items: readonly CopilotContextItem[]): void {
  const next = upsertContextItems(copilot.contextItems, items)
  const changed = next.items.length !== copilot.contextItems.length || next.items.some((item, index) => {
    const before = copilot.contextItems[index]
    return !before || before.id !== item.id || before.text !== item.text || before.label !== item.label ||
      before.path !== item.path || before.signature !== item.signature || before.charCount !== item.charCount ||
      before.truncatedAtLoad !== item.truncatedAtLoad
  })
  copilot.contextItems = next.items
  if (changed) copilot.contextRevision++
  copilot.contextError = next.rejected > 0
    ? `Limite atteinte : ${next.rejected} source${next.rejected > 1 ? 's' : ''} non ajoutée${next.rejected > 1 ? 's' : ''}.`
    : ''
}

export function removeCopilotContext(id: string): void {
  const next = copilot.contextItems.filter((item) => item.id !== id)
  if (next.length === copilot.contextItems.length) return
  copilot.contextItems = next
  copilot.contextRevision++
  copilot.contextError = ''
}

export function setCopilotContextFolder(folder: { path: string; label: string } | null): void {
  if (copilot.contextFolder?.path === folder?.path) return
  copilot.contextFolder = folder
  copilot.scope = folder ? 'folder' : 'doc'
  copilot.contextRevision++
  copilot.contextError = ''
}

export function setCopilotMemoryFolder(folder: { path: string; label: string } | null): void {
  if (copilot.memoryFolder?.path === folder?.path) return
  copilot.memoryFolder = folder ? { ...folder } : null
}

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
    if (token === refreshToken) {
      copilot.models = models
      copilot.modelsLoaded = true
    }
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
    if (!app.activeModel && installed && !isEmbedModel(installed.name)) app.activeModel = installed.name
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

// Prédicat UNIQUE « modèle d'embedding » (auto-activation post-pull + dropdown Modèle
// actif) : un embedding ne sait pas générer — l'activer casserait chat/résumé
// (« does not support generate ») sans cause visible pour l'utilisateur.
export function isEmbedModel(name: string): boolean {
  return name === app.embedModel || /embed|bge-m3/i.test(name)
}

// Coalescence des checks concurrents (picker + $effect de vue) : la promesse en vol est
// PARTAGÉE, jamais abandonnée — un drop-guard renverrait un état périmé aux appelants
// qui await (resolveRuntime, beginOpenAiAuth post-approbation).
let openAiStatusInFlight: Promise<void> | null = null

export function refreshOpenAiStatus(): Promise<void> {
  if (openAiStatusInFlight) return openAiStatusInFlight
  copilot.openAiChecking = true
  openAiStatusInFlight = (async () => {
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
      openAiStatusInFlight = null
    }
  })()
  return openAiStatusInFlight
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

// Aligne le modèle persisté sur la liste réellement servie (un modèle retiré du
// catalogue laisserait un <select> vide et des requêtes vouées au 404).
function normalizeMinimaxModel(status: CompatStatus): void {
  if (!app.minimaxModel || (status.models.length > 0 && !status.models.includes(app.minimaxModel))) {
    app.minimaxModel = status.models.includes(MINIMAX_DEFAULT_MODEL)
      ? MINIMAX_DEFAULT_MODEL
      : (status.models[0] ?? MINIMAX_DEFAULT_MODEL)
  }
}

// Même coalescence que refreshOpenAiStatus : resolveRuntime await ce résultat.
let minimaxStatusInFlight: Promise<CompatStatus | null> | null = null

export function refreshMinimaxStatus(): Promise<CompatStatus | null> {
  if (minimaxStatusInFlight) return minimaxStatusInFlight
  copilot.minimaxChecking = true
  minimaxStatusInFlight = doRefreshMinimaxStatus()
  return minimaxStatusInFlight
}

async function doRefreshMinimaxStatus(): Promise<CompatStatus | null> {
  try {
    const status = await getCompatStatus('minimax')
    copilot.minimaxStatus = status
    if (status.connected) normalizeMinimaxModel(status)
    return status
  } catch (error) {
    // Échec TRANSITOIRE (IPC) : on garde le dernier statut connu — l'écraser en null
    // ferait mentir la carte (« aucune clé ») alors qu'une clé est peut-être là.
    console.error('[copilot] minimax status', error)
    return copilot.minimaxStatus
  } finally {
    copilot.minimaxChecking = false
    minimaxStatusInFlight = null
  }
}

// Connecte une clé MiniMax : validée côté Rust par un appel à 1 token AVANT stockage —
// clé invalide ou réseau en panne → erreur affichée, rien n'est écrit nulle part.
export async function connectMinimax(key: string): Promise<boolean> {
  if (copilot.minimaxConnecting) return false
  copilot.minimaxConnecting = true
  copilot.minimaxConnectError = ''
  try {
    const status = await setCompatKey('minimax', key)
    copilot.minimaxStatus = status
    normalizeMinimaxModel(status)
    return true
  } catch (error) {
    copilot.minimaxConnectError = error instanceof Error ? error.message : String(error)
    return false
  } finally {
    copilot.minimaxConnecting = false
  }
}

export async function disconnectMinimaxKey(): Promise<void> {
  try {
    await disconnectCompat('minimax')
    copilot.minimaxStatus = { keyPresent: false, connected: false, keyRejected: false, models: [] }
    copilot.minimaxConnectError = ''
  } catch (error) {
    console.error('[copilot] minimax disconnect', error)
    copilot.minimaxConnectError = 'Impossible de supprimer la clé MiniMax.'
  }
}

export function setCopilotProvider(provider: CopilotProvider): void {
  app.copilotProvider = provider
  if (provider === 'openai') void refreshOpenAiStatus()
  if (provider === 'minimax') void refreshMinimaxStatus()
}

type ProviderRuntime =
  | { provider: 'ollama'; port: number; model: string }
  | { provider: 'openai'; model: typeof OPENAI_MODEL }
  | { provider: 'minimax'; model: string }

function personaFor(runtime: ProviderRuntime): PersonaProfile {
  return isCloudProvider(runtime.provider) ? 'cloud' : 'local'
}

async function resolveRuntime(provider: CopilotProvider, localModel: string): Promise<ProviderRuntime | null> {
  if (provider === 'openai') {
    if (copilot.openAiAuthenticated === null) await refreshOpenAiStatus()
    return copilot.openAiAuthenticated && copilot.openAiPreferredAvailable !== false
      ? { provider: 'openai', model: OPENAI_MODEL }
      : null
  }
  if (provider === 'minimax') {
    const status = copilot.minimaxStatus ?? (await refreshMinimaxStatus())
    if (!status || !status.keyPresent || status.keyRejected) return null
    return { provider: 'minimax', model: app.minimaxModel || MINIMAX_DEFAULT_MODEL }
  }
  if (!localModel) return null
  const port = await ensureReady()
  return port === null ? null : { provider: 'ollama', port, model: localModel }
}

// `onThinking` (cloud) : appelé au premier delta de raisonnement — les modèles cloud
// pensent parfois des dizaines de secondes avant le premier token visible ; le statut
// doit le dire (« jamais muet »). Jamais émis par Ollama (modèle local non pensant).
function streamChat(
  runtime: ProviderRuntime,
  messages: OpenAiMessage[],
  onToken: (token: string) => void,
  signal: AbortSignal,
  onThinking?: () => void,
): Promise<string> {
  if (runtime.provider === 'openai') return openAiChat(messages, onToken, signal, onThinking)
  if (runtime.provider === 'minimax') return compatChat('minimax', runtime.model, messages, onToken, signal, onThinking)
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
  options: { map?: boolean; onThinking?: () => void } = {},
): Promise<string> {
  if (runtime.provider === 'openai') {
    return openAiGenerate(prompt, onToken, signal, options.onThinking)
  }
  if (runtime.provider === 'minimax') {
    return compatGenerate('minimax', runtime.model, prompt, onToken, signal, options.onThinking)
  }
  return generate(runtime.port, runtime.model, prompt, onToken, signal, {
    num_ctx: COPILOT_NUM_CTX,
    temperature: COPILOT_TEMPERATURE,
    ...(options.map ? { num_predict: SUMMARY_MAP_MAX_TOKENS } : {}),
  })
}

function memoryGenerate(runtime: ProviderRuntime) {
  return (prompt: string, signal?: AbortSignal) =>
    streamGenerate(runtime, prompt, () => {}, signal ?? new AbortController().signal, { map: true })
}

// Carte de config posée quand le fournisseur cloud n'est pas prêt (chip `config`).
function cloudConfigKind(provider: CopilotProvider): 'openai' | 'minimax' {
  return provider === 'minimax' ? 'minimax' : 'openai'
}

function providerSetupMessage(provider: CopilotProvider): string {
  if (provider === 'openai') {
    return copilot.openAiPreferredAvailable === false
      ? 'Votre compte OpenAI est connecté, mais GPT‑5.6 Luna n’est pas disponible pour cet abonnement.'
      : 'Connectez votre compte OpenAI dans Modèles. La connexion OpenAI se fait sans clé API.'
  }
  if (provider === 'minimax') {
    return copilot.minimaxStatus?.keyRejected
      ? 'La clé MiniMax a été refusée par le service. Reconnectez-la dans Modèles.'
      : 'Connectez votre clé MiniMax dans Modèles pour utiliser ce fournisseur cloud.'
  }
  return 'Choisissez ou téléchargez un modèle local pour utiliser le copilote — tout reste sur votre machine.'
}

const PROVIDER_LABELS: Record<CopilotProvider, string> = {
  ollama: 'Ollama',
  openai: 'OpenAI',
  minimax: 'MiniMax',
}

function generationFailure(error: unknown, provider: CopilotProvider, fallback: string): string {
  if (!isCloudProvider(provider)) return fallback
  // Une clé refusée en cours de session : la carte du fournisseur doit rebasculer
  // (statut honnête) — refresh en arrière-plan, sans bloquer l'affichage de l'erreur.
  if (provider === 'minimax') void refreshMinimaxStatus()
  const detail = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (!detail.trim()) return fallback
  // Pas de « MiniMax : La clé MiniMax… » — le préfixe n'apporte rien si le détail
  // nomme déjà le fournisseur.
  const label = PROVIDER_LABELS[provider]
  return detail.includes(label) ? detail.trim() : `${label} : ${detail.trim()}`
}

// Envoie un message au copilote et streame la réponse (14.1). `doc` = SNAPSHOT du document
// courant capturé À L'ENVOI → un changement d'onglet pendant la génération ne la perturbe pas.
// Anti-TOCTOU : `generating`/`genController` posés SYNCHRONEMENT avant tout `await` (deux
// envois rapprochés ne peuvent pas s'entrelacer). Aucun spawn moteur si pas de modèle actif.
// `scope` (15.3) : 'folder' répond depuis les passages top-k de l'index du dossier.
// Résout le texte d'un PDF à la demande (18.2, service caché 18.1). Renvoie une NOTICE
// honnête (état PERMANENT : scanné, vide, chemin absent — pas de retry, rien à réessayer),
// ou `{ ok:true, text }`. Les erreurs d'extraction TRANSITOIRES (fichier verrouillé/corrompu)
// ne sont PAS avalées ici : elles remontent (throw) au catch appelant → carte `failed` +
// retry. Met à jour `copilot.pdfDoc` pour le badge. `signal` rend l'extraction annulable.
type PdfResolution = { ok: true; text: string } | { ok: false; message: string }

type VisibleDocumentSnapshot = {
  id: number
  name: string
  text: string
  kind: DocKind
  path: string | null
  rev: number
}

function visibleContextKey(): string {
  const current = activeTab()?.id ?? 0
  return `${current}:${visibleTabs().map((tab) => `${tab.id}:${tab.rev}:${tab.content.length}`).join('|')}`
}

function snapshotAutomaticDocuments(): VisibleDocumentSnapshot[] {
  const current = activeTab()?.id
  if (current == null) return []
  return visibleTabs()
    .filter((tab) => tab.id !== current)
    .map((tab) => ({
      id: tab.id,
      name: tab.name,
      text: tab.content,
      kind: tab.kind,
      path: tab.path,
      rev: tab.rev,
    }))
}

function automaticContextItem(doc: VisibleDocumentSnapshot, text: string): CopilotContextItem {
  return {
    id: `workspace:${doc.id}`,
    kind: 'file',
    label: doc.name,
    text,
    charCount: text.length,
    path: doc.path,
    signature: String(doc.rev),
    truncatedAtLoad: false,
  }
}
async function resolvePdfText(
  path: string | null | undefined,
  signal: AbortSignal,
  setStatus: (s: string) => void,
): Promise<PdfResolution> {
  if (!path) return { ok: false, message: "Ce PDF n'a pas de chemin lisible sur le disque." }
  setStatus('Doku-San lit le PDF…')
  const { getPdfText } = await import('./pdf')
  const ex = await getPdfText(path, signal)
  if (!ex) return { ok: false, message: 'Lecture du PDF impossible (fichier illisible ou mode navigateur).' }
  copilot.pdfDoc = { path, charCount: ex.charCount, scanned: ex.scanned }
  if (ex.scanned) {
    return {
      ok: false,
      message:
        "Ce PDF est un document scanné (image) : il ne contient pas de couche texte. Je ne peux pas le lire sans OCR — je préfère te le dire plutôt que d'inventer un contenu.",
    }
  }
  if (!ex.text.trim()) return { ok: false, message: "Je n'ai trouvé aucun texte exploitable dans ce PDF." }
  return { ok: true, text: ex.text }
}

// Même contrat que `resolvePdfText`, pour le DOCX. Sans lui, un `.docx` partait au modèle
// avec `tab.content === ''` — un document nommé mais vide, et RIEN ne le signalait : le
// modèle répondait à côté ou inventait. Un échec doit se dire, comme pour le PDF scanné.
async function resolveDocxText(
  path: string | null | undefined,
  signal: AbortSignal,
  setStatus: (s: string) => void,
): Promise<PdfResolution> {
  if (!path) return { ok: false, message: "Ce document Word n'a pas de chemin lisible sur le disque." }
  setStatus('Doku-San lit le document Word…')
  const [{ extractDocxText, DocxTextError }, { readFileBytes }] = await Promise.all([
    import('./docx-text'),
    import('./tauri'),
  ])
  const bytes = await readFileBytes(path)
  if (signal.aborted) return { ok: false, message: 'Lecture interrompue.' }
  if (!bytes) return { ok: false, message: 'Lecture du document Word impossible (fichier illisible ou mode navigateur).' }
  try {
    const ex = await extractDocxText(bytes, (xml) => new DOMParser().parseFromString(xml, 'application/xml'))
    if (ex.empty) {
      return {
        ok: false,
        message:
          "Ce document Word ne contient aucun texte que je sache lire — il est probablement fait d'images ou de tableaux. Je préfère te le dire plutôt que d'inventer un contenu.",
      }
    }
    return { ok: true, text: ex.text }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof DocxTextError ? error.message : "Ce document Word n'a pas pu être lu.",
    }
  }
}

export async function sendChat(
  question: string,
  doc: { name: string | null; text: string; kind: DocKind; path?: string | null },
  scope: ChatScope = 'doc',
): Promise<void> {
  const q = question.trim()
  if (!q || copilot.generating) return
  const provider = app.copilotProvider
  const localModel = app.activeModel
  // Snapshot synchrone avant tout await : ni retrait ni changement de dossier pendant le
  // streaming ne peut modifier le corpus de cette requête en vol.
  let contextItems = copilot.contextItems.map((item) => ({ ...item }))
  const contextFolder = copilot.contextFolder ? { ...copilot.contextFolder } : null
  const memoryFolder = copilot.memoryFolder ? { ...copilot.memoryFolder } : null
  const contextRevision = copilot.contextRevision
  const automaticDocuments = scope === 'doc' ? snapshotAutomaticDocuments() : []
  const workspaceContextKey = scope === 'doc' ? visibleContextKey() : undefined

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
    // `config` et `notice` écartés aussi : cartes/messages d'UI, pas des tours de dialogue.
    if (m.role === 'assistant' && !m.failed && !m.config && !m.notice && m.content) {
      const prev = copilot.messages[k - 1]
      if (prev?.role === 'user') history.push({ role: 'user', content: prev.content })
      history.push({ role: 'assistant', content: m.content })
    }
  }

  copilot.messages.push({ role: 'user', content: q })
  // `status` couvre le démarrage moteur + le PREFILL (ingestion du doc, longue sur CPU) : sans
  // lui, le skeleton muet se lit comme un blocage. Effacé au 1er token (voir stream ci-dessous).
  copilot.messages.push({
    role: 'assistant',
    content: '',
    streaming: true,
    status: scope === 'folder'
      ? 'Doku-San cherche dans vos notes…'
      : automaticDocuments.length
        ? 'Doku-San lit les documents…'
        : 'Doku-San lit le document…',
  })
  const idx = copilot.messages.length - 1 // index stable (generating sérialise les envois)

  try {
    if (automaticDocuments.length) {
      const automaticItems: CopilotContextItem[] = []
      for (const automatic of automaticDocuments) {
        // Les kinds BINAIRES n'ont pas de `content` : leur texte se lit sur le disque.
        // Tester `!== 'pdf'` laissait le DOCX passer par la branche texte, donc arriver
        // vide au modèle.
        if (!isBinaryKind(automatic.kind)) {
          automaticItems.push(automaticContextItem(automatic, automatic.text))
          continue
        }
        const setStatus = (status: string) => {
          const message = copilot.messages[idx]
          if (message) message.status = status
        }
        const resolved = automatic.kind === 'docx'
          ? await resolveDocxText(automatic.path, signal, setStatus)
          : await resolvePdfText(automatic.path, signal, setStatus)
        if (signal.aborted) return
        if (!resolved.ok) {
          const message = copilot.messages[idx]
          message.content = `Le second document « ${automatic.name} » n’a pas pu rejoindre le contexte. ${resolved.message}`
          message.notice = true
          return
        }
        automaticItems.push(automaticContextItem(automatic, resolved.text))
      }
      contextItems = mergeAutomaticContextItems(automaticItems, contextItems)
    }

    // Documents BINAIRES (PDF 18.2, DOCX depuis) : résoudre le texte AVANT le runtime —
    // un document illisible poste sa notice honnête SANS démarrer le sidecar. Mode
    // dossier : le doc n'est pas utilisé.
    if (scope === 'doc' && isBinaryKind(doc.kind)) {
      const setStatus = (s: string) => { const m = copilot.messages[idx]; if (m) m.status = s }
      const res = doc.kind === 'docx'
        ? await resolveDocxText(doc.path, signal, setStatus)
        : await resolvePdfText(doc.path, signal, setStatus)
      if (signal.aborted) return // Stop pendant l'extraction → annulation propre (finally splice)
      if (!res.ok) {
        if (contextItems.length === 0) {
          copilot.messages[idx].content = res.message
          copilot.messages[idx].notice = true // état permanent (scanné/vide) : ni erreur ni retry
          return
        }
        // Le document principal reste honnêtement signalé comme non extractible par le
        // ContextBuilder, mais une source additionnelle valide peut tout de même répondre.
        doc = { ...doc, text: '' }
        copilot.messages[idx].status = 'Doku-San lit le contexte ajouté…'
      } else doc = { ...doc, text: res.text }
    }
    const runtime = await resolveRuntime(provider, localModel)
    if (runtime === null) {
      const message = copilot.messages[idx]
      if (isCloudProvider(provider)) {
        message.content = providerSetupMessage(provider)
        message.config = cloudConfigKind(provider)
      } else {
        message.content = copilot.error || 'Le moteur IA est indisponible.'
        message.failed = true
        message.retry = { kind: 'chat', question: q, scope, contextRevision, workspaceContextKey }
      }
      return
    }
    const persona = personaFor(runtime)
    let turnMemoryWorkspace: MemoryWorkspace | null = null
    let recalledMemories: MemoryPromptSource[] = []
    if (isCloudProvider(runtime.provider) && app.cloudMemoryEnabled && isTauri) {
      if (memoryFolder && pathBelongsToFolder(doc.path, memoryFolder.path)) {
        turnMemoryWorkspace = await memoryWorkspace(memoryFolder.path, memoryFolder.label, 'folder')
      } else if (doc.path) {
        turnMemoryWorkspace = await memoryWorkspace(doc.path, doc.name ?? baseName(doc.path), 'document')
      }
      if (turnMemoryWorkspace) {
        const message = copilot.messages[idx]
        if (message && !message.content) message.status = 'Doku-San retrouve le fil du travail…'
        recalledMemories = await recallCloudMemories(q, turnMemoryWorkspace, memoryGenerate(runtime), signal)
        if (signal.aborted) return
        if (message && !message.content) {
          message.status = scope === 'folder' ? 'Doku-San cherche dans vos notes…' : 'Doku-San lit le document…'
        }
      }
    }
    let messages: OllamaMessage[]
    let sources: CitedPassage[] | null = null
    let wholeDoc = false
    let bundle: ContextBundle | null = null
    if (scope === 'folder') {
      const prep = await prepareFolderMessages(
        q, history, persona, runtime, signal, idx, contextItems,
        contextFolder?.path ?? app.explorerDir ?? parentPath(doc.path ?? null),
        contextRevision,
        recalledMemories,
      )
      if (!prep) return // question soldée (carte config / message d'info posé sur idx)
      messages = prep.messages
      sources = prep.sources
      bundle = prep.bundle
    } else {
      const prep = await prepareDocMessages(q, doc, history, persona, runtime, signal, idx, contextItems, recalledMemories)
      messages = prep.messages
      sources = prep.sources
      wholeDoc = prep.wholeDoc ?? false
      bundle = prep.bundle
    }
    // num_ctx fixé (14.3) : le doc + la consigne d'ancrage doivent rester en contexte sur plusieurs
    // tours ; au défaut Ollama (4096) l'historique les évincerait par troncature gauche silencieuse.
    // Mutation via l'index (élément proxifié du $state array) → réactif ; muter la ref locale
    // poussée ne le serait PAS (piège $state profond de Svelte 5).
    await streamChat(
      runtime,
      applyVerbosity(messages, app.copilotVerbosity),
      (t) => {
        const m = copilot.messages[idx]
        m.status = undefined // 1er token : le prefill est fini, le texte prend le relais
        m.content += t
      },
      signal,
      () => {
        // Réflexion cloud : efface « lit le document… » — les points chorégraphiés seuls
        // portent l'attente (pas de texte redondant). Jamais après le 1er token.
        const m = copilot.messages[idx]
        if (m && m.streaming && !m.content) m.status = undefined
      },
    )
    // Pied « Passages consultés » déterministe (15.3) — supprimé sur refus : des sources
    // cliquables sous « je ne trouve pas » seraient trompeuses. Sans `sources` posées,
    // les marqueurs [n] éventuels de la réponse sont retirés au rendu (count = 0).
    const done = copilot.messages[idx]
    // Provenance capturée MAINTENANT (pas au clic « Sauver en note » : l'onglet actif
    // aura pu changer). Nom du doc même sans sources (petit doc, réponse libre).
    if (done?.content && !done.failed) {
      const labels = bundle?.sentSources.filter((source) => !source.primary).map((source) => source.label) ?? []
      const principal = bundle?.primary.length
        ? (scope === 'folder' ? 'les notes du dossier' : (doc.name ?? undefined))
        : undefined
      done.sourceLabel = [principal, ...labels].filter(Boolean).join(' + ') || undefined
      done.contextSources = bundle?.sentSources.filter((source) => !source.primary)
      done.memorySources = recalledMemories
    }
    if (
      sources &&
      done?.content &&
      !done.content.includes(FOLDER_REFUSAL_PHRASE) &&
      !done.content.includes(DOC_INDEX_REFUSAL_PHRASE) &&
      !(wholeDoc && done.content.includes(REFUSAL_PHRASE))
    ) {
      done.sources = sources
      if (wholeDoc) {
        // Document complet : le pied n'affiche que les extraits que la réponse cite
        // vraiment (les sources = tout le document — la liste entière serait du bruit).
        done.citedOnly = true
        done.cited = citedNumbers(done.content, sources.length)
      }
    }
    if (
      done?.content && !done.failed && !done.notice && turnMemoryWorkspace &&
      isCloudProvider(runtime.provider) && app.cloudMemoryEnabled
    ) {
      queueMemoryExtraction({
        question: q,
        answer: done.content,
        documentName: doc.name,
        workspace: turnMemoryWorkspace,
        provider: runtime.provider as CloudMemoryProvider,
        generate: memoryGenerate(runtime),
      })
    }
  } catch (e) {
    // Stop pendant la récupération (embed de la requête / du doc) : annulation propre —
    // le finally retire le tour fantôme, pas de carte d'erreur (chat() avale déjà ses aborts).
    if (signal.aborted) return
    console.error('[copilot] chat', e)
    const msg = e instanceof Error ? e.message : String(e)
    if (/^embed 404/i.test(msg)) {
      // Le modèle d'EMBEDDING a disparu (supprimé en cours de session) : carte config, pas erreur.
      copilot.messages[idx].content = "Le modèle d'embedding n'est plus installé."
      copilot.messages[idx].config = 'embed'
      return
    }
    copilot.messages[idx].content = copilot.messages[idx].content || generationFailure(e, provider, 'La génération a échoué. Vérifiez que le moteur est prêt, puis réessayez.')
    copilot.messages[idx].failed = true
    copilot.messages[idx].retry = { kind: 'chat', question: q, scope, contextRevision, workspaceContextKey }
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

// Saut vers un passage cité (puces [n] / pied « Passages consultés ») : ouvre la note si
// besoin puis révèle le passage exact (pendingReveal → revealMatch, flash inclus — même
// chemin que la recherche 9.4). PDF : précision à la PAGE (le viewer canvas n'a pas de
// grain plus fin) — passage → offset dans le texte extrait → page → scroll + halo.
// Passage introuvable (fichier modifié depuis l'indexation) : on s'arrête à l'ouverture
// du fichier — jamais de faux surlignage (FR-4 s'applique aussi à l'UI).
export async function jumpToCitation(s: CitedPassage): Promise<void> {
  if (s.path) {
    await openPath(s.path)
    const tab = activeTab()
    if (!tab || tab.path !== s.path) return
    if (tab.kind === 'pdf') {
      // getPdfText est caché par chemin : la Q&A vient de faire l'extraction → hit direct.
      const [{ getPdfText }, { pageForOffset }] = await Promise.all([import('./pdf'), import('./pdf-text')])
      const ex = await getPdfText(s.path).catch(() => null)
      if (!ex || ex.scanned) return
      const hit = locateOffset(ex.text, s.text)
      if (!hit) return
      const page = pageForOffset(ex.pageStarts, hit.index)
      if (page) app.pendingPdfReveal = { path: s.path, page, text: s.text }
      return
    }
    const loc = locatePassage(tab.content, s.text)
    if (loc) app.pendingReveal = { path: s.path, line: loc.line, col: loc.col, length: loc.length, select: false }
    return
  }
  // Document sans chemin (non enregistré) : l'onglet est déjà actif, révélation directe.
  const tab = activeTab()
  const view = activeEditorView()
  if (!tab || tab.kind === 'pdf' || !view) return
  const loc = locatePassage(tab.content, s.text)
  if (loc) {
    const { revealMatch } = await import('./editor/search-flash')
    revealMatch(view, loc.line, loc.col, loc.length, { select: false })
  }
}

// Une recherche dossier est-elle en vol ? stopChat s'en sert pour annuler AUSSI un
// refresh d'index inline (le signal du chat ne couvre que l'embed de la requête).
let folderSearching = false

// Prépare les messages du mode « dossier » (15.3) : garde-fous embeddings puis passages
// top-k de l'index du dossier. Renvoie null quand la question est déjà soldée (carte
// config ou message d'info posé sur la bulle idx). Le PREMIER index complet d'un dossier
// n'est JAMAIS lancé ici (buildIfMissing:false — des minutes d'embed n'ont pas leur
// place derrière une question) : il se lance depuis la vue Modèles.
async function prepareFolderMessages(
  q: string,
  history: ChatTurn[],
  persona: PersonaProfile,
  runtime: ProviderRuntime,
  signal: AbortSignal,
  idx: number,
  additions: readonly CopilotContextItem[],
  dir: string | null,
  contextRevision: number,
  memories: readonly MemoryPromptSource[],
): Promise<{ messages: OllamaMessage[]; sources: CitedPassage[]; bundle: ContextBundle } | null> {
  const answer = (content: string, config?: ChatMsg['config']): null => {
    const m = copilot.messages[idx]
    m.content = content
    if (config) m.config = config
    else m.notice = true // info d'app : jamais rejouée au modèle comme historique
    return null
  }
  const fail = (content: string): null => {
    const m = copilot.messages[idx]
    m.content = content
    m.failed = true
    m.retry = { kind: 'chat', question: q, scope: 'folder', contextRevision }
    return null
  }
  const additionsOnly = (): { messages: OllamaMessage[]; sources: CitedPassage[]; bundle: ContextBundle } | null => {
    if (additions.length === 0) return null
    const maxChars = isCloudProvider(runtime.provider) ? MAX_DOC_CHARS_CLOUD : MAX_DOC_CHARS
    const bundle = buildContextBundle({ primary: [], additions, maxChars })
    return {
      messages: buildChatMessages({
        docName: null,
        docText: '',
        kind: 'txt',
        history,
        question: q,
        persona,
        maxChars: 0,
        additions: bundle.additions,
        memories,
      }),
      sources: [],
      bundle,
    }
  }
  if (!dir) return additionsOnly() ?? answer("Ouvrez un document enregistré ou fixez un dossier dans l'explorateur pour interroger vos notes.")
  // Les embeddings sont TOUJOURS locaux (0 réseau), même quand le chat est OpenAI.
  const port = runtime.provider === 'ollama' ? runtime.port : await ensureReady()
  if (port === null) return additionsOnly() ?? fail(copilot.error || 'Le moteur IA est indisponible.')
  // Liste des modèles pas encore chargée (vue Modèles jamais ouverte) : la rafraîchir AVANT
  // de conclure « modèle absent ». MÊME prédicat que le badge du panneau (repli sur le
  // défaut quand le réglage est effacé) — badge et comportement ne divergent jamais.
  if (copilot.models.length === 0) await refreshModels()
  const em = app.embedModel || DEFAULT_EMBED_MODEL
  const installed = copilot.models.some((m) => m.name === em || m.name === `${em}:latest`)
  if (!installed) return additionsOnly() ?? answer("Le mode dossier a besoin d'un modèle d'embedding local.", 'embed')
  folderSearching = true
  let hits: RagHit[] | null
  try {
    hits = await searchRag(port, em, dir, q, RAG_TOP_K, { signal, buildIfMissing: false })
  } finally {
    folderSearching = false
  }
  if (hits === null) {
    return additionsOnly() ?? answer('Ce dossier n’est pas encore indexé. Lancez l’indexation dans Modèles → « Index du dossier », puis reposez votre question.')
  }
  if (hits.length === 0) {
    // [] recouvre trois réalités distinctes — les distinguer via ragState (un refresh
    // échoué NE rejette PAS) : modèle manquant / indexation échouée / index réellement vide.
    if (ragState.needsModel) return additionsOnly() ?? answer(`Modèle « ${ragState.needsModel} » non installé.`, 'embed')
    if (ragState.error) return additionsOnly() ?? fail(ragState.error)
    return additionsOnly() ?? answer("L'index de ce dossier est vide — aucune note indexable n'y a été trouvée.")
  }
  const maxChars = isCloudProvider(runtime.provider) ? MAX_DOC_CHARS_CLOUD : MAX_DOC_CHARS
  const bundle = buildContextBundle({
    primary: hits.map((h, index) => ({
      id: `rag:${index}`,
      kind: 'rag',
      label: noteTitle(h.name),
      text: h.text,
      path: h.path,
    })),
    additions,
    maxChars,
  })
  const packedHits = bundle.primary.map((source) => ({
    source,
    hit: hits[Number.parseInt(source.id.slice(4), 10)],
  })).filter((entry) => entry.hit)
  return {
    messages: buildFolderChatMessages({
      passages: packedHits.map(({ source }) => ({ name: source.label, text: source.text })),
      history,
      question: q,
      persona,
      additions: bundle.additions,
      memories,
    }),
    // Numérotation = ordre des extraits DANS le prompt (buildFolderChatMessages les
    // numérote dans ce même ordre) : la puce [n] retombe sur le bon chunk.
    sources: packedHits.map(({ source, hit }, i) => ({ n: i + 1, path: hit.path, name: source.label, text: source.text })),
    bundle,
  }
}

// Messages du mode « document » : au-delà de MAX_DOC_CHARS avec embeddings locaux
// disponibles, le doc ENTIER est interrogé via l'index éphémère (15.3 — solde la lecture
// partielle de 14.3) ; sinon comportement 14.3 inchangé (troncature signalée). Fournisseur
// OpenAI : troncature 14.3 conservée — pas de spawn du sidecar local en douce pour un
// utilisateur qui a choisi le cloud.
async function prepareDocMessages(
  q: string,
  doc: { name: string | null; text: string; kind: DocKind; path?: string | null },
  history: ChatTurn[],
  persona: PersonaProfile,
  runtime: ProviderRuntime,
  signal: AbortSignal,
  idx: number,
  additions: readonly CopilotContextItem[],
  memories: readonly MemoryPromptSource[],
): Promise<{ messages: OllamaMessage[]; sources: CitedPassage[] | null; wholeDoc?: boolean; bundle: ContextBundle }> {
  const docBudget = isCloudProvider(runtime.provider) ? MAX_DOC_CHARS_CLOUD : MAX_DOC_CHARS
  // Le texte d'un PDF est désormais résolu en amont (18.2) → un gros PDF passe AUSSI par
  // l'index éphémère (plus de garde `kind !== 'pdf'`).
  if (runtime.provider === 'ollama' && doc.text.length > MAX_DOC_CHARS) {
    if (copilot.models.length === 0) await refreshModels()
    const em = app.embedModel || DEFAULT_EMBED_MODEL // même repli que le badge du panneau
    const installed = copilot.models.some((m) => m.name === em || m.name === `${em}:latest`)
    if (installed) {
      const m = copilot.messages[idx]
      if (m) m.status = 'Doku-San parcourt tout le document…'
      // Clé issue du SNAPSHOT (doc.path), pas de activeTab() live : un changement d'onglet
      // pendant l'extraction/index ne lie pas le cache à un autre document.
      const key = doc.path ?? doc.name ?? 'document'
      const { hits, truncated } = await searchDocEphemeral(
        runtime.port,
        em,
        key,
        noteTitle(doc.name ?? 'document'),
        doc.text,
        q,
        RAG_TOP_K,
        signal,
      )
      if (hits.length > 0) {
        const bundle = buildContextBundle({
          primary: hits.map((hit, index) => ({
            id: `doc-rag:${index}`,
            kind: 'rag',
            label: doc.name ?? 'document',
            text: hit.text,
            path: doc.path,
          })),
          additions,
          maxChars: docBudget,
        })
        const packedHits = bundle.primary.map((source) => ({
          source,
          hit: hits[Number.parseInt(source.id.slice('doc-rag:'.length), 10)],
        })).filter((entry) => entry.hit)
        return {
          messages: buildDocIndexChatMessages({
            docName: doc.name,
            passages: packedHits.map(({ source }) => ({ text: source.text })),
            history,
            question: q,
            persona,
            indexTruncated: truncated,
            additions: bundle.additions,
            memories,
          }),
          // `name` null : les puces du même document n'affichent que leur numéro. Le saut
          // vers un PDF s'arrête à l'onglet (pas de surlignage dans le viewer) — assumé.
          sources: packedHits.map(({ source }, i) => ({ n: i + 1, path: doc.path ?? null, name: null, text: source.text })),
          bundle,
        }
      }
    }
  }
  // Document qui tient dans le budget du FOURNISSEUR : fourni EN ENTIER, découpé en
  // extraits numérotés (chunkText, déterministe — aucun embedding) → citations [n] pour
  // tous les fournisseurs. Budget local = 12k (num_ctx 16384, au-delà l'index éphémère a
  // déjà pris la main ci-dessus) ; budget cloud = 240k (fenêtre 128k tokens d'OpenAI —
  // le plafond local y tronquait un PDF de 5 pages, vu en usage réel ; MiniMax M2.x =
  // 204k tokens, M3 = 1M : le même plafond tient largement).
  const bundle = buildContextBundle({
    primary: [{ id: 'document', kind: 'document', label: doc.name ?? 'sans titre', text: doc.text, path: doc.path }],
    additions,
    maxChars: docBudget,
  })
  const packedDoc = bundle.primary[0]?.text ?? ''
  const principalComplete = packedDoc.length === doc.text.length
  if (packedDoc.trim() && principalComplete) {
    const { chunks, truncated } = chunkText(packedDoc)
    // `truncated` (plafond de chunks) contredirait le « EN ENTIER » du prompt : dans ce
    // cas improbable (≤ 240k mais > 300 chunks), on retombe sur la troncature signalée.
    if (chunks.length > 0 && !truncated) {
      return {
        messages: buildCitedDocChatMessages({ docName: doc.name, chunks, history, question: q, persona, additions: bundle.additions, memories }),
        sources: chunks.map((text, i) => ({ n: i + 1, path: doc.path ?? null, name: null, text })),
        wholeDoc: true,
        bundle,
      }
    }
  }
  // Restants : document vide / PDF sans texte (messages dédiés du ContextBuilder), et
  // document au-delà du budget cloud (troncature SIGNALÉE 14.3, au budget du fournisseur).
  return {
    messages: buildChatMessages({
      docName: doc.name,
      docText: doc.text,
      kind: doc.kind,
      history,
      question: q,
      persona,
      maxChars: packedDoc.length,
      additions: bundle.additions,
      memories,
    }),
    sources: null,
    bundle,
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
  doc: { name: string | null; text: string; kind: DocKind; path?: string | null },
  mode: SummaryMode = 'summary',
): Promise<void> {
  if (copilot.generating) return
  const provider = app.copilotProvider
  const localModel = app.activeModel
  const userLabel =
    mode === 'keypoints'
      ? 'Quels sont les points clés de ce document ?'
      : mode === 'todos'
        ? 'Quelles sont les actions à faire selon ce document ?'
        : 'Résume ce document.'
  const reply = (content: string, flags: { failed?: boolean; config?: ChatMsg['config'] } = {}) => {
    copilot.messages.push({ role: 'user', content: userLabel })
    copilot.messages.push({ role: 'assistant', content, ...flags })
  }

  // Garde modèle : carte de CONFIG sans démarrer le sidecar (préserve le boot-safety 14.0).
  if (provider === 'ollama' && !localModel) {
    reply(providerSetupMessage(provider), { config: 'model' })
    return
  }
  // Doc texte vide → message clair (FR-4). Un PDF a `text=''` avant extraction : sa vacuité
  // se juge APRÈS résolution (plus bas), pas ici.
  if (doc.kind !== 'pdf' && !doc.text.trim()) {
    reply("Ce document est vide — il n'y a rien à résumer.")
    return
  }

  copilot.generating = true
  genController = new AbortController()
  const signal = genController.signal
  // Extraits numérotés du résumé cité (single-fenêtre) — attachés au message en fin de
  // run, comme les sources du chat.
  let citedSources: CitedPassage[] | null = null

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
  // Réflexion cloud (streamGenerate final/single-window) : efface le statut — les points
  // chorégraphiés seuls portent l'attente. Pas branché sur la phase map — sa progression
  // « partie i/n » est plus informative.
  const onThinking = () => {
    const m = copilot.messages[idx]
    if (m && m.streaming && !m.content) m.status = undefined
  }

  try {
    // PDF (18.2) : résoudre le texte AVANT le runtime — un PDF scanné/illisible poste sa
    // notice honnête (pas de faux résumé, FR-4) sans démarrer le sidecar.
    if (doc.kind === 'pdf') {
      const res = await resolvePdfText(doc.path, signal, (s) => setStatus(s))
      if (signal.aborted) return
      if (!res.ok) {
        copilot.messages[idx].content = res.message
        copilot.messages[idx].notice = true
        return
      }
      doc = { ...doc, text: res.text }
    }

    const runtime = await resolveRuntime(provider, localModel)
    if (runtime === null) {
      const m = copilot.messages[idx]
      if (isCloudProvider(provider)) {
        m.content = providerSetupMessage(provider)
        m.config = cloudConfigKind(provider)
      } else {
        m.content = copilot.error || 'Le moteur IA est indisponible.'
        m.failed = true
        m.retry = { kind: 'summary', mode }
      }
      return
    }

    // Fenêtre de segmentation au budget du FOURNISSEUR (même logique que le chat) : le
    // cloud avale un document entier en une passe — segmenter à la taille locale (14k,
    // calibrée num_ctx Ollama) déclenchait un map-reduce séquentiel (« partie 1/5 ») de
    // plusieurs appels réseau pour un simple PDF de 5 pages.
    const segMax = isCloudProvider(runtime.provider) ? MAX_DOC_CHARS_CLOUD : SEGMENT_CHARS
    const segments = segmentDoc(doc.text, segMax)
    const persona = personaFor(runtime)
    // Style des réponses : appliqué aux prompts FINAUX seulement (une passe map/reduce
    // « brève » perdrait de l'information avant la synthèse).
    const vNote = verbosityNote(app.copilotVerbosity)
    const styled = (p: string) => (vNote ? `${p}\n\n${vNote}` : p)
    if (segments.length <= 1) {
      // Tient dans une fenêtre → résumé CITÉ : le doc part en extraits numérotés (même
      // mécanique que le chat 21.x) pour que les actions rapides ancrent leurs [n].
      // Repli sans citations si le découpage plafonne (truncated contredirait « EN ENTIER »).
      const { chunks, truncated } = chunkText(doc.text)
      if (chunks.length > 0 && !truncated) {
        citedSources = chunks.map((text, i) => ({ n: i + 1, path: doc.path ?? null, name: null, text }))
        await streamGenerate(runtime, styled(buildCitedSummaryPrompt(chunks, doc.name, mode, persona)), stream, signal, { onThinking })
      } else {
        await streamGenerate(runtime, styled(buildWholeSummaryPrompt(doc.text, doc.name, mode, persona)), stream, signal, { onThinking })
      }
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
      while (segmentDoc(joined, segMax).length > 1 && passes < MAX_REDUCE_PASSES) {
        setStatus('Synthèse en cours…')
        const groups = segmentDoc(joined, segMax)
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
      const finalGroups = segmentDoc(joined, segMax)
      for (let i = 0; i < finalGroups.length; i++) {
        if (i > 0) copilot.messages[idx].content += '\n\n'
        await streamGenerate(runtime, styled(buildReduceSummaryPrompt(finalGroups[i], doc.name, mode, persona)), stream, signal, { onThinking })
        if (signal.aborted) return
      }
    }
  } catch (e) {
    // Stop pendant l'extraction PDF → annulation propre : extractPdfText LÈVE l'AbortError
    // (contrairement à chat()/generate() qui l'avalent), il faut donc le même garde que
    // sendChat sinon une annulation afficherait une carte d'échec rouge (finally splice).
    if (signal.aborted) return
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
      // Provenance du résumé (pour « Sauver en note ») — capturée ici, pas au clic.
      if (m.content && !m.failed) {
        m.sourceLabel = doc.name ?? undefined
        // Résumé cité : mêmes règles que le chat document-complet — sources attachées,
        // pied filtré sur les extraits réellement cités par la réponse.
        if (citedSources) {
          m.sources = citedSources
          m.citedOnly = true
          m.cited = citedNumbers(m.content, citedSources.length)
        }
      }
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
  // Consigne libre (mode `custom`), déjà normalisée — vide pour les six verbes. Portée par le
  // run parce que « Réessayer » doit rejouer LA MÊME consigne, même si le champ a été vidé.
  instruction: string
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
export async function rephraseSelection(mode: RephraseMode, instruction = ''): Promise<void> {
  if (copilot.generating || rephrase.current) return
  // Consigne libre vide = pas de tâche : ne jamais partir en génération avec un prompt qui ne
  // demande rien (le modèle rendrait le passage tel quel, ou broderait).
  const consigne = mode === 'custom' ? normalizeInstruction(instruction) : ''
  if (mode === 'custom' && !consigne) return
  const view = activeEditorView()
  if (!view) return
  const sel = view.state.selection.main
  if (sel.empty) return
  let from = sel.from
  let to = sel.to
  // Modes structurels : étendre aux frontières de ligne — une liste « - [ ] … » insérée
  // en milieu de ligne casserait le Markdown (le reste de la ligne collerait à la puce).
  // PAS pour une consigne libre : on ne sait pas ce qu'elle produit, et avaler la fin d'une
  // ligne que l'utilisateur n'avait pas sélectionnée serait une surprise, fût-elle annulable.
  if (mode === 'bullets' || mode === 'tasks') {
    from = view.state.doc.lineAt(from).from
    to = view.state.doc.lineAt(to).to
  }
  await runRephrase({
    tabId: app.activeId,
    from,
    to,
    original: view.state.sliceDoc(from, to),
    mode,
    instruction: consigne,
  })
}

async function runRephrase(params: {
  tabId: number
  from: number
  to: number
  original: string
  mode: RephraseMode
  instruction: string
}): Promise<void> {
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
      if (isCloudProvider(provider)) {
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
      buildRephrasePrompt(params.original, params.mode, personaFor(runtime), params.instruction),
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
  const view = activeEditorView()
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
  const { tabId, from, to, original, mode, instruction } = cur
  rephrase.current = null
  void runRephrase({ tabId, from, to, original, mode, instruction })
}

// --- Correction d'une page de PDF par consigne (spike) --------------------------------------
// Le modèle reçoit la liste FERMÉE des lignes éditables d'une page et rend des patchs ciblés
// à l'intérieur d'elles (`pdf-correction.ts` porte tout le contrat et ses gardes). Ici, la
// mécanique de génération, calquée sur `runRephrase`.
//
// Le run porte un JETON `{path, page, revision}` : la modale peut changer de page, se fermer,
// se rouvrir sur un AUTRE document, et ses octets changent à chaque application. Une
// proposition dont le jeton ne correspond plus n'est pas appliquée — elle viserait des lignes
// que l'utilisateur n'a jamais soumises.
/** Identité d'une ligne soumise, telle que le moteur d'écriture l'exige. */
export interface CorrectionTarget {
  page: number
  occurrence: number
  text: string
}

export interface PdfCorrectionRun {
  id: number
  path: string
  page: number
  revision: number
  instruction: string
  /**
   * La liste FERMÉE réellement soumise, portée PAR LE RUN.
   *
   * Les index rendus par le modèle se résolvaient d'abord contre une variable du composant.
   * Un remontage de la modale — ou n'importe quel chemin où le run survit à son composant —
   * la vidait, et l'application plantait sur un `undefined`. L'index n'a de sens que par
   * rapport à la liste qui l'a produit : les deux voyagent donc ensemble.
   */
  targets: CorrectionTarget[]
  edits: PdfEdit[]
  dropped: DroppedEdit[]
  phase: 'streaming' | 'ready' | 'error' | 'config'
  error: string
}

export const pdfCorrection = $state({ current: null as PdfCorrectionRun | null })
let pdfCorrectionSeq = 0

export async function correctPdfPage(params: {
  path: string
  page: number
  revision: number
  instruction: string
  lines: CorrectableLine[]
  /** Géométrie de TOUTES les lignes de la page, éditables ou non — mesure de la place. */
  geometry: CorrectableLine[]
  targets: CorrectionTarget[]
}): Promise<void> {
  if (copilot.generating || pdfCorrection.current) return
  const consigne = normalizeInstruction(params.instruction)
  if (!consigne || !params.lines.length) return
  const provider = app.copilotProvider
  const id = ++pdfCorrectionSeq
  copilot.generating = true
  genController = new AbortController()
  const signal = genController.signal
  pdfCorrection.current = {
    id,
    path: params.path,
    page: params.page,
    revision: params.revision,
    instruction: consigne,
    targets: params.targets,
    edits: [],
    dropped: [],
    phase: 'streaming',
    error: '',
  }

  try {
    // Cloud EXIGÉ : le modèle local retenu pour Doku (`qwen2.5:1.5b-instruct-q4_0`) est un
    // « gadget discret », il ne tient pas une sortie structurée sur 100 lignes. Le dire
    // plutôt que de laisser l'utilisateur découvrir une réponse illisible.
    if (!isCloudProvider(provider)) {
      const cur = pdfCorrection.current
      if (cur?.id === id) {
        cur.phase = 'config'
        cur.error = 'La correction par consigne demande un fournisseur cloud — choisissez OpenAI ou MiniMax dans Modèles.'
      }
      return
    }
    const runtime = await resolveRuntime(provider, app.activeModel)
    let cur = pdfCorrection.current
    if (cur?.id !== id) return
    if (runtime === null) {
      cur.phase = 'config'
      cur.error = providerSetupMessage(provider)
      return
    }
    const raw = await streamGenerate(
      runtime,
      buildPdfCorrectionPrompt(params.lines, consigne),
      () => {},
      signal,
    )
    cur = pdfCorrection.current
    if (cur?.id !== id) return
    if (signal.aborted) {
      pdfCorrection.current = null
      return
    }
    const { edits, dropped } = parsePdfCorrections(raw, params.lines, params.geometry)
    cur.edits = edits
    cur.dropped = dropped
    cur.phase = 'ready'
  } catch (e) {
    console.error('[copilot] correction pdf', e)
    const cur = pdfCorrection.current
    if (cur?.id !== id) return
    if (signal.aborted) {
      pdfCorrection.current = null
      return
    }
    cur.phase = 'error'
    cur.error = generationFailure(e, provider, 'La correction a échoué. Réessayez, ou changez de fournisseur.')
  } finally {
    copilot.generating = false
    genController = null
  }
}

// Écarte le run. Appelée au démontage de la modale : l'état vit dans CE module, pas dans le
// composant — sans cet appel, une proposition périmée survivrait à la fermeture et
// s'appliquerait d'un clic à la réouverture, sur un autre document.
export function cancelPdfCorrection(): void {
  const cur = pdfCorrection.current
  if (!cur) return
  if (cur.phase === 'streaming') genController?.abort()
  pdfCorrection.current = null
}

// Rejoue une génération échouée (bouton « Réessayer » de la carte d'erreur). Retire la paire
// échouée (question + carte) puis re-dispatche l'action d'origine avec un SNAPSHOT FRAIS du
// document courant — l'utilisateur a pu corriger la cause (moteur redémarré, doc modifié).
export function retryGeneration(idx: number): void {
  const m = copilot.messages[idx]
  if (!m?.retry || copilot.generating) return
  const r = m.retry
  if (r.kind === 'chat' && r.contextRevision !== copilot.contextRevision) {
    m.content = 'Le contexte a changé — renvoyez la question pour utiliser les sources actuellement affichées.'
    m.failed = false
    m.notice = true
    m.retry = undefined
    return
  }
  if (r.kind === 'chat' && r.workspaceContextKey && r.workspaceContextKey !== visibleContextKey()) {
    m.content = 'Les documents visibles ont changé — renvoyez la question pour utiliser les deux volets actuellement affichés.'
    m.failed = false
    m.notice = true
    m.retry = undefined
    return
  }
  copilot.messages.splice(idx - 1, 2)
  const t = activeTab()
  const doc = { name: t?.name ?? null, text: t?.content ?? '', kind: t?.kind ?? ('md' as DocKind), path: t?.path ?? null }
  if (r.kind === 'chat') void sendChat(r.question, doc, r.scope)
  else void summarizeDoc(doc, r.mode)
}

// Interrompt la génération en cours (abort → texte partiel conservé, < 500 ms côté serveur).
export function stopChat(): void {
  genController?.abort()
  // Stop pendant une recherche dossier : annule aussi le refresh d'index inline en cours
  // (son travail d'embed déjà accompli est conservé — checkpoints 15.2).
  if (folderSearching) cancelRagIndexing()
}

// Sauve une réponse de Doku-San en note .md dans le dossier courant (même résolution que
// le mode dossier). Nom dérivé de la question qui précède ; conflit de nom → suffixes
// « (2) »… via l'écriture `createNew` (échec atomique côté OS si le nom est pris).
// Succès : explorateur rafraîchi + note ouverte. null = échec (l'appelant DOIT le dire —
// jamais de bouton muet). La note devient un fichier ordinaire : indexable, citable.
export async function saveMessageAsNote(msg: ChatMsg): Promise<string | null> {
  if (!isTauri || copilot.savingNote) return null
  const dir = app.explorerDir ?? parentPath(activeTab()?.path ?? null)
  if (!dir) return null
  copilot.savingNote = true
  try {
    const i = copilot.messages.indexOf(msg)
    const prev = i > 0 ? copilot.messages[i - 1] : undefined
    const question = prev?.role === 'user' ? prev.content : null
    const sourceNames = msg.sources?.map((s) => s.name).filter((n): n is string => !!n)
    const content = noteContent(msg.content, {
      sourceLabel: msg.sourceLabel ?? null,
      date: new Date(),
      sourceNames,
    })
    for (let attempt = 1; attempt <= 30; attempt++) {
      const path = joinPath(dir, noteFileName(question, attempt))
      if (await createFileWithContent(path, content)) {
        refreshExplorer()
        await openPath(path)
        return path
      }
    }
    return null
  } catch (e) {
    console.error('[copilot] note', e)
    return null
  } finally {
    copilot.savingNote = false
  }
}

// Nouvelle conversation : annule d'abord une génération en cours, puis vide l'historique.
export function newChat(): void {
  genController?.abort()
  copilot.messages = []
  copilot.contextItems = []
  copilot.contextFolder = null
  copilot.contextError = ''
  copilot.contextRevision = 0
  copilot.scope = 'doc'
}

// Crochet DEV uniquement (vérifications navigateur/Playwright : injecter un message,
// déclencher un saut de citation). import.meta.env.DEV = false en prod → code mort éliminé.
if (import.meta.env.DEV) {
  ;(globalThis as Record<string, unknown>).__dokuCopilot = { copilot, jumpToCitation }
  const demoParams = new URLSearchParams(globalThis.location?.search ?? '')
  if (demoParams.has('memory-demo')) {
    app.copilotProvider = 'openai'
    app.copilotView = 'memory'
  }
  if (demoParams.has('citation-demo')) {
    const tab = activeTab()
    const text = tab?.content.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length >= 24)
      ?? 'Ce document sert de démonstration au rendu WYSIWYG de Doku.'
    copilot.messages = [{
      role: 'assistant',
      content: 'Voici le passage demandé [1].',
      sources: [{ n: 1, path: null, name: null, text }],
    }]
  }
}
