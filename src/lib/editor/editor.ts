import { minimalSetup } from 'codemirror'
import { EditorView, keymap } from '@codemirror/view'
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { html } from '@codemirror/lang-html'
import { languages } from '@codemirror/language-data'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { livePreview } from './live-preview'

// Typographie du document — source : maquette W1 (article Source Serif 4).
const dokuHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontFamily: 'var(--font-serif)', fontWeight: '600', fontSize: '38px', letterSpacing: '-0.012em', color: 'var(--ink)' },
  { tag: tags.heading2, fontFamily: 'var(--font-serif)', fontWeight: '600', fontSize: '25px', letterSpacing: '-0.008em', color: 'var(--ink)' },
  { tag: tags.heading3, fontFamily: 'var(--font-serif)', fontWeight: '600', fontSize: '21px', color: 'var(--ink)' },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontFamily: 'var(--font-serif)', fontWeight: '600', color: 'var(--ink)' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '600', color: 'var(--ink)' },
  { tag: tags.strikethrough, textDecoration: 'line-through', textDecorationColor: 'var(--line-3)' },
  { tag: tags.monospace, fontFamily: 'var(--font-mono)', fontSize: '0.78em' },
  { tag: tags.link, color: 'var(--ink)' },
  { tag: tags.url, color: 'var(--ink-4)' },
  { tag: tags.quote, color: 'var(--ink-3)', fontStyle: 'italic' },
  { tag: tags.contentSeparator, color: 'var(--ink-4)' },
  { tag: tags.processingInstruction, color: 'var(--ink-4)' },
  { tag: tags.meta, color: 'var(--ink-4)' },
  { tag: tags.comment, fontFamily: 'var(--font-mono)', color: 'var(--ink-4)' },
  { tag: tags.keyword, color: 'var(--ink)', fontWeight: '500' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp, tags.escape], color: 'var(--ok)' },
  { tag: [tags.number, tags.bool, tags.atom, tags.null, tags.constant(tags.variableName)], color: 'var(--warn)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--ink)', fontWeight: '500' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--ink-2)', fontWeight: '500' },
  { tag: [tags.propertyName, tags.attributeName, tags.variableName, tags.definition(tags.variableName)], color: 'var(--ink-2)' },
  { tag: [tags.operator, tags.punctuation, tags.separator, tags.bracket, tags.derefOperator], color: 'var(--ink-3)' },
  // Balisage (HTML source + HTML inline dans le markdown)
  { tag: tags.tagName, color: 'var(--ink)', fontWeight: '500' },
  { tag: tags.attributeName, color: 'var(--ink-2)' },
  { tag: tags.attributeValue, color: 'var(--ok)' },
  { tag: tags.angleBracket, color: 'var(--ink-3)' },
])

const dokuTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-serif)',
    lineHeight: '1.78',
    overflow: 'auto',
  },
  '.cm-content': {
    maxWidth: 'var(--doc-width, 680px)',
    margin: '0 auto',
    padding: '18px 40px 120px',
    fontSize: '18.5px',
    color: 'var(--ink-2)',
    caretColor: 'var(--ink)',
  },
  '.cm-line': { padding: '0' },
  '.cm-cursor': { borderLeftColor: 'var(--ink)', borderLeftWidth: '2px' },
  // Cadre transitoire sur une occurrence de recherche atteinte au clic (9.4).
  '.cm-search-flash': {
    backgroundColor: 'var(--accent-soft)',
    borderRadius: '3px',
    boxShadow: '0 0 0 2px var(--ink-3)',
  },
  // Aperçu de reformulation en place (16.2, rephrase-preview.ts) — carte papier par-dessus
  // la sélection, vocabulaire visuel du menu de sélection (filet --line-2, rayons 10).
  '.cm-rephrase-preview': {
    display: 'inline-block',
    maxWidth: '100%',
    boxSizing: 'border-box',
    verticalAlign: 'baseline',
    padding: '8px 12px',
    border: '1px solid var(--line-2)',
    borderRadius: '10px',
    background: 'var(--cream-content)',
    boxShadow: '0 4px 14px rgba(var(--shadow-rgb), 0.10)',
  },
  '.cm-rephrase-head': {
    display: 'block',
    fontFamily: 'var(--font-sans)',
    fontSize: '12px',
    color: 'var(--ink-3)',
    marginBottom: '4px',
  },
  '.cm-rephrase-hint': { marginLeft: '10px', fontSize: '11px', color: 'var(--ink-4)' },
  '.cm-rephrase-body': { display: 'block', whiteSpace: 'pre-wrap' },
  '.cm-rephrase-preview[data-phase="streaming"] .cm-rephrase-body': { color: 'var(--ink-3)' },
  '.cm-rephrase-del': {
    textDecoration: 'line-through',
    textDecorationThickness: '1px',
    color: 'var(--err-text)',
    opacity: '0.85',
  },
  '.cm-rephrase-add': { background: 'var(--accent-soft)', borderRadius: '3px', textDecoration: 'none' },
  '.cm-rephrase-note': {
    display: 'block',
    fontFamily: 'var(--font-sans)',
    fontSize: '13px',
    color: 'var(--ink-2)',
  },
  '.cm-rephrase-bar': { display: 'flex', gap: '8px', marginTop: '8px' },
  '.cm-rephrase-btn': {
    fontFamily: 'var(--font-sans)',
    fontSize: '12.5px',
    fontWeight: '500',
    padding: '4px 12px',
    borderRadius: '8px',
    border: '1px solid var(--line-2)',
    background: 'transparent',
    color: 'var(--ink-2)',
    cursor: 'pointer',
  },
  '.cm-rephrase-btn:hover': { background: 'var(--surface-hover)', color: 'var(--ink)' },
  '.cm-rephrase-btn:focus-visible': { outline: '2px solid var(--line-3)', outlineOffset: '1px' },
  '.cm-rephrase-btn.accept': {
    background: 'var(--ink)',
    borderColor: 'var(--ink)',
    color: 'var(--cream-content)',
  },
  '.cm-rephrase-btn.accept:hover': { opacity: '0.88', color: 'var(--cream-content)' },
  '.cm-rephrase-btn:disabled': { opacity: '0.5', cursor: 'default' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': {
    background: 'rgba(var(--ink-rgb), 0.12)',
  },
  // Blocs enrichis par le live preview (classes posées par live-preview.ts)
  '.cm-lp-h1': { paddingBottom: '8px' },
  '.cm-lp-h2': { paddingTop: '30px', paddingBottom: '6px' },
  '.cm-lp-h3': { paddingTop: '20px', paddingBottom: '4px' },
  '.cm-lp-codeblock': {
    fontFamily: 'var(--font-mono)',
    fontSize: '13.5px',
    lineHeight: '1.7',
    backgroundColor: 'var(--code-bg)',
    padding: '0 18px',
  },
  '.cm-lp-quote': {
    borderLeft: '2px solid var(--line-3)',
    paddingLeft: '16px',
  },
  '.cm-lp-task-done': {
    textDecoration: 'line-through',
    textDecorationColor: 'var(--line-3)',
    color: 'var(--ink-4)',
  },
  '.cm-lp-wikilink': {
    background: 'var(--accent-soft)',
    borderRadius: '4px',
    padding: '1px 5px',
    color: 'var(--ink)',
    cursor: 'pointer',
  },
  '.cm-lp-link': {
    color: 'var(--ink)',
    borderBottom: '1px solid var(--line-3)',
    cursor: 'pointer',
  },
  '.cm-lp-table': {
    borderCollapse: 'collapse',
    width: '100%',
    margin: '12px 0',
    fontFamily: 'var(--font-sans)',
    fontSize: '14.5px',
    cursor: 'pointer',
  },
  '.cm-lp-table th, .cm-lp-table td': {
    border: '1px solid var(--line-2)',
    padding: '7px 13px',
    textAlign: 'left',
    verticalAlign: 'top',
  },
  '.cm-lp-table th': {
    background: 'var(--surface-hover)',
    fontWeight: '600',
    color: 'var(--ink)',
  },
  '.cm-lp-table td': { color: 'var(--ink-2)' },
  '.cm-lp-image-wrap': { display: 'block' },
  '.cm-lp-image': {
    display: 'block',
    maxWidth: '100%',
    borderRadius: '8px',
    margin: '6px 0',
  },
  '.cm-lp-image-missing': {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '6px 12px',
    borderRadius: '8px',
    border: '1px dashed var(--line-3)',
    color: 'var(--ink-4)',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
  },
  '.cm-task-checkbox': {
    appearance: 'none',
    width: '19px',
    height: '19px',
    borderRadius: '5px',
    border: '1.5px solid var(--line-3)',
    background: 'transparent',
    cursor: 'pointer',
    verticalAlign: '-4px',
    marginRight: '10px',
    position: 'relative',
    transition: 'all 140ms ease',
  },
  '.cm-task-checkbox:hover': { borderColor: 'var(--ink-3)' },
  '.cm-task-checkbox:checked': { background: 'var(--ink)', borderColor: 'var(--ink)' },
  '.cm-task-checkbox:checked::after': {
    content: "'✓'",
    position: 'absolute',
    inset: '0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--cream-content)',
    fontSize: '12px',
    fontFamily: 'var(--font-sans)',
  },
})

