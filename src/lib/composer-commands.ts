// La palette de commandes « / » du composeur, et les quatre sorties de Doku-San — source
// unique lue par le menu du « + », la pastille du composeur et l'autocomplétion.
// Cœur pur et testable : aucune décision ici (fournisseur cloud, dialogues, focus),
// seulement la reconnaissance de ce que l'utilisateur a tapé.
import type { ChatOutputMode } from './copilot.svelte'
import type { CopilotVerbosity } from './copilot-service'

export interface OutputModeInfo {
  icon: string
  label: string
  /** Libellé court de la pastille, quand la place manque. */
  short: string
  hint: string
}

export const OUTPUT_ORDER = ['answer', 'diagram', 'html', 'pdf'] as const

export const OUTPUT_MODES: Record<ChatOutputMode, OutputModeInfo> = {
  answer: { icon: 'chat_bubble', label: 'Réponse', short: 'Réponse', hint: 'Continuer la conversation' },
  diagram: { icon: 'account_tree', label: 'Diagramme', short: 'Diagramme', hint: 'Structurer les idées visuellement' },
  html: { icon: 'html', label: 'Page HTML', short: 'HTML', hint: 'Créer une page interactive et autonome' },
  pdf: { icon: 'picture_as_pdf', label: 'Document PDF', short: 'PDF', hint: 'Composer un document prêt à imprimer' },
}

/** Les livrables que le modèle local ne sait pas produire (ADR-0031 : le local lit, le cloud crée). */
export function cloudOnlyMode(mode: ChatOutputMode): boolean {
  return mode === 'html' || mode === 'pdf'
}

// Ce qu'une commande déclenche. Le composant dispatche là-dessus ; ce module ne fait rien.
export type SlashAction =
  | { kind: 'mode'; mode: ChatOutputMode }
  | { kind: 'verbosity'; value: CopilotVerbosity }
  | { kind: 'web' }
  | { kind: 'context'; target: 'selection' | 'files' | 'folder' | 'clipboard' }

export interface SlashCommand {
  /** Le mot canonique, celui que l'autocomplétion propose en premier. */
  token: string
  /** Écritures acceptées en plus du canonique — on tape vite et sans accent. */
  aliases: readonly string[]
  icon: string
  hint: string
  action: SlashAction
  /**
   * Une commande « seule » ouvre un dialogue ou coche une case : elle n'a pas de suite à
   * transmettre au modèle. `/fichiers mon texte` n'aurait aucun sens, donc elle ne se
   * déclenche qu'à la validation, jamais en cours de phrase.
   */
  standalone?: true
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { token: 'pdf', aliases: ['document', 'doc'], icon: 'picture_as_pdf', hint: 'Composer un document prêt à imprimer', action: { kind: 'mode', mode: 'pdf' } },
  { token: 'html', aliases: ['page'], icon: 'html', hint: 'Créer une page interactive et autonome', action: { kind: 'mode', mode: 'html' } },
  { token: 'diagramme', aliases: ['diagram', 'schema', 'schéma', 'graph', 'graphique'], icon: 'account_tree', hint: 'Structurer les idées visuellement', action: { kind: 'mode', mode: 'diagram' } },
  { token: 'reponse', aliases: ['réponse', 'texte', 'chat'], icon: 'chat_bubble', hint: 'Revenir à une réponse dans la conversation', action: { kind: 'mode', mode: 'answer' } },

  { token: 'web', aliases: ['recherche', 'internet'], icon: 'search', hint: 'Activer ou couper la recherche Web', action: { kind: 'web' } },
  { token: 'selection', aliases: ['sélection'], icon: 'notes', hint: 'Ajouter le texte sélectionné au contexte', action: { kind: 'context', target: 'selection' }, standalone: true },
  { token: 'fichiers', aliases: ['fichier', 'files'], icon: 'description', hint: 'Ajouter des fichiers au contexte', action: { kind: 'context', target: 'files' }, standalone: true },
  { token: 'dossier', aliases: ['notes', 'folder'], icon: 'folder', hint: 'Utiliser l’index sémantique d’un dossier', action: { kind: 'context', target: 'folder' }, standalone: true },
  { token: 'presse-papiers', aliases: ['presse', 'clipboard', 'coller'], icon: 'content_paste', hint: 'Ajouter le presse-papiers au contexte', action: { kind: 'context', target: 'clipboard' }, standalone: true },

  { token: 'bref', aliases: ['court'], icon: 'short_text', hint: 'Réponses droit à l’essentiel', action: { kind: 'verbosity', value: 'brief' } },
  { token: 'equilibre', aliases: ['équilibré', 'normal'], icon: 'subject', hint: 'Réponses de longueur naturelle', action: { kind: 'verbosity', value: 'balanced' } },
  { token: 'detaille', aliases: ['détaillé', 'long'], icon: 'notes', hint: 'Réponses développées et structurées', action: { kind: 'verbosity', value: 'detailed' } },
]

export interface SlashMatch {
  command: SlashCommand
  /** Le brouillon SANS la commande — c'est lui, et lui seul, qui part au modèle. */
  rest: string
}

function byWord(word: string): SlashCommand | undefined {
  const wanted = word.toLowerCase()
  return SLASH_COMMANDS.find((c) => c.token === wanted || c.aliases.includes(wanted))
}

// `terminal` = la commande est SEULE dans le champ (l'utilisateur vient de faire Entrée).
// Sinon on exige l'espace qui la termine : sans lui, taper « /p » basculerait le mode au
// milieu du mot, et « /pdfs » serait pris pour « /pdf ».
//
// `[\p{L}-]` et non `\w` : « schéma » porte un accent et « presse-papiers » un trait
// d'union, que `\w` exclut l'un comme l'autre.
export function matchSlashCommand(draft: string, terminal: boolean): SlashMatch | null {
  const found = terminal ? /^\s*\/([\p{L}-]+)\s*$/u.exec(draft) : /^\s*\/([\p{L}-]+)[ \t]+/u.exec(draft)
  if (!found) return null
  const command = byWord(found[1])
  if (!command) return null
  // Une commande « seule » ne se déclenche jamais en cours de phrase.
  if (command.standalone && !terminal) return null
  return { command, rest: terminal ? '' : draft.slice(found[0].length) }
}

// La commande EN COURS DE FRAPPE : `/` seul rend une chaîne vide (on propose tout),
// `/p` rend « p ». Rend `null` dès qu'un espace suit — la commande est alors finie, c'est
// `matchSlashCommand` qui prend le relais — ou si le champ ne commence pas par une barre.
export function slashQuery(draft: string): string | null {
  const found = /^\s*\/([\p{L}-]*)$/u.exec(draft)
  return found ? found[1].toLowerCase() : null
}

export interface SlashSuggestion {
  /** Le mot exact à taper, celui qui est affiché. */
  token: string
  command: SlashCommand
}

// Une ligne par commande dont le nom canonique OU un alias commence par la saisie, et
// c'est le nom QUI CORRESPOND qui s'affiche : taper « /p » doit montrer `pdf` et `page`,
// pas `pdf` et `html`, sinon on ne sait pas quoi finir de taper.
export function suggestSlashCommands(query: string): SlashSuggestion[] {
  const out: SlashSuggestion[] = []
  for (const command of SLASH_COMMANDS) {
    const token = [command.token, ...command.aliases].find((name) => name.startsWith(query))
    if (token) out.push({ token, command })
  }
  return out
}
