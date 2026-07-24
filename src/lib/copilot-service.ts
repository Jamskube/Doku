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

// Le profil ne change pas les garde-fous documentaires : il règle le degré d'initiative laissé
// au modèle. Les petits modèles locaux reçoivent un cadre très direct ; le cloud peut choisir
// sa structure, synthétiser et expliciter ses inférences sans les faire passer pour des faits.
export type PersonaProfile = 'local' | 'cloud'

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
// ATTENTION à ne pas sur-ancrer : l'interdit porte sur INVENTER des informations, pas sur
// travailler le texte — un « vérifie l'orthographe » doit être traité, pas refusé (dérive
// constatée : le modèle répondait la phrase de refus à toute demande de tâche).
export const GROUNDING_REMINDER =
  `(Travaille uniquement d'après le document ci-dessus, sans inventer d'information qui n'y figure pas. ` +
  `Si on te demande une information absente du document, réponds « ${REFUSAL_PHRASE} ». ` +
  `Les tâches sur le texte — orthographe, clarté, résumé, comptage — sont bienvenues.)`

// Température basse pour les usages ancrés (chat/résumé) : le défaut (~0,8) rend le modèle
// « créatif » et favorise l'hallucination ; ~0,2 le maintient fidèle au texte fourni.
export const COPILOT_TEMPERATURE = 0.2

const LOCAL_SYSTEM_BASE =
  "Tu es Doku-San, l'assistant local intégré à l'éditeur Doku. Réponds toujours en français, de " +
  'manière concise. Tes réponses se fondent UNIQUEMENT sur le document fourni ci-dessous, jamais ' +
  'sur des connaissances extérieures. Si la réponse ne figure pas dans le document, réponds ' +
  `exactement « ${REFUSAL_PHRASE} » sans rien inventer ni compléter. Si le document est signalé ` +
  "comme tronqué, précise que tu n'en as lu qu'une partie."

const CLOUD_SYSTEM_BASE =
  "Tu es Doku-San, un partenaire documentaire attentif et expérimenté intégré à l'éditeur Doku. " +
  "Réponds en français et adapte librement la profondeur, le ton et la structure à l'intention de l'utilisateur. " +
  "Prends l'initiative utile : synthétise, relie les idées, relève les contradictions, explicite les implications " +
  "et propose des pistes pertinentes plutôt que de seulement reformuler la demande. Ancre toujours tes affirmations " +
  "sur le document. Distingue clairement ce qui vient du document, ce que tu en infères et, seulement si la demande " +
  "le justifie, ce qui relève d'un contexte général extérieur. Si une information manque, dis-le clairement sans " +
  "l'inventer. Si le document est tronqué, précise que tu n'en as lu qu'une partie."

const CLOUD_GROUNDING_REMINDER =
  "(Appuie d'abord ta réponse sur le document. Tu peux analyser et faire des inférences raisonnables, mais signale-les " +
  "comme telles. N'ajoute du contexte général extérieur que si la demande le justifie, en le distinguant explicitement " +
  "du contenu du document. N'invente jamais un fait attribué au document.)"

// CopilotService : messages /api/chat (system = cadre + contexte doc, puis l'historique, puis
// la question). Les rôles évitent la dérive de complétion d'un prompt concaténé single-turn.
export function buildChatMessages(p: {
  docName: string | null
  docText: string
  kind: DocKind
  history: ChatTurn[]
  question: string
  persona?: PersonaProfile
}): OllamaMessage[] {
  const persona = p.persona ?? 'local'
  const systemBase = persona === 'cloud' ? CLOUD_SYSTEM_BASE : LOCAL_SYSTEM_BASE
  const reminder = persona === 'cloud' ? CLOUD_GROUNDING_REMINDER : GROUNDING_REMINDER
  const system = `${systemBase}\n\n${buildDocContext(p.docName, p.docText, p.kind)}`
  return [
    { role: 'system', content: system },
    ...p.history.map((t) => ({ role: t.role, content: t.content }) as OllamaMessage),
    { role: 'user', content: `${p.question}\n\n${reminder}` },
  ]
}

// --- Q&A dossier + document indexé (15.3, ADR-0015) -------------------------
// Deux modes de récupération : « dossier » (passages top-k de l'index 15.2, réponse
// citant les notes) et « document courant » (doc > fenêtre interrogé via un index
// éphémère). Les citations UTILISATEUR sont déterministes (pied « Passages consultés »
// posé par l'app d'après les passages réellement fournis) — on demande AUSSI au modèle
// de nommer ses notes, mais on ne dépend jamais de sa fiabilité pour citer.

