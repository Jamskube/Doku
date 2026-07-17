// État runtime du copilote (13.4, réutilisé par 14.1) — éphémère, `$state` module-level
// (même motif que `app` dans stores.svelte.ts). Le port du sidecar est stable (start_ollama
// idempotent côté Rust) → on le cache ; `ensureReady` déduplique les appels concurrents
// (motif indexBuild de la recherche). Le modèle ACTIF (persisté) vit dans `app.activeModel`.
import { activeTab, app, editorRef, editorSel, type DocKind } from './stores.svelte'
import { chat, deleteModel, generate, listModels, pull, startOllama, waitReady, type OllamaModel } from './ollama'
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
  config?: boolean
  status?: string
  // Posé sur une carte `failed` : ce qu'il faut rejouer pour « Réessayer » (la question, le mode
  // de résumé ou la variante de reformulation). Le document est re-capturé au moment du retry.
  retry?: { kind: 'chat'; question: string } | { kind: 'summary'; mode: SummaryMode } | { kind: 'rephrase'; mode: RephraseMode }
  // Reformulation (16.1) : proposition liée à une sélection de l'éditeur. `state` pilote les
  // boutons Accepter/Refuser ; `tabId` + `from/to/original` appliquent le remplacement ET
  // détectent une cible périmée — mauvais onglet OU doc modifié entre-temps (`stale` → on n'écrit
  // rien, zéro perte). L'éditeur CM6 étant PARTAGÉ entre onglets, `tabId` est indispensable :
  // sans lui, accepter après un changement d'onglet réécrirait le mauvais document.
  rephrase?: { tabId: number; from: number; to: number; original: string; state: 'pending' | 'applied' | 'rejected' | 'stale' }
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
    if (!app.activeModel && installed) app.activeModel = installed.name
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

  // Garde modèle : carte de CONFIG sans démarrer le sidecar (préserve le boot-safety 14.0).
  if (!app.activeModel) {
    copilot.messages.push({ role: 'user', content: q })
    copilot.messages.push({
      role: 'assistant',
      content: 'Choisissez ou téléchargez un modèle pour utiliser le copilote — tout reste sur votre machine.',
      config: true,
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
    const p = await ensureReady()
    if (p === null) {
      copilot.messages[idx].content = copilot.error || 'Le moteur IA est indisponible.'
      copilot.messages[idx].failed = true
      copilot.messages[idx].retry = { kind: 'chat', question: q }
      return
    }
    const messages = buildChatMessages({ docName: doc.name, docText: doc.text, kind: doc.kind, history, question: q })
    // num_ctx fixé (14.3) : le doc + la consigne d'ancrage doivent rester en contexte sur plusieurs
    // tours ; au défaut Ollama (4096) l'historique les évincerait par troncature gauche silencieuse.
    // Mutation via l'index (élément proxifié du $state array) → réactif ; muter la ref locale
    // poussée ne le serait PAS (piège $state profond de Svelte 5).
    await chat(
      p,
      app.activeModel,
      messages,
      (t) => {
        const m = copilot.messages[idx]
        m.status = undefined // 1er token : le prefill est fini, le texte prend le relais
        m.content += t
      },
      signal,
      { num_ctx: COPILOT_NUM_CTX, temperature: COPILOT_TEMPERATURE },
    )
  } catch (e) {
    console.error('[copilot] chat', e)
    copilot.messages[idx].content = copilot.messages[idx].content || 'La génération a échoué. Vérifiez que le moteur est prêt, puis réessayez.'
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
  const userLabel = mode === 'keypoints' ? 'Quels sont les points clés de ce document ?' : 'Résume ce document.'
  const reply = (content: string, flags: { failed?: boolean; config?: boolean } = {}) => {
    copilot.messages.push({ role: 'user', content: userLabel })
    copilot.messages.push({ role: 'assistant', content, ...flags })
  }

  // Garde modèle : carte de CONFIG sans démarrer le sidecar (préserve le boot-safety 14.0).
  if (!app.activeModel) {
    reply('Choisissez ou téléchargez un modèle pour utiliser le copilote — tout reste sur votre machine.', { config: true })
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
  const opts = { num_ctx: COPILOT_NUM_CTX, temperature: COPILOT_TEMPERATURE }
  const mapOpts = { num_ctx: COPILOT_NUM_CTX, temperature: COPILOT_TEMPERATURE, num_predict: SUMMARY_MAP_MAX_TOKENS }
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
    const p = await ensureReady()
    if (p === null) {
      const m = copilot.messages[idx]
      m.content = copilot.error || 'Le moteur IA est indisponible.'
      m.failed = true
      m.retry = { kind: 'summary', mode }
      return
    }
    const model = app.activeModel

    const segments = segmentDoc(doc.text)
    if (segments.length <= 1) {
      // Tient dans une fenêtre → résumé direct, streamé (le statut initial couvre le prefill).
      await generate(p, model, buildWholeSummaryPrompt(doc.text, doc.name, mode), stream, signal, opts)
    } else {
      // map : un résumé par segment (non streamé, avec progression).
      const partials: string[] = []
      for (let i = 0; i < segments.length; i++) {
        setStatus(`Lecture du document — partie ${i + 1}/${segments.length}…`)
        const s = await generate(p, model, buildSegmentSummaryPrompt(segments[i], i + 1, segments.length, doc.name), () => {}, signal, mapOpts)
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
          const s = await generate(p, model, buildReduceSummaryPrompt(g, doc.name, mode), () => {}, signal, mapOpts)
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
        await generate(p, model, buildReduceSummaryPrompt(finalGroups[i], doc.name, mode), stream, signal, opts)
        if (signal.aborted) return
      }
    }
  } catch (e) {
    console.error('[copilot] summarize', e)
    const m = copilot.messages[idx]
    if (m) {
      m.content = m.content || 'Le résumé a échoué. Vérifiez que le moteur est prêt, puis réessayez.'
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

// Reformule la sélection courante de l'éditeur (16.1, FR-7). Streame une PROPOSITION — n'écrit
// RIEN dans le document — portant les bornes de la sélection ; l'utilisateur l'accepte (remplace)
// ou la refuse (texte d'origine intact). Anti-TOCTOU et boot-safety identiques à sendChat.
export async function rephraseSelection(mode: RephraseMode): Promise<void> {
  if (copilot.generating) return
  const view = editorRef.view
  if (!view) return
  const sel = view.state.selection.main
  if (sel.empty) return
  const from = sel.from
  const to = sel.to
  const original = view.state.sliceDoc(from, to)
  const tabId = app.activeId // onglet cible figé à la proposition (éditeur partagé entre onglets)
  const label = mode === 'shorten' ? 'Raccourcir la sélection' : mode === 'tone' ? 'Changer le ton de la sélection' : 'Clarifier la sélection'

  // Garde modèle : carte de CONFIG sans démarrer le sidecar (préserve le boot-safety 14.0).
  if (!app.activeModel) {
    copilot.messages.push({ role: 'user', content: label })
    copilot.messages.push({
      role: 'assistant',
      content: 'Choisissez ou téléchargez un modèle pour utiliser le copilote — tout reste sur votre machine.',
      config: true,
    })
    return
  }

  copilot.generating = true
  genController = new AbortController()
  const signal = genController.signal

  copilot.messages.push({ role: 'user', content: label })
  copilot.messages.push({ role: 'assistant', content: '', streaming: true, rephrase: { tabId, from, to, original, state: 'pending' } })
  const idx = copilot.messages.length - 1

  try {
    const p = await ensureReady()
    if (p === null) {
      const m = copilot.messages[idx]
      m.content = copilot.error || 'Le moteur IA est indisponible.'
      m.failed = true
      m.rephrase = undefined
      m.retry = { kind: 'rephrase', mode }
      return
    }
    // Mutation via l'index (élément proxifié du $state array) → réactif (piège $state profond).
    await generate(p, app.activeModel, buildRephrasePrompt(original, mode), (t) => (copilot.messages[idx].content += t), signal, {
      num_ctx: COPILOT_NUM_CTX,
      temperature: COPILOT_TEMPERATURE,
    })
  } catch (e) {
    console.error('[copilot] rephrase', e)
    const m = copilot.messages[idx]
    m.content = m.content || 'La reformulation a échoué. Vérifiez que le moteur est prêt, puis réessayez.'
    m.failed = true
    m.rephrase = undefined
    m.retry = { kind: 'rephrase', mode }
  } finally {
    const m = copilot.messages[idx]
    if (m) {
      m.streaming = false
      // Le texte proposé remplacera la sélection → on nettoie les espaces de bord (préambule
      // éventuel non géré ici : l'utilisateur relit avant d'appliquer).
      m.content = m.content.trim()
      // Annulé avant tout token → tour fantôme (question + bulle vide) : on retire les deux.
      if (m.content === '' && !m.failed) copilot.messages.splice(idx - 1, 2)
    }
    copilot.generating = false
    genController = null
  }
}

// Applique une proposition (16.1) : remplace la sélection d'origine par le texte proposé.
// Garde ZÉRO PERTE : si le document a changé sous la proposition (la région ne contient plus le
// texte d'origine), on n'écrit RIEN et on signale (`stale`). Remplacement = transaction CM
// unique → annulable par Ctrl+Z.
export function acceptRephrase(idx: number): void {
  const m = copilot.messages[idx]
  if (!m?.rephrase || m.rephrase.state !== 'pending' || m.streaming) return
  const view = editorRef.view
  const { tabId, from, to, original } = m.rephrase
  const proposed = m.content
  if (!view || !proposed) return
  // Cible périmée : mauvais onglet (éditeur partagé) OU région modifiée depuis la proposition.
  // Dans les deux cas on N'ÉCRIT RIEN (zéro perte) et on signale.
  if (app.activeId !== tabId || to > view.state.doc.length || view.state.sliceDoc(from, to) !== original) {
    m.rephrase.state = 'stale'
    return
  }
  view.dispatch({ changes: { from, to, insert: proposed }, selection: { anchor: from + proposed.length } })
  view.focus()
  m.rephrase.state = 'applied'
}

// Refuse une proposition : ne touche PAS au document (texte d'origine conservé).
export function rejectRephrase(idx: number): void {
  const m = copilot.messages[idx]
  if (m?.rephrase && m.rephrase.state === 'pending') m.rephrase.state = 'rejected'
}

// Rejoue une génération échouée (bouton « Réessayer » de la carte d'erreur). Retire la paire
// échouée (question + carte) puis re-dispatche l'action d'origine avec un SNAPSHOT FRAIS du
// document courant — l'utilisateur a pu corriger la cause (moteur redémarré, doc modifié).
export function retryGeneration(idx: number): void {
  const m = copilot.messages[idx]
  if (!m?.retry || copilot.generating) return
  const r = m.retry
  // Reformulation : la sélection d'origine a probablement disparu (l'échec l'a désélectionnée).
  // Sans sélection, rejouer serait un no-op silencieux → on guide au lieu de faire disparaître.
  if (r.kind === 'rephrase' && !editorSel.text.trim()) {
    m.content = 'Sélectionnez à nouveau le passage à reformuler, puis relancez depuis la barre « Sélection ».'
    m.retry = undefined
    return
  }
  copilot.messages.splice(idx - 1, 2)
  const t = activeTab()
  const doc = { name: t?.name ?? null, text: t?.content ?? '', kind: t?.kind ?? ('md' as DocKind) }
  if (r.kind === 'chat') void sendChat(r.question, doc)
  else if (r.kind === 'summary') void summarizeDoc(doc, r.mode)
  else void rephraseSelection(r.mode)
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
