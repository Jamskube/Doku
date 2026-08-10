// Commandes de formatage de la sélection (story 20.4) : Ctrl+B / Ctrl+I / Ctrl+K et le
// menu d'effets du popover de sélection. La MÉCANIQUE d'enveloppe est pure (lib/format) ;
// ici vit la décision « déjà formaté ou pas », rendue par l'ARBRE SYNTAXIQUE — jamais par
// une heuristique de chaîne (leçon 20.3 : le parseur fait foi). Toute écriture est une
// édition ciblée de quelques caractères ou des lignes touchées (ADR-0002, warning n°1).
import { Prec } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import {
  HR_TEMPLATE,
  MARKERS,
  TABLE_TEMPLATE,
  linkText,
  makeLink,
  toggleHeadingLines,
  toggleLinePrefix,
  wrapSelection,
  type InlineMark,
} from '../format'

const NODE_FOR: Record<InlineMark, string> = {
  bold: 'StrongEmphasis',
  italic: 'Emphasis',
  strike: 'Strikethrough',
  code: 'InlineCode',
}

// Longueur du marqueur d'OUVERTURE/FERMETURE d'un nœud inline, lue dans la source
// (l'InlineCode peut être clôturé par plusieurs backticks : `` a`b ``).
function markerLen(state: { sliceDoc(from: number, to: number): string }, node: SyntaxNode, name: string): number {
  if (name === 'Emphasis') return 1
  if (name === 'InlineCode') return /^`+/.exec(stateSlice(state, node))![0].length
  return 2
}

function stateSlice(state: { sliceDoc(from: number, to: number): string }, node: SyntaxNode): string {
  return state.sliceDoc(node.from, node.to)
}

// Nœud `name` englobant TOUT [from, to], ou null.
function enclosing(view: EditorView, from: number, to: number, name: string): SyntaxNode | null {
  let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(from, 1)
  for (; node; node = node.parent) {
    if (node.name === name && node.from <= from && node.to >= to) return node
  }
  return null
}

// La borne [pos] est-elle STRICTEMENT à l'intérieur d'un nœud `name` ? Le côté compte :
// une borne collée au bord d'un nœud n'est pas dedans — sonder `to` avec side 1 ferait
// ENTRER dans le nœud qui commence à to (revue : sélectionner `x ` collé à `**bold**`
// rendait Ctrl+B muet).
function insideAt(view: EditorView, pos: number, side: -1 | 1, name: string): boolean {
  let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(pos, side)
  for (; node; node = node.parent) {
    if (node.name === name && node.from < pos && node.to > pos) return true
  }
  return false
}

// Zone où l'on n'écrit JAMAIS de formatage : le code (un `*` y est un octet littéral du
// code de l'utilisateur, pas un marqueur) et la plomberie d'un lien/d'une image (URL,
// crochets — un `**` dans une URL détruit le lien).
const NO_WRITE_ZONES = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'CodeText', 'URL', 'LinkMark'])

function inNoWriteZone(view: EditorView, pos: number, side: -1 | 1): boolean {
  let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(pos, side)
  for (; node; node = node.parent) if (NO_WRITE_ZONES.has(node.name)) return true
  return false
}

// Un bloc de code (fence ou indenté) croise-t-il [from, to] ? Les opérations de LIGNE
// s'interdisent alors : préfixer les lignes d'un fence le déchiquette en items de liste.
function crossesCodeBlock(view: EditorView, from: number, to: number): boolean {
  let found = false
  syntaxTree(view.state).iterate({
    from,
    to,
    enter(node) {
      if (node.name === 'FencedCode' || node.name === 'CodeBlock') found = true
      return !found
    },
  })
  return found
}

// Toggle d'un marqueur inline. Déjà dans un nœud du type visé (même partiellement
// sélectionné, même au caret) → le nœud ENTIER est dé-enveloppé : dé-formater la moitié
// d'un gras produirait `**b**ol**d**`. Sinon → enveloppe de la sélection.
// Portée : la sélection PRINCIPALE seule (pas de changeByRange) — Doku n'expose pas de
// multi-curseur ; les curseurs secondaires éventuels sont simplement remplacés.
function toggleInline(view: EditorView, mark: InlineMark): boolean {
  const { from, to, empty } = view.state.selection.main
  const name = NODE_FOR[mark]
  const node = enclosing(view, from, to, name)
  if (node) {
    let len = markerLen(view.state, node, name)
    let a = node.from + len
    let b = node.to - len
    // Code span rembourré (`` ` x ` ``) : CommonMark retire une espace de chaque côté
    // au rendu — on les retire aussi au déballage, sinon elles doublent dans le texte.
    if (name === 'InlineCode' && b - a >= 2) {
      const inner = view.state.sliceDoc(a, b)
      if (inner.startsWith(' ') && inner.endsWith(' ') && inner.trim().length > 0) {
        a += 1
        b -= 1
      }
    }
    view.dispatch({
      changes: [
        { from: node.from, to: a },
        { from: b, to: node.to },
      ],
      selection: empty
        ? { anchor: Math.min(Math.max(from - (a - node.from), node.from), node.from + (b - a)) }
        : { anchor: node.from, head: node.from + (b - a) },
      userEvent: 'input.format',
    })
    return true
  }
  // Hors du nœud visé mais dans une zone interdite (code, URL d'un lien…) : ne rien
  // écrire — et consommer la touche, sinon le defaultKeymap de CM6 ferait autre chose
  // (Mod-i = selectParentSyntax).
  if (inNoWriteZone(view, from, 1) || inNoWriteZone(view, to, -1)) return true
  // Sélection à CHEVAL sur un nœud du type visé (une borne strictement dedans, l'autre
  // dehors) : envelopper produirait des marqueurs entrelacés invalides → no-op.
  if (insideAt(view, from, 1, name) || insideAt(view, to, -1, name)) return true
  const edit = wrapSelection(view.state.sliceDoc(from, to), MARKERS[mark])
  if (!edit) return true
  view.dispatch({
    changes: { from, to, insert: edit.insert },
    selection: { anchor: from + edit.selFrom, head: from + edit.selTo },
    userEvent: 'input.format',
  })
  return true
}

export const toggleBold = (view: EditorView) => toggleInline(view, 'bold')
export const toggleItalic = (view: EditorView) => toggleInline(view, 'italic')
export const toggleStrike = (view: EditorView) => toggleInline(view, 'strike')
export const toggleInlineCode = (view: EditorView) => toggleInline(view, 'code')

// Ctrl+K : lien. Dans un nœud Link (même sur le placeholder `url` que le wrap vient de
// sélectionner — « re-appuyer retire le formatage ») → dé-enveloppe le lien ENTIER.
export function toggleLink(view: EditorView): boolean {
  const { from, to } = view.state.selection.main
  const node = enclosing(view, from, to, 'Link')
  if (node) {
    const text = linkText(stateSlice(view.state, node))
    if (text === null) return true
    view.dispatch({
      changes: { from: node.from, to: node.to, insert: text },
      selection: { anchor: node.from, head: node.from + text.length },
      userEvent: 'input.format',
    })
    return true
  }
  // Dans une IMAGE : ni déballer (la sémantique diffère d'un lien), ni envelopper
  // (`![alt]([x](url))` détruirait l'image) → no-op.
  if (enclosing(view, from, to, 'Image')) return true
  if (inNoWriteZone(view, from, 1) || inNoWriteZone(view, to, -1)) return true
  if (insideAt(view, from, 1, 'Link') || insideAt(view, to, -1, 'Link')) return true
  const edit = makeLink(view.state.sliceDoc(from, to))
  if (!edit) return true
  view.dispatch({
    changes: { from, to, insert: edit.insert },
    selection: { anchor: from + edit.selFrom, head: from + edit.selTo },
    userEvent: 'input.format',
  })
  return true
}

// --- Opérations de ligne (titres, liste, citation) ---------------------------------

function selectedLines(view: EditorView): { from: number; to: number; lines: string[] } {
  const sel = view.state.selection.main
  const first = view.state.doc.lineAt(sel.from)
  const last = view.state.doc.lineAt(sel.to)
  const lines: string[] = []
  for (let n = first.number; n <= last.number; n++) lines.push(view.state.doc.line(n).text)
  return { from: first.from, to: last.to, lines }
}

function replaceLines(view: EditorView, from: number, to: number, lines: string[]): void {
  const insert = lines.join('\n')
  if (view.state.sliceDoc(from, to) === insert) return
  view.dispatch({ changes: { from, to, insert }, userEvent: 'input.format' })
}

function lineOp(view: EditorView, transform: (lines: string[]) => string[]): boolean {
  const sel = view.state.selection.main
  if (inNoWriteZone(view, sel.from, 1) || inNoWriteZone(view, sel.to, -1)) return true
  let { from, to } = selectedLines(view)
  // Titre setext (`Titre\n====`) : le nœud couvre le texte ET son soulignement — on
  // étend la portée et on RETIRE la ligne de soulignement, sinon elle resterait en
  // paragraphe orphelin après conversion (revue).
  const drop = new Set<number>()
  syntaxTree(view.state).iterate({
    from,
    to,
    enter(node) {
      if (node.name === 'SetextHeading1' || node.name === 'SetextHeading2') {
        from = Math.min(from, view.state.doc.lineAt(node.from).from)
        to = Math.max(to, view.state.doc.lineAt(node.to).to)
        drop.add(view.state.doc.lineAt(node.to).number)
      }
    },
  })
  if (crossesCodeBlock(view, from, to)) return true
  const firstLine = view.state.doc.lineAt(from)
  const lastLine = view.state.doc.lineAt(to)
  const lines: string[] = []
  for (let n = firstLine.number; n <= lastLine.number; n++) {
    if (!drop.has(n)) lines.push(view.state.doc.line(n).text)
  }
  replaceLines(view, firstLine.from, lastLine.to, transform(lines))
  return true
}

export const setHeading = (view: EditorView, level: number) => lineOp(view, (l) => toggleHeadingLines(l, level))
export const toggleList = (view: EditorView) => lineOp(view, (l) => toggleLinePrefix(l, '- '))
export const toggleQuote = (view: EditorView) => lineOp(view, (l) => toggleLinePrefix(l, '> '))

// --- Insertions de bloc -------------------------------------------------------------
// Insérées APRÈS la dernière ligne de la sélection — jamais À SA PLACE (le texte
// sélectionné est le chemin d'accès au menu, pas une cible à effacer). Lignes vides
// garanties de part et d'autre : un `---` collé sous un paragraphe est un titre setext
// (le paragraphe deviendrait un H2), et un tableau GFM n'interrompt pas un paragraphe.
function insertBlock(view: EditorView, template: string): boolean {
  const sel = view.state.selection.main
  if (inNoWriteZone(view, sel.to, -1)) return true
  const line = view.state.doc.lineAt(sel.to)
  const nextLine = line.number < view.state.doc.lines ? view.state.doc.line(line.number + 1) : null
  const prevBlank = line.number === 1 || view.state.doc.line(line.number - 1).text.trim().length === 0
  // Ligne courante pleine → saut + ligne vide. Ligne courante vide : le gabarit s'y
  // pose — il faut alors regarder la ligne d'AU-DESSUS (piège setext : `para\n---`
  // transformerait le paragraphe en titre H2).
  const before = line.text.trim().length > 0 ? '\n\n' : prevBlank ? '' : '\n'
  // L'insertion se fait AVANT la newline qui clôt la ligne courante : elle compte déjà
  // pour un saut. Un seul '\n' suffit donc à créer la ligne vide sous le gabarit.
  const after = nextLine === null ? '\n' : nextLine.text.trim().length === 0 ? '' : '\n'
  const insert = before + template + after
  view.dispatch({
    changes: { from: line.to, to: line.to, insert },
    selection: { anchor: line.to + before.length + template.length },
    userEvent: 'input.format',
  })
  return true
}

export const insertHr = (view: EditorView) => insertBlock(view, HR_TEMPLATE)
export const insertTable = (view: EditorView) => insertBlock(view, TABLE_TEMPLATE)

// Bloc de code : les lignes de la sélection passent DANS les fences (une fence peut,
// elle, interrompre un paragraphe — CommonMark). Déjà dans du code → no-op.
export function wrapCodeBlock(view: EditorView): boolean {
  const sel = view.state.selection.main
  if (inNoWriteZone(view, sel.from, 1) || inNoWriteZone(view, sel.to, -1)) return true
  const { from, to } = selectedLines(view)
  // Un fence dans la portée : l'envelopper casserait l'imbrication (le ``` intérieur
  // fermerait le nôtre) → no-op.
  if (crossesCodeBlock(view, from, to)) return true
  view.dispatch({
    changes: [
      { from, to: from, insert: '```\n' },
      { from: to, to, insert: '\n```' },
    ],
    userEvent: 'input.format',
  })
  return true
}

// Prec.highest OBLIGATOIRE : `minimalSetup` embarque `defaultKeymap`, qui lie déjà
// Mod-i (selectParentSyntax) — le piège exact du Mod-/ (toggleComment, gotcha 2026-07-10).
// Sans priorité, Ctrl+I déplacerait la sélection au lieu de mettre en italique.
// (Et ne jamais ajouter de variante Shift-Mod-k : deleteLine du defaultKeymap.)
export const formatKeymap = Prec.highest(
  keymap.of([
    { key: 'Mod-b', run: toggleBold, preventDefault: true },
    { key: 'Mod-i', run: toggleItalic, preventDefault: true },
    { key: 'Mod-k', run: toggleLink, preventDefault: true },
  ]),
)
