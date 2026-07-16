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
  return `Document « ${title} » :\n"""\n${truncated ? text + '\n[… document tronqué …]' : text}\n"""`
}

const SYSTEM_BASE =
  "Tu es Doku-San, l'assistant local intégré à l'éditeur Doku. Réponds en français, de manière " +
  'concise et fidèle au document fourni. Si l\'information demandée n\'est pas dans le document, ' +
  'dis-le clairement plutôt que d\'inventer.'

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
    { role: 'user', content: p.question },
  ]
}
