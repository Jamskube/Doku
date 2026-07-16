// CopilotService + ContextBuilder (archi v2, purs & testables) — assemblent le contexte du
// document courant et le prompt du chat. Le streaming/annulation vit dans copilot.svelte.ts ;
// l'appel réseau dans ollama.ts::chat. Import de type seul (`DocKind`) → erasé, module pur.
import type { DocKind } from './stores.svelte'

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// Cap du texte injecté (14.1). Un doc plus long est tronqué avec marqueur — le résumé
// robuste des longs docs (segmentation map-reduce) est la story 14.2.
export const MAX_DOC_CHARS = 12000

export function truncateDoc(text: string, max = MAX_DOC_CHARS): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false }
  return { text: text.slice(0, max), truncated: true }
}

// ContextBuilder : texte de contexte du document courant. PDF → contenu binaire (pas de
// texte extractible en v2.0 ; l'extraction pdf.js viendra en 14.2/14.3). Vide → signalé.
export function buildDocContext(name: string | null, content: string, kind: DocKind): string {
  const title = name ?? 'sans titre'
  if (kind === 'pdf') return `Document « ${title} » (PDF — texte non extractible pour l'instant).`
  const { text, truncated } = truncateDoc(content)
  if (!text.trim()) return `Document « ${title} » (vide).`
  const body = `Document « ${title} » :\n"""\n${text}\n"""`
  // Troncature signalée EXPLICITEMENT au modèle (pas silencieuse, FR-4) : un « je ne trouve pas »
  // peut alors venir du fait qu'on n'a lu qu'une partie, pas d'une absence réelle.
  return truncated
    ? `${body}\n(Ce document est long : seul son début est fourni ci-dessus ; la suite n'a pas été lue.)`
    : body
}

// Phrase de refus EXACTE quand l'info est absente du document (ancrage 14.3). Donnée telle quelle
// au modèle pour maximiser l'obéissance d'un petit modèle, et testée en couche pure.
export const REFUSAL_PHRASE = 'Je ne trouve pas cette information dans ce document.'

// Rappel d'ancrage COLLÉ à la question (14.3). Un petit modèle attend surtout les tokens proches
// de la génération → répéter la contrainte ici, en plus du system, réduit nettement la dérive
// vers ses connaissances internes (ex. répondre « ça prend plusieurs mois » alors que le doc dit
// « 100 à 160 jours »). Ajouté au message envoyé, PAS à la question affichée à l'utilisateur.
export const GROUNDING_REMINDER =
  `(Réponds uniquement d'après le document ci-dessus. N'utilise aucune connaissance extérieure ; ` +
  `si l'information n'y figure pas, réponds « ${REFUSAL_PHRASE} ».)`

// Température basse pour les usages ancrés (chat/résumé) : le défaut (~0,8) rend le modèle
// « créatif » et favorise l'hallucination ; ~0,2 le maintient fidèle au texte fourni.
export const COPILOT_TEMPERATURE = 0.2

const SYSTEM_BASE =
  "Tu es Doku-San, l'assistant local intégré à l'éditeur Doku. Réponds toujours en français, de " +
  'manière concise. Tes réponses se fondent UNIQUEMENT sur le document fourni ci-dessous, jamais ' +
  'sur des connaissances extérieures. Si la réponse ne figure pas dans le document, réponds ' +
  `exactement « ${REFUSAL_PHRASE} » sans rien inventer ni compléter. Si le document est signalé ` +
  "comme tronqué, précise que tu n'en as lu qu'une partie."

// CopilotService : messages /api/chat (system = cadre + contexte doc, puis l'historique, puis
// la question). Les rôles évitent la dérive de complétion d'un prompt concaténé single-turn.
export function buildChatMessages(p: {
  docName: string | null
  docText: string
  kind: DocKind
  history: ChatTurn[]
  question: string
}): OllamaMessage[] {
  const system = `${SYSTEM_BASE}\n\n${buildDocContext(p.docName, p.docText, p.kind)}`
  return [
    { role: 'system', content: system },
    ...p.history.map((t) => ({ role: t.role, content: t.content }) as OllamaMessage),
    { role: 'user', content: `${p.question}\n\n${GROUNDING_REMINDER}` },
  ]
}

// --- Résumé (14.2) : segmentation map-reduce des longs docs -----------------
// Le PRD (FR-4) interdit la troncature silencieuse. Un doc trop long pour la fenêtre du modèle
// est donc DÉCOUPÉ (map : un résumé par segment ; reduce : synthèse des résumés), jamais coupé.
export type SummaryMode = 'summary' | 'keypoints'

