import { minimalSetup } from 'codemirror'
import { EditorView, keymap } from '@codemirror/view'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
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
  { tag: tags.url, color: 'var(--ink-5)' },
  { tag: tags.quote, color: 'var(--ink-3)', fontStyle: 'italic' },
  { tag: tags.contentSeparator, color: 'var(--ink-5)' },
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
    backgroundColor: 'var(--surface)',
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
  { tag: tags.url, color: 'var(--ink-5)' },
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
  const lf = (text.match(/(?:^|[^\r])\n/g) ?? []).length
  return crlf > lf ? '\r\n' : '\n'
}

// Restitue le texte du document avec la fin de ligne voulue (`doc` vient de
// state.doc.toString(), donc en \n).
export function serializeDoc(doc: string, eol: '\n' | '\r\n'): string {
  return eol === '\r\n' ? doc.replace(/\n/g, '\r\n') : doc
}

// Bascule WYSIWYG ↔ source (Ctrl+/) via ce Compartment.
export const livePreviewComp = new Compartment()

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
    keymap.of([]),
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
    keymap.of([]),
    ...extra,
  ]
}

export { EditorView, EditorState }