export interface RagPassage {
  name: string
  text: string
}

// Refus dédiés : « ces notes » (dossier) et « extraits consultés » (doc indexé). Ce
// dernier est CRUCIAL : le modèle ne voit que le top-k d'un document entier — lui faire
// dire « absent du document » serait un mensonge silencieux (FR-4) quand le rappel rate.
export const FOLDER_REFUSAL_PHRASE = 'Je ne trouve pas cette information dans ces notes.'
export const DOC_INDEX_REFUSAL_PHRASE = 'Je ne trouve pas cette information dans les extraits consultés de ce document.'

const LOCAL_FOLDER_SYSTEM =
  "Tu es Doku-San, l'assistant local intégré à l'éditeur Doku. Réponds toujours en français, de " +
  'manière concise. Tes réponses se fondent UNIQUEMENT sur les extraits de notes fournis ' +
  'ci-dessous, jamais sur des connaissances extérieures. Quand tu utilises un extrait, mentionne ' +
  'le nom de sa note. Si la réponse ne figure pas dans les extraits, réponds exactement ' +
  `« ${FOLDER_REFUSAL_PHRASE} » sans rien inventer ni compléter.`

const CLOUD_FOLDER_SYSTEM =
  'Tu es Doku-San, un partenaire documentaire attentif intégré à l\'éditeur Doku. Réponds en français. ' +
  'Appuie ta réponse sur les extraits de notes fournis ci-dessous et cite le nom des notes que tu utilises. ' +
  'Tu peux relier les idées entre notes et expliciter tes inférences en les signalant comme telles. ' +
  `Si l'information ne figure pas dans les extraits, dis-le clairement sans l'inventer.`

const FOLDER_REMINDER =
  `(Réponds uniquement d'après les extraits de notes ci-dessus, en citant le nom des notes utilisées. ` +
  `Si l'information n'y figure pas, réponds « ${FOLDER_REFUSAL_PHRASE} ».)`

function passagesBlock(passages: RagPassage[]): string {
  return passages.map((p) => `Note « ${p.name} » :\n"""\n${p.text}\n"""`).join('\n\n')
}

// Q&A « dossier » : system = cadre + passages top-k étiquetés par note.
export function buildFolderChatMessages(p: {
  passages: RagPassage[]
  history: ChatTurn[]
  question: string
  persona?: PersonaProfile
}): OllamaMessage[] {
  const persona = p.persona ?? 'local'
  const base = persona === 'cloud' ? CLOUD_FOLDER_SYSTEM : LOCAL_FOLDER_SYSTEM
  const system =
    `${base}\n\nExtraits des notes du dossier (sélectionnés pour cette question) :\n\n${passagesBlock(p.passages)}`
  return [
    { role: 'system', content: system },
    ...p.history.map((t) => ({ role: t.role, content: t.content }) as OllamaMessage),
    { role: 'user', content: `${p.question}\n\n${FOLDER_REMINDER}` },
  ]
}

const DOC_INDEX_REMINDER =
  `(Réponds uniquement d'après les extraits ci-dessus. Si l'information n'y figure pas, réponds ` +
  `« ${DOC_INDEX_REFUSAL_PHRASE} » — d'autres passages du document existent mais n'ont pas été relus.)`

// Bases DÉDIÉES au mode extraits : les bases 14.3 imposent l'ancienne phrase de refus
// (« dans ce document ») — le modèle affirmerait une absence sur TOUT le document alors
// qu'il n'a vu que le top-k. La distinction est le cœur du correctif d'honnêteté 15.3.
const LOCAL_DOC_INDEX_SYSTEM =
  "Tu es Doku-San, l'assistant local intégré à l'éditeur Doku. Réponds toujours en français, de " +
  'manière concise. Tes réponses se fondent UNIQUEMENT sur les extraits du document fournis ' +
  'ci-dessous, jamais sur des connaissances extérieures. Si la réponse ne figure pas dans les ' +
  `extraits, réponds exactement « ${DOC_INDEX_REFUSAL_PHRASE} » sans rien inventer ni compléter.`

const CLOUD_DOC_INDEX_SYSTEM =
  "Tu es Doku-San, un partenaire documentaire attentif intégré à l'éditeur Doku. Réponds en français. " +
  'Appuie ta réponse sur les extraits du document fournis ci-dessous. Tu peux analyser et faire des ' +
  'inférences raisonnables en les signalant comme telles. Si une information ne figure pas dans les ' +
  "extraits, dis-le clairement sans l'inventer — d'autres passages du document existent mais n'ont pas été relus."