// Mode source (Ctrl+/) : coloration neutre, sans tailles de titres.
const sourceHighlight = HighlightStyle.define([
  { tag: [tags.heading1, tags.heading2, tags.heading3, tags.heading4, tags.heading5, tags.heading6], fontWeight: '600', color: 'var(--ink)' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '600' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--ink)' },
  { tag: tags.url, color: 'var(--ink-4)' },
  { tag: tags.quote, color: 'var(--ink-3)' },
  { tag: tags.processingInstruction, color: 'var(--ink-4)' },
  { tag: tags.meta, color: 'var(--ink-4)' },
  { tag: tags.comment, color: 'var(--ink-4)' },
  { tag: tags.keyword, color: 'var(--ink)', fontWeight: '500' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--ok)' },
  { tag: tags.number, color: 'var(--warn)' },
])

// Fin de ligne dominante d'un document. CM6 stocke tout en \n en interne
// (state.doc.toString() renvoie toujours du \n) ; on retient la fin de ligne du
// fichier pour la restituer à la sérialisation et préserver le round-trip.
// Fichier à fins de ligne mixtes : normalisé vers la dominante (documenté, FR-3).
export function detectLineEnding(text: string): '\n' | '\r\n' {
  const crlf = (text.match(/\r\n/g) ?? []).length
  // Lookbehind (ne consomme pas le caractère précédent) : compte tous les \n non
  // précédés d'un \r, y compris des \n consécutifs (lignes vides). L'ancienne
  // forme `(?:^|[^\r])\n` consommait ce caractère → sous-comptait autour des vides.
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length
  return crlf > lf ? '\r\n' : '\n'
}

// Restitue le texte du document avec la fin de ligne voulue (`doc` vient de
// state.doc.toString(), donc en \n).
export function serializeDoc(doc: string, eol: '\n' | '\r\n'): string {
  return eol === '\r\n' ? doc.replace(/\n/g, '\r\n') : doc
}

// Bascule WYSIWYG ↔ source (Ctrl+/) via ce Compartment.
export const livePreviewComp = new Compartment()

// Ctrl+/ pilote la bascule source (handler fenêtre dans App.svelte). Mais
// `minimalSetup` embarque `defaultKeymap`, qui lie Mod-/ à `toggleComment` :
// sans garde, presser Ctrl+/ avec l'éditeur focus commenterait la ligne courante
// (`<!-- … -->`) et salirait le document. On neutralise Mod-/ dans l'éditeur
// (no-op prioritaire) ; l'event remonte quand même à la fenêtre pour la bascule.
const suppressToggleComment = Prec.highest(keymap.of([{ key: 'Mod-/', run: () => true }]))

export function previewExtensions(): Extension[] {
  return [livePreview(), syntaxHighlighting(dokuHighlight)]
}

export function sourceExtensions(): Extension[] {
  return [syntaxHighlighting(sourceHighlight)]
}

export function baseExtensions(sourceMode: boolean, extra: Extension[] = []): Extension[] {
  return [
    minimalSetup,
    EditorView.lineWrapping,
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    dokuTheme,
    livePreviewComp.of(sourceMode ? sourceExtensions() : previewExtensions()),
    suppressToggleComment,
    ...extra,
  ]
}

// Éditeur simple pour les fichiers .txt (FR-8, 5.3) : texte brut, aucun langage
// ni live preview ni coloration — juste le retour à la ligne et le thème.
export function txtExtensions(extra: Extension[] = []): Extension[] {
  return [
    minimalSetup,
    EditorView.lineWrapping,
    dokuTheme,
    suppressToggleComment,
    ...extra,
  ]
}

// Éditeur source pour les fichiers HTML (FR-8, 5.2) : langage HTML, coloration
// des balises/attributs via dokuHighlight, sans live preview (le rendu = iframe).
export function htmlSourceExtensions(extra: Extension[] = []): Extension[] {
  return [
    minimalSetup,
    EditorView.lineWrapping,
    html(),
    dokuTheme,
    syntaxHighlighting(dokuHighlight),
    suppressToggleComment,
    ...extra,
  ]
}

export { EditorView, EditorState }