// Fenêtre de contexte IMPOSÉE au modèle pour le résumé. On la FIXE (au lieu du défaut Ollama,
// souvent 2048/4096) car un prompt plus long que num_ctx est tronqué À GAUCHE côté serveur — la
// troncature silencieuse que FR-4 proscrit, juste déplacée d'une couche. `generate` la relaie.
// On la choisit GÉNÉREUSE : une note normale doit tenir en UNE passe (rapide) ; le map-reduce,
// coûteux sur CPU (N appels séquentiels), ne se déclenche que pour les documents vraiment longs.
// Partagée par le chat (14.3) : le doc + l'ancrage restent en contexte sur plusieurs tours, et
// chat/résumé utilisent la même fenêtre → pas de rechargement de modèle en va-et-vient.
export const COPILOT_NUM_CTX = 16384
// Taille max d'un segment. Le budget num_ctx est en TOKENS mais on segmente en CARACTÈRES. Pire
// cas (CJK) ≈ 1 token/caractère → on garde SEGMENT_CHARS ≤ num_ctx − marge (prompt + sortie),
// donc un segment ne peut jamais déborder num_ctx quel que soit le script. Le latin (~0,25
// token/car) tient très à l'aise : une note jusqu'à ~14k car (~3,5k tokens) = une seule passe.
export const SEGMENT_CHARS = 14000
// Plafond de génération de la phase MAP (résumé d'un segment). Un résumé partiel doit être bref :
// on le borne pour (1) accélérer nettement — le petit modèle a tendance à délayer — et (2)
// garantir input + sortie < num_ctx (pas de débordement → pas de context-shift qui tronquerait).
export const SUMMARY_MAP_MAX_TOKENS = 512

function sliceEvery(s: string, n: number): string[] {
  const out: string[] = []
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n))
  return out
}

// Découpe un texte en segments de longueur <= max SANS rien perdre (le contraire de tronquer) :
// on empile les lignes et on ouvre un nouveau segment dès que la suivante déborderait ; une
// ligne unique plus longue que max (rare : minifié, base64) est tranchée dur. Chaque caractère
// du document se retrouve dans exactement un segment.
export function segmentDoc(text: string, max = SEGMENT_CHARS): string[] {
  if (text.length <= max) return text.trim() ? [text] : []
  const segments: string[] = []
  let buf = ''
  const flush = () => {
    if (buf.trim()) segments.push(buf)
    buf = ''
  }
  for (const rawLine of text.split('\n')) {
    const pieces = rawLine.length > max ? sliceEvery(rawLine, max) : [rawLine]
    for (const piece of pieces) {
      if (buf && buf.length + piece.length + 1 > max) flush()
      buf = buf ? buf + '\n' + piece : piece
    }
  }
  flush()
  return segments
}

const SUMMARY_SYS =
  "Tu es Doku-San, l'assistant local de l'éditeur Doku. Tu résumes en français, fidèlement, " +
  "sans rien inventer ni ajouter d'information absente du texte fourni."

// Résumé direct quand le document tient dans une seule fenêtre.
export function buildWholeSummaryPrompt(text: string, name: string | null, mode: SummaryMode = 'summary'): string {
  const title = name ?? 'sans titre'
  const task =
    mode === 'keypoints'
      ? 'Dégage les POINTS CLÉS du document sous forme de puces courtes.'
      : 'Rédige un résumé concis et fidèle du document (court paragraphe ou puces).'
  return `${SUMMARY_SYS}\n\n${task} Document « ${title} » :\n"""\n${text}\n"""`
}

// Phase map : résume UN segment d'un document plus grand (pas d'intro ni de conclusion).
export function buildSegmentSummaryPrompt(segment: string, index: number, total: number, name: string | null): string {
  const title = name ?? 'sans titre'
  return (
    `${SUMMARY_SYS}\n\nVoici la partie ${index}/${total} du document « ${title} ». ` +
    "Résume fidèlement le contenu de CETTE partie en puces courtes, sans introduction ni conclusion " +
    `(ce n'est qu'un fragment) :\n"""\n${segment}\n"""`
  )
}

// Phase reduce : fusionne des résumés partiels (dans l'ordre) en une synthèse unique.
export function buildReduceSummaryPrompt(partials: string, name: string | null, mode: SummaryMode = 'summary'): string {
  const title = name ?? 'sans titre'
  const task =
    mode === 'keypoints'
      ? 'Fusionne-les en une liste unique des POINTS CLÉS (puces courtes), sans répétition.'
      : 'Rédige à partir d\'eux un résumé global unique, cohérent et fidèle (court paragraphe ou puces), sans répétition.'
  return (
    `${SUMMARY_SYS}\n\nVoici, dans l'ordre, des résumés partiels du document « ${title} ». ` +
    `${task} N'ajoute aucune information qui n'y figure pas :\n"""\n${partials}\n"""`
  )
}