// Mode « document courant » (doc > fenêtre) : le document ENTIER a été indexé, seuls les
// extraits les plus pertinents pour CETTE question sont fournis — dit explicitement au
// modèle (jamais laisser croire qu'il a lu tout le document).
export function buildDocIndexChatMessages(p: {
  docName: string | null
  passages: { text: string }[]
  history: ChatTurn[]
  question: string
  persona?: PersonaProfile
  indexTruncated?: boolean
}): OllamaMessage[] {
  const persona = p.persona ?? 'local'
  const base = persona === 'cloud' ? CLOUD_DOC_INDEX_SYSTEM : LOCAL_DOC_INDEX_SYSTEM
  const title = p.docName ?? 'sans titre'
  const excerpts = p.passages.map((x, i) => `Extrait ${i + 1} :\n"""\n${x.text}\n"""`).join('\n\n')
  const system =
    `${base}\n\nLe document « ${title} » est plus long que la fenêtre de lecture : il a été indexé ` +
    `en entier${p.indexTruncated ? ' (sa toute fin, au-delà du plafond d\'indexation, exceptée)' : ''} et seuls ` +
    `les extraits les plus pertinents pour la question sont fournis ci-dessous. D'autres passages ` +
    `existent mais n'ont pas été relus pour cette question.\n\n${excerpts}`
  return [
    { role: 'system', content: system },
    ...p.history.map((t) => ({ role: t.role, content: t.content }) as OllamaMessage),
    { role: 'user', content: `${p.question}\n\n${DOC_INDEX_REMINDER}` },
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

const LOCAL_SUMMARY_SYS =
  "Tu es Doku-San, l'assistant local de l'éditeur Doku. Tu résumes en français, fidèlement, " +
  "sans rien inventer ni ajouter d'information absente du texte fourni."

const CLOUD_SUMMARY_SYS =
  "Tu es Doku-San, un analyste documentaire expérimenté. Produis une synthèse en français qui hiérarchise " +
  "l'essentiel au lieu de suivre mécaniquement l'ordre du texte. Tu peux regrouper les idées, expliciter leurs liens " +
  "et signaler les tensions ou implications directement étayées. N'invente aucun fait et distingue clairement toute inférence."

function summarySystem(persona: PersonaProfile): string {
  return persona === 'cloud' ? CLOUD_SUMMARY_SYS : LOCAL_SUMMARY_SYS
}

// Résumé direct quand le document tient dans une seule fenêtre.
export function buildWholeSummaryPrompt(
  text: string,
  name: string | null,
  mode: SummaryMode = 'summary',
  persona: PersonaProfile = 'local',
): string {
  const title = name ?? 'sans titre'
  const task =
    mode === 'keypoints'
      ? 'Dégage les POINTS CLÉS du document sous forme de puces courtes.'
      : 'Rédige un résumé concis et fidèle du document (court paragraphe ou puces).'
  return `${summarySystem(persona)}\n\n${task} Document « ${title} » :\n"""\n${text}\n"""`
}

// Phase map : résume UN segment d'un document plus grand (pas d'intro ni de conclusion).
export function buildSegmentSummaryPrompt(
  segment: string,
  index: number,
  total: number,
  name: string | null,
  persona: PersonaProfile = 'local',
): string {
  const title = name ?? 'sans titre'
  return (
    `${summarySystem(persona)}\n\nVoici la partie ${index}/${total} du document « ${title} ». ` +
    "Résume fidèlement le contenu de CETTE partie en puces courtes, sans introduction ni conclusion " +
    `(ce n'est qu'un fragment) :\n"""\n${segment}\n"""`
  )
}

// Phase reduce : fusionne des résumés partiels (dans l'ordre) en une synthèse unique.
export function buildReduceSummaryPrompt(
  partials: string,
  name: string | null,
  mode: SummaryMode = 'summary',
  persona: PersonaProfile = 'local',
): string {
  const title = name ?? 'sans titre'
  const task =
    mode === 'keypoints'
      ? 'Fusionne-les en une liste unique des POINTS CLÉS (puces courtes), sans répétition.'
      : 'Rédige à partir d\'eux un résumé global unique, cohérent et fidèle (court paragraphe ou puces), sans répétition.'
  return (
    `${summarySystem(persona)}\n\nVoici, dans l'ordre, des résumés partiels du document « ${title} ». ` +
    `${task} N'ajoute aucune information qui n'y figure pas :\n"""\n${partials}\n"""`
  )
}

// --- Reformulation (16.1) : réécrit un passage SÉLECTIONNÉ, sans en changer le sens ---------
// Assistance à la rédaction (FR-7). La sortie REMPLACE la sélection dans l'éditeur → le modèle
// ne doit renvoyer QUE le texte réécrit (aucun préambule, guillemet ni commentaire), sinon on
// insérerait du parasite. Zéro invention : même sens, même langue, même mise en forme Markdown.
export type RephraseMode = 'clarify' | 'shorten' | 'tone' | 'correct'

const REPHRASE_TASK: Record<RephraseMode, string> = {
  clarify: 'Reformule le passage ci-dessous en le rendant plus clair et plus facile à lire (phrases simples et directes).',
  shorten: "Reformule le passage ci-dessous en le rendant plus court et plus concis, sans perdre l'information importante.",
  tone: 'Reformule le passage ci-dessous en adoptant un ton plus neutre et professionnel.',
  // 16.2 : correction = changement MINIMAL — jamais de licence de réécriture, quel que soit le persona.
  correct: "Corrige l'orthographe, la grammaire, la conjugaison et la ponctuation du passage ci-dessous, en changeant le moins de mots possible.",
}

export function buildRephrasePrompt(
  text: string,
  mode: RephraseMode,
  persona: PersonaProfile = 'local',
): string {
  const role =
    persona === 'cloud'
      ? mode === 'correct'
        ? 'Tu es Doku-San, un correcteur rigoureux.'
        : "Tu es Doku-San, un éditeur expérimenté. Améliore franchement le passage : tu peux réorganiser les phrases et la structure lorsque cela sert l'objectif demandé."
      : "Tu es Doku-San, l'assistant d'écriture local de l'éditeur Doku."
  return (
    `${role} ${REPHRASE_TASK[mode]}\n` +
    'Règles STRICTES :\n' +
    "- Garde exactement le même sens ; n'ajoute aucune information nouvelle.\n" +
    "- Conserve la langue d'origine et la mise en forme Markdown (titres, listes, gras, liens, code).\n" +
    '- Réponds UNIQUEMENT avec le texte réécrit — sans préambule, sans guillemets, sans commentaire.\n' +
    `\nPassage :\n"""\n${text}\n"""`
  )
}

// --- Diff mot à mot (16.2, brief w3) : ce qui change entre l'original et la proposition -------
// Pour l'aperçu en place : suppressions barrées, ajouts surlignés. Tokenisation par mots ET
// blancs (les blancs sont des tokens à part entière) → propriété garantie : la concaténation
// des segments `same`+`del` redonne EXACTEMENT l'original, `same`+`add` la proposition. LCS
// O(n·m) borné : au-delà du plafond (sélections énormes), repli sur un remplacement intégral —
// jamais de diff faux, juste moins fin.
export interface DiffSeg {
  kind: 'same' | 'del' | 'add'
  text: string
}

// ~2000 tokens par côté (≈ 1000 mots — les blancs comptent) : couvre une correction de
// plusieurs paragraphes en restant à ~16 Mo transitoires (Uint32Array), quelques ms sur ARM.
const DIFF_MAX_CELLS = 4_000_000

export function diffWords(original: string, proposed: string): DiffSeg[] {
  if (original === proposed) return original ? [{ kind: 'same', text: original }] : []
  const a = original.split(/(\s+)/).filter((t) => t !== '')
  const b = proposed.split(/(\s+)/).filter((t) => t !== '')
  const segs: DiffSeg[] = []
  const push = (kind: DiffSeg['kind'], text: string) => {
    const last = segs[segs.length - 1]
    if (last && last.kind === kind) last.text += text
    else segs.push({ kind, text })
  }
  if (a.length * b.length > DIFF_MAX_CELLS) {
    if (original) push('del', original)
    if (proposed) push('add', proposed)
    return segs
  }
  // Table des longueurs de LCS (suffixes), puis backtrack avant→arrière.
  const n = a.length
  const m = b.length
  const w = m + 1
  const lcs = new Uint32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = a[i] === b[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1])
    }
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('same', a[i])
      i++
      j++
    } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) {
      push('del', a[i])
      i++
    } else {
      push('add', b[j])
      j++
    }
  }
  while (i < n) push('del', a[i++])
  while (j < m) push('add', b[j++])
  return segs
}
