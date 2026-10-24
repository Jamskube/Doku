// Couche « live preview » de Doku (ADR-0002) : le buffer reste du Markdown,
// des décorations masquent la syntaxe hors des lignes actives (celles portant
// une sélection) et remplacent les marqueurs par des widgets.
// Origine : spike/src/live-preview.ts, validé par mesures le 2026-07-08.
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { Compartment, EditorState, Facet, type Range, StateField, type Transaction } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import { convertFileSrc } from '@tauri-apps/api/core'
import { isTauri } from '../tauri'
import { isBlockedImageUrl, resolveLocalImagePath } from '../images'
import { applyTableOp, escapeCellText, parseTable, tableCellSpans, type CellAlign, type TableOp } from '../table'

type CellAlignStyle = CellAlign
import { rephrasePreviewRange, setRephrasePreview } from './rephrase-preview'
import { revealScope, revealScopeField, setRevealScope } from './reveal'

// Dossier du document courant (fourni par état, dans DocumentView) — sert à
// résoudre les images relatives.
export const docDirFacet = Facet.define<string, string>({ combine: (v) => v[0] ?? '' })
export const docDirCompartment = new Compartment()

// URL affichable d'une image : externe telle quelle ; locale résolue au dossier
// puis convertie en asset:// (natif). En navigateur : chemin brut → erreur → placeholder.
// Source affichable, ou null si l'image doit être bloquée (réseau/UNC → placeholder).
function imageSrc(url: string, dir: string): string | null {
  const u = url.trim()
  if (isBlockedImageUrl(u)) return null
  if (/^data:/i.test(u)) return u
  const abs = resolveLocalImagePath(u, dir)
  return isTauri ? convertFileSrc(abs) : abs
}

class ImageWidget extends WidgetType {
  constructor(
    private url: string,
    private alt: string,
    private dir: string,
    private from: number,
  ) {
    super()
  }

  eq(o: ImageWidget) {
    return o.url === this.url && o.alt === this.alt && o.dir === this.dir && o.from === this.from
  }

  toDOM(view: EditorView) {
    // Conteneur stable géré par CM6 ; on mute son contenu à l'erreur (pas de
    // replaceWith, qui serait clobbered par la réconciliation DOM de CodeMirror).
    const wrap = document.createElement('span')
    // Clic-pour-éditer (3.7) : place le curseur sur la source → la ligne devient
    // active → la source markdown de l'image se révèle (même motif que CheckboxWidget).
    wrap.addEventListener('mousedown', (e) => {
      e.preventDefault()
      view.dispatch({ selection: { anchor: this.from } })
      view.focus()
    })
    const src = imageSrc(this.url, this.dir)
    if (src == null) {
      // Image distante/UNC bloquée (hors-ligne par principe) : jamais de requête.
      wrap.className = 'cm-lp-image-missing'
      wrap.textContent = this.alt ? `Image distante bloquée — ${this.alt}` : 'Image distante bloquée'
      return wrap
    }
    wrap.className = 'cm-lp-image-wrap'
    const img = document.createElement('img')
    img.className = 'cm-lp-image'
    img.alt = this.alt
    img.src = src
    img.addEventListener('error', () => {
      wrap.className = 'cm-lp-image-missing'
      wrap.textContent = this.alt ? `Image introuvable — ${this.alt}` : 'Image introuvable'
    })
    wrap.appendChild(img)
    return wrap
  }

  ignoreEvent() {
    return true
  }
}

class CheckboxWidget extends WidgetType {
  constructor(
    private checked: boolean,
    private from: number,
  ) {
    super()
  }

  eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.from === this.from
  }

  toDOM(view: EditorView) {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = this.checked
    box.className = 'cm-task-checkbox'
    box.addEventListener('mousedown', (e) => {
      e.preventDefault()
      view.dispatch({
        changes: { from: this.from, to: this.from + 3, insert: this.checked ? '[ ]' : '[x]' },
      })
    })
    return box
  }

  ignoreEvent() {
    return true
  }
}

const WIKILINK = /\[\[([^[\]\n]+)\]\]/g
const HIDDEN_MARKS = new Set(['HeaderMark', 'EmphasisMark', 'CodeMark', 'StrikethroughMark', 'QuoteMark'])
const HEADING_LINE = new Map([
  ['ATXHeading1', 'cm-lp-h1'],
  ['ATXHeading2', 'cm-lp-h2'],
  ['ATXHeading3', 'cm-lp-h3'],
])

// Lignes où la syntaxe est révélée (ADR-0017, 20.1).
//
// La révélation n'est plus un effet de bord du curseur : elle n'a lieu que si
// l'utilisateur l'a DEMANDÉE (`revealScopeField` = 'block', posé par Tab). Sans geste,
// l'ensemble est vide → on écrit dans le rendu, les marqueurs restent masqués.
function activeLineSet(state: EditorState): Set<number> {
  const set = new Set<number>()
  if (revealScope(state) === 'none') return set
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number
    const b = state.doc.lineAt(r.to).number
    for (let n = a; n <= b; n++) set.add(n)
  }
  return set
}

function buildDecorations(view: EditorView): DecorationSet {
  const decos: Range<Decoration>[] = []
  const { state } = view
  const docDir = state.facet(docDirFacet)

  const activeLines = activeLineSet(state)
  // Ensemble vide (aucune révélation demandée — le cas permanent hors Tab) : court-circuit
  // qui épargne 2 doc.lineAt par nœud décoré du viewport, à chaque frappe.
  const isActive = activeLines.size === 0
    ? () => false
    : (from: number, to: number) => {
        const a = state.doc.lineAt(from).number
        const b = state.doc.lineAt(to).number
        for (let n = a; n <= b; n++) if (activeLines.has(n)) return true
        return false
      }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        const { name } = node

        const headingClass = HEADING_LINE.get(name)
        if (headingClass) {
          decos.push(Decoration.line({ class: headingClass }).range(state.doc.lineAt(node.from).from))
        }

        if (HIDDEN_MARKS.has(name) && !isActive(node.from, node.to)) {
          const eatSpace =
            (name === 'HeaderMark' || name === 'QuoteMark') &&
            state.sliceDoc(node.to, node.to + 1) === ' '
          decos.push(Decoration.replace({}).range(node.from, eatSpace ? node.to + 1 : node.to))
          return
        }

        if (name === 'ListMark' && !isActive(node.from, node.to)) {
          // pour une tâche, le `- ` disparaît : seule la checkbox reste
          const after = state.sliceDoc(node.to + 1, node.to + 4)
          if (/^\[[ xX]\]/.test(after)) {
            decos.push(Decoration.replace({}).range(node.from, node.to + 1))
          }
          return
        }

        if (name === 'TaskMarker') {
          const checked = state.sliceDoc(node.from, node.to).toLowerCase().includes('x')
          if (!isActive(node.from, node.to)) {
            decos.push(
              Decoration.replace({ widget: new CheckboxWidget(checked, node.from) }).range(node.from, node.to),
            )
            if (checked) {
              const line = state.doc.lineAt(node.from)
              if (node.to + 1 < line.to) {
                decos.push(Decoration.mark({ class: 'cm-lp-task-done' }).range(node.to + 1, line.to))
              }
            }
          }
          return
        }

        if (name === 'Blockquote') {
          const first = state.doc.lineAt(node.from).number
          const last = state.doc.lineAt(node.to).number
          for (let n = first; n <= last; n++) {
            decos.push(Decoration.line({ class: 'cm-lp-quote' }).range(state.doc.line(n).from))
          }
          return
        }

        if (name === 'Image') {
          if (isActive(node.from, node.to)) return
          const raw = state.sliceDoc(node.from, node.to)
          const m = /^!\[([^\]]*)\]\(([^)\s]+)/.exec(raw)
          if (m) {
            decos.push(
              Decoration.replace({ widget: new ImageWidget(m[2], m[1], docDir, node.from) }).range(node.from, node.to),
            )
          }
          return false
        }

        if (name === 'Link') {
          if (isActive(node.from, node.to)) return
          for (let child = node.node.firstChild; child; child = child.nextSibling) {
            if (child.name === 'LinkMark' || child.name === 'URL') {
              decos.push(Decoration.replace({}).range(child.from, child.to))
            }
          }
          decos.push(Decoration.mark({ class: 'cm-lp-link' }).range(node.from, node.to))
          return false
        }

        if (name === 'FencedCode') {
          const first = state.doc.lineAt(node.from).number
          const last = state.doc.lineAt(node.to).number
          for (let n = first; n <= last; n++) {
            decos.push(Decoration.line({ class: 'cm-lp-codeblock' }).range(state.doc.line(n).from))
          }
        }

        if (name === 'CodeInfo' && !isActive(node.from, node.to)) {
          decos.push(Decoration.replace({}).range(node.from, node.to))
        }
      },
    })

    // wikilinks : hors grammaire lezer, détectés par regex sur le texte visible
    const text = state.sliceDoc(from, to)
    for (const m of text.matchAll(WIKILINK)) {
      const start = from + m.index!
      const end = start + m[0].length
      const mark = Decoration.mark({
        class: 'cm-lp-wikilink',
        attributes: { 'data-target': m[1] },
      })
      if (isActive(start, end)) {
        decos.push(mark.range(start, end))
      } else {
        decos.push(Decoration.replace({}).range(start, start + 2))
        decos.push(mark.range(start + 2, end - 2))
        decos.push(Decoration.replace({}).range(end - 2, end))
      }
    }
  }

  return Decoration.set(decos, true)
}

// Widget-bloc d'un tableau GFM (3.7). Rendu en `<table>` ; les cellules restent du
// Bornes ACTUELLES du bloc tableau qui commence à `from`. Indispensable dès qu'on écrit :
// la taille du bloc change à chaque édition, et une longueur mémorisée devient fausse.
// On s'étend ligne à ligne tant que la ligne ressemble à une ligne de tableau.
// Bornes du bloc tableau contenant `pos`, données par l'ARBRE SYNTAXIQUE — jamais par
// une heuristique « la ligne contient un pipe » : elle absorberait un bloc suivant que
// lezer exclut du tableau (`- item | note`, `> citation | x`…) et une action de
// structure le réécrirait en ligne de tableau (corruption hors bloc, ADR-0002).
// Étendu aux frontières de ligne, comme l'ancrage des décorations (tableau indenté).
function currentTableRange(state: EditorState, pos: number): { from: number; to: number } | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1)
  while (node && node.name !== 'Table') node = node.parent
  if (!node) return null
  return {
    from: state.doc.lineAt(node.from).from,
    to: state.doc.lineAt(node.to).to,
  }
}

// texte brut (le formatage inline dans les cellules est hors scope v1 — au clic, la
// source markdown complète se révèle pour édition).
class TableWidget extends WidgetType {
  constructor(
    private md: string,
    private from: number,
  ) {
    super()
  }

  eq(o: TableWidget) {
    return o.md === this.md && o.from === this.from
  }

  // Écrire dans une cellule change `md` → CM6 remplacerait le DOM et TUERAIT le focus
  // en pleine saisie (Tab d'une cellule à l'autre deviendrait inutilisable). On met donc
  // à jour le DOM existant en place : seule la cellule qui n'a plus la bonne valeur est
  // retouchée, et jamais celle que l'utilisateur est en train d'éditer.
  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    const parsed = parseTable(this.md)
    if (!parsed || dom.tagName !== 'TABLE') return false
    // La FORME a-t-elle changé (action de structure 20.3, édition externe) ? Réutiliser le
    // DOM garderait le mauvais nombre de lignes/colonnes et des listeners liés à l'ancien
    // widget (bug constaté en navigateur : la ligne ajoutée n'apparaissait pas, puis les
    // cellules affichaient les valeurs d'une autre ligne — qu'un blur aurait ÉCRITES dans
    // le document). `false` → CM6 reconstruit via toDOM. La frappe dans une cellule ne
    // change jamais la géométrie : le chemin préserve-focus de 20.2 reste intact.
    const trs = Array.from(dom.querySelectorAll('tr'))
    if (trs.length !== parsed.rows.length + 1) return false
    if (trs.some((tr) => tr.children.length !== parsed.headers.length)) return false
    const ths = Array.from(dom.querySelectorAll<HTMLElement>('thead th'))
    if (ths.some((el, i) => (el.style.textAlign || null) !== parsed.aligns[i])) return false
    const active = document.activeElement
    for (const el of Array.from(dom.querySelectorAll<HTMLElement>('.cm-lp-cellin'))) {
      if (el === active) continue // ne jamais écraser la cellule en cours de frappe
      const line = Number(el.dataset.line)
      const col = Number(el.dataset.col)
      const next = line === 0 ? (parsed.headers[col] ?? '') : (parsed.rows[line - 2]?.[col] ?? '')
      if ((el.textContent ?? '') !== next) el.textContent = next
    }
    void view
    return true
  }

  // Bornes RÉELLES du bloc au moment du geste, dérivées du DOM. `this.from` est figé à
  // la création du widget : quand updateDOM réutilise le DOM, les listeners appartiennent
  // à un ANCIEN widget dont l'offset ne vaut plus rien dès qu'on a édité au-dessus du
  // tableau — écrire là écraserait du texte hors tableau. Le DOM, lui, est toujours à sa
  // place dans la vue : posAtDOM donne la position vraie, à chaque fois.
  private anchorRange(view: EditorView, table: HTMLElement): { from: number; to: number } | null {
    if (!table.isConnected) return null
    try {
      return currentTableRange(view.state, view.posAtDOM(table))
    } catch {
      return null
    }
  }

  // Écrit UNE cellule dans la source (20.2). Remplacement d'un intervalle de quelques
  // caractères — jamais une regénération du bloc (ADR-0002, warning critique n°1) : les
  // pipes, le padding, les alignements et les cellules voisines ne sont pas touchés.
  private commitCell(view: EditorView, table: HTMLElement, line: number, col: number, raw: string): void {
    const range = this.anchorRange(view, table)
    if (!range) return
    const md = view.state.sliceDoc(range.from, range.to)
    const span = tableCellSpans(md).find((s) => s.line === line && s.col === col)
    if (!span) return
    const next = escapeCellText(raw)
    if (md.slice(span.from, span.to) === next) return // rien à écrire
    view.dispatch({
      changes: { from: range.from + span.from, to: range.from + span.to, insert: next },
    })
  }

  // Action de structure (20.3). Contrairement à l'écriture d'une cellule, la forme du
  // tableau change → on réécrit LE BLOC (et lui seul). `applyTableOp` renvoie null quand
  // l'action produirait un tableau invalide : dans ce cas on n'écrit rien.
  private runOp(view: EditorView, table: HTMLElement, op: TableOp): void {
    const range = this.anchorRange(view, table)
    if (!range) return
    const md = view.state.sliceDoc(range.from, range.to)
    const next = applyTableOp(md, op)
    if (next === null || next === md) return
    view.dispatch({ changes: { from: range.from, to: range.to, insert: next } })
  }

  toDOM(view: EditorView) {
    const parsed = parseTable(this.md)
    if (!parsed) {
      const span = document.createElement('span')
      span.textContent = this.md
      return span
    }
    const table = document.createElement('table')
    table.className = 'cm-lp-table'
    // Le widget vit DANS la zone contenteditable de CM6. Sans ce `false`, CodeMirror
    // considère le tableau comme du contenu qu'il gère lui-même : un clic sélectionne
    // alors le bloc entier au lieu d'entrer dans la case. On rend donc le tableau
    // non-éditable, et on rouvre l'édition case par case (îlots `contenteditable`).
    table.contentEditable = 'false'
    // Le widget est dans la zone éditable de CM6 : sans cette barrière, la frappe et le
    // collage faits dans une case remontent à l'éditeur, qui les écrit dans le document
    // à la position de SON curseur (bug constaté en navigateur : le texte atterrissait
    // en tête de tableau). Les cases restent éditables, mais l'event ne sort plus du widget.
    for (const type of ['beforeinput', 'input', 'keypress', 'paste', 'cut', 'compositionstart', 'compositionend']) {
      table.addEventListener(type, (e) => e.stopPropagation())
    }

    // Pose le caret dans la ZONE DE SAISIE d'une cellule (le span .cm-lp-cellin, jamais
    // le th/td qui héberge aussi les boutons ±), en fin de texte. Un hôte éditable sans
    // nœud texte peut refuser la frappe (Chromium, bug constaté en navigateur) : on
    // garantit le nœud d'accueil. `force` ignore une sélection déjà posée (Tab : on
    // vient saisir, pas relire).
    const placeCaret = (zone: HTMLElement, force = false) => {
      const sel = window.getSelection()
      if (!sel) return
      const anchor = sel.anchorNode
      const inText = !force && !!anchor && anchor.nodeType === Node.TEXT_NODE && zone.contains(anchor)
      if (inText) return // le clic a posé le caret dans le texte : on n'y touche pas
      const r = document.createRange()
      let txt = Array.from(zone.childNodes).find((n) => n.nodeType === Node.TEXT_NODE)
      if (!txt) {
        // Vide, il est invisible et ne change rien au texte committé.
        txt = document.createTextNode('')
        zone.insertBefore(txt, zone.firstChild)
      }
      r.selectNodeContents(txt)
      r.collapse(false)
      sel.removeAllRanges()
      sel.addRange(r)
    }

    // Cellule éditable EN PLACE (20.2). Le widget se re-peuple lui-même à chaque toDOM :
    // la virtualisation CM6 détruit le DOM hors viewport, un contenu posé de l'extérieur
    // reviendrait vide (gotcha connue des widgets).
    const cells: HTMLElement[] = []
    const makeCell = (tag: 'th' | 'td', text: string, line: number, col: number, align: CellAlignStyle) => {
      const cell = document.createElement(tag)
      if (align) cell.style.textAlign = align
      // Le texte éditable vit dans un SPAN interne : la cellule elle-même reste non
      // éditable et héberge l'îlot des boutons ±. Un hôte `contenteditable` dont un
      // enfant ne l'est pas refuse la frappe quand il est vide (Chromium ne sait pas y
      // poser de caret exploitable — bug constaté en navigateur sur toute ligne/colonne
      // fraîchement ajoutée) : on sépare donc strictement zone de saisie et boutons.
      const el = document.createElement('span')
      el.className = 'cm-lp-cellin'
      el.textContent = text
      el.contentEditable = 'true'
      el.spellcheck = false
      // Focusable explicitement : un `contenteditable` seul n'est pas fiablement
      // atteignable au clavier (et ne l'est pas du tout sous jsdom, donc intestable).
      el.tabIndex = -1
      el.dataset.line = String(line)
      el.dataset.col = String(col)
      cell.appendChild(el)
      cells.push(el)

      const cellText = () => el.textContent ?? ''

      // CM6 pose sa propre sélection sur un mousedown dans son contenu : sans cette
      // interception, cliquer dans une case sélectionne tout le tableau. On prend la
      // main et on place le focus dans la case visée — y compris sur un clic dans le
      // padding de la cellule, hors de la zone de saisie.
      cell.addEventListener('mousedown', (e) => {
        e.stopPropagation()
      })
      cell.addEventListener('click', (e) => {
        if (e.target === cell) {
          el.focus()
          placeCaret(el, true)
        }
      })

      // Actions de structure au survol (20.3) : boutons discrets dans la cellule, plutôt
      // qu'un menu à aller chercher. Ils n'apparaissent qu'au survol (CSS) et agissent sur
      // la ligne / la colonne de CETTE cellule.
      const tools = document.createElement('span')
      tools.className = 'cm-lp-tools'
      tools.contentEditable = 'false'
      const addTool = (label: string, title: string, op: TableOp) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'cm-lp-tool'
        b.textContent = label
        b.title = title
        b.tabIndex = -1
        // `mousedown` : agir AVANT que le blur de la cellule ne déplace le focus.
        b.addEventListener('mousedown', (e) => {
          e.preventDefault()
          e.stopPropagation()
          // Une saisie en cours est d'abord validée (blur → commitCell) : sans ça, la
          // réécriture du bloc repartirait du document SANS le texte tapé, et la
          // reconstruction du widget (géométrie changée) le perdrait définitivement.
          const active = document.activeElement
          if (active instanceof HTMLElement && active.classList.contains('cm-lp-cellin') && table.contains(active)) {
            active.blur()
          }
          this.runOp(view, table, op)
        })
        tools.appendChild(b)
      }
      if (line === 0) {
        // En-tête : la colonne est l'unité qui a du sens.
        addTool('+', 'Ajouter une colonne à droite', { kind: 'addColRight', col })
        addTool('−', 'Supprimer cette colonne', { kind: 'deleteCol', col })
      } else if (col === 0) {
        // Première cellule d'une ligne de corps : actions de ligne.
        addTool('+', 'Ajouter une ligne en dessous', { kind: 'addRowBelow', row: line })
        addTool('−', 'Supprimer cette ligne', { kind: 'deleteRow', row: line })
      }
      // Dans la CELLULE, jamais dans la zone de saisie (voir le commentaire du span).
      if (tools.childElementCount > 0) cell.appendChild(tools)

      // La valeur de référence pour Échap est capturée AU FOCUS : celle de la création du
      // widget (`text`) devient périmée dès qu'updateDOM a rafraîchi la cellule en place.
      el.addEventListener('focus', () => {
        el.dataset.orig = cellText()
        placeCaret(el)
      })
      // Filet post-clic : selon le point d'impact, le navigateur peut n'avoir posé aucun
      // caret exploitable (cellule vide, clic dans le padding) — on répare après coup.
      el.addEventListener('click', () => placeCaret(el))

      // Écriture à la sortie de la cellule : une frappe par caractère ferait re-rendre
      // le widget à chaque touche (et perdrait le focus). On écrit au blur / Entrée / Tab.
      el.addEventListener('blur', () => this.commitCell(view, table, line, col, cellText()))

      el.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
          // Tab NAVIGUE entre les cellules — c'est ce qui rend une saisie de 100 lignes
          // praticable, et la raison pour laquelle Tab ne bascule pas la source ici (ADR-0017).
          e.preventDefault()
          e.stopPropagation()
          const i = cells.indexOf(el)
          const next = cells[i + (e.shiftKey ? -1 : 1)]
          if (next) {
            next.focus()
            // Curseur en fin de cellule (on vient y saisir, pas relire).
            placeCaret(next, true)
          } else {
            el.blur() // dernière cellule : on valide et on sort
          }
          return
        }
        if (e.key === 'Enter') {
          e.preventDefault()
          e.stopPropagation()
          el.blur() // valide la saisie ; pas de retour à la ligne dans une cellule GFM
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          // Annule : restaure la valeur capturée au focus (celle de la création du
          // widget serait périmée après un premier passage dans la cellule).
          el.textContent = el.dataset.orig ?? text
          el.blur()
          return
        }
        // Les autres touches restent locales à la cellule : sans ça, CM6 les capterait
        // et éditerait le document par-dessous.
        e.stopPropagation()
      })

      return cell
    }

    const thead = document.createElement('thead')
    const htr = document.createElement('tr')
    parsed.headers.forEach((h, i) => htr.appendChild(makeCell('th', h, 0, i, parsed.aligns[i])))
    thead.appendChild(htr)
    table.appendChild(thead)

    const tbody = document.createElement('tbody')
    parsed.rows.forEach((row, r) => {
      const tr = document.createElement('tr')
      // +2 : l'en-tête et la ligne de délimiteurs précèdent le corps dans la source.
      parsed.headers.forEach((_, i) => tr.appendChild(makeCell('td', row[i] ?? '', r + 2, i, parsed.aligns[i])))
      tbody.appendChild(tr)
    })
    table.appendChild(tbody)
    return table
  }

  // `false` : les events doivent atteindre les cellules éditables (focus, frappe,
  // sélection). Avec `true`, CM6 les avalerait et la saisie serait impossible.
  ignoreEvent() {
    return false
  }
}

// Un tableau traverse plusieurs lignes → sa décoration `replace` est block-level, ce
// qu'un `ViewPlugin` ne peut pas fournir. On passe donc par un `StateField` dédié.
// Le widget n'est posé que hors ligne active (curseur absent) : sinon la source
// markdown reste éditable en place.
// Seuls blocs où un tableau peut se nicher : on ne descend que dans eux. Paragraphes,
// blocs de code (et leurs arbres de langage montés) ou HTML sont sautés d'un bloc — c'est
// ce qui rend le parcours proportionnel au nombre de BLOCS, pas de nœuds inline.
const TABLE_CONTAINERS = new Set(['Document', 'Blockquote', 'BulletList', 'OrderedList', 'ListItem'])

// Non borné au viewport, contrairement au ViewPlugin : borné en pratique par la coupure
// live-preview des gros fichiers (≥ 1,5 Mo → mode source). `from`/`to` restreignent le
// parcours aux tableaux qui recoupent cette plage (mise à jour incrémentale).
function collectTables(state: EditorState, from?: number, to?: number): Range<Decoration>[] {
  const decos: Range<Decoration>[] = []
  const activeLines = activeLineSet(state)
  const preview = rephrasePreviewRange(state)
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (node.name !== 'Table') return TABLE_CONTAINERS.has(node.name)
      // Un block-replace DOIT couvrir des lignes entières : ancrer sur les frontières
      // de ligne (un tableau indenté a un node.from en milieu de ligne).
      const from = state.doc.lineAt(node.from).from
      const to = state.doc.lineAt(node.to).to
      // Un aperçu de reformulation (replace inline, rephrase-preview.ts) qui chevauche le
      // tableau interdit le widget-bloc : deux replaces partiellement superposés = rendu
      // indéfini CM6. Le tableau reste en source tant que l'aperçu vit.
      if (preview && preview.from <= to && from <= preview.to) return false
      // Depuis l'ADR-0017, `activeLines` n'est peuplé QUE sur geste explicite de
      // révélation. Le curseur seul ne fait donc plus tomber le tableau : on peut
      // cliquer dans une cellule et y saisir (20.2) sans voir la source resurgir.
      const first = state.doc.lineAt(from).number
      const last = state.doc.lineAt(to).number
      let revealed = false
      for (let n = first; n <= last; n++) if (activeLines.has(n)) { revealed = true; break }
      if (!revealed) {
        decos.push(
          Decoration.replace({ widget: new TableWidget(state.sliceDoc(from, to), from), block: true }).range(from, to),
        )
      }
      return false // ne pas descendre dans les cellules
    },
  })
  return decos
}

// Exporté pour les tests (égalité incrémental / reconstruction complète).
export function buildTableDecorations(state: EditorState): DecorationSet {
  return Decoration.set(collectTables(state), true)
}

// Frappe ordinaire : on décale les widgets existants et on ne reparcourt que la zone
// touchée, au lieu de tout l'arbre à chaque touche (21 % du dispatch sur 180 Ko).
// `null` = cas non prouvé sûr → reconstruction complète par l'appelant.
function updateTableDecorations(deco: DecorationSet, tr: Transaction): DecorationSet | null {
  const { state, startState, changes } = tr
  const { doc } = state
  const tree = syntaxTree(state)
  const oldTree = syntaxTree(startState)
  // Arbre partiel (gros fichier en cours d'analyse) : des tableaux restent à découvrir.
  if (tree.length < doc.length || oldTree.length < startState.doc.length) return null

  let a = doc.length
  let b = 0
  changes.iterChangedRanges((_fA, _tA, fB, tB) => {
    a = Math.min(a, fB)
    b = Math.max(b, tB)
  })
  // Une ligne de contexte de chaque côté : effacer la ligne qui précède un en-tête ou une
  // ligne vide entre deux blocs crée/défait un tableau qui ne touche pas la modification.
  let from = doc.line(Math.max(1, doc.lineAt(a).number - 1)).from
  let to = doc.line(Math.min(doc.lines, doc.lineAt(b).number + 1)).to

  // Point de resynchronisation : le premier bloc de premier niveau qui suit la zone. S'il
  // est identique (type, bornes décalées) dans l'ancien arbre, l'analyse en aval est la même
  // — elle ne dépend que du texte qui suit, inchangé. Sinon (« ``` » ouvert au-dessus d'un
  // tableau, qui avale la suite du document), on reconstruit tout.
  let next = tree.topNode.childAfter(to)
  while (next && next.from <= to) next = next.nextSibling
  if (next) {
    const oldFrom = changes.invertedDesc.mapPos(next.from)
    const old = oldTree.topNode.childAfter(oldFrom)
    if (!old || old.from !== oldFrom || old.name !== next.name || changes.mapPos(old.to) !== next.to) return null
    to = next.from - 1
  } else {
    to = doc.length
  }

  deco = deco.map(changes)
  // Un tableau qui commence avant la zone (ou un ancien widget qui la déborde) l'étend,
  // jusqu'à stabilité : sinon un widget périmé et le nouveau se chevaucheraient.
  for (;;) {
    let f = from
    let t = to
    deco.between(from, to, (df, dt) => {
      f = Math.min(f, df)
      t = Math.max(t, dt)
    })
    tree.iterate({
      from,
      to,
      enter(node) {
        if (node.name !== 'Table') return TABLE_CONTAINERS.has(node.name)
        f = Math.min(f, doc.lineAt(node.from).from)
        t = Math.max(t, doc.lineAt(node.to).to)
        return false
      },
    })
    if (f === from && t === to) break
    from = f
    to = t
  }
  return deco.update({
    filter: (f, t) => t < from || f > to,
    filterFrom: from,
    filterTo: to,
    add: collectTables(state, from, to),
  })
}

export const tableField = StateField.define<DecorationSet>({
  create: (state) => buildTableDecorations(state),
  update(deco, tr) {
    // Recalcul sur édition, avancée du parseur (le tableau peut être sous la frontière
    // d'analyse au chargement), ou pose/retrait d'un aperçu de reformulation (les tables
    // qu'il chevauchait doivent re-rendre leur widget). Un mouvement de curseur seul ne
    // compte que si une révélation est active (ADR-0017 : sinon activeLineSet est vide,
    // le rendu serait identique — inutile de re-parcourir l'arbre à chaque flèche).
    const revealActive = revealScope(tr.state) !== 'none'
    const effects = tr.effects.some((e) => e.is(setRephrasePreview) || e.is(setRevealScope))
    // L'arbre change d'objet à CHAQUE édition (réanalyse incrémentale dans la même
    // transaction) : seul un changement d'arbre SANS édition signale l'avancée du parseur.
    // États annexes testés au DÉPART et à l'ARRIVÉE : une édition étrangère vide l'aperçu
    // SANS effet, et le tableau qu'il bloquait, loin de la zone éditée, doit revenir.
    if (
      tr.docChanged && !effects &&
      !revealActive && revealScope(tr.startState) === 'none' &&
      !rephrasePreviewRange(tr.state) && !rephrasePreviewRange(tr.startState)
    ) {
      return updateTableDecorations(deco, tr) ?? buildTableDecorations(tr.state)
    }
    if (
      tr.docChanged ||
      effects ||
      (tr.selection && revealActive) ||
      syntaxTree(tr.state) !== syntaxTree(tr.startState)
    ) {
      return buildTableDecorations(tr.state)
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

export function livePreview() {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet

        constructor(view: EditorView) {
          this.decorations = buildDecorations(view)
        }

        update(update: ViewUpdate) {
          // `transactions.some(...)` est indispensable : sans lui, presser Tab changerait
          // l'état de révélation sans jamais recalculer les décorations (rien à l'écran).
          // Le dossier du document change au PREMIER enregistrement d'une note neuve
          // (`docDirCompartment` reconfiguré) : sans cette comparaison, les images collées
          // restaient en placeholder jusqu'à la prochaine frappe. Vu en revue 2026-09-11.
          if (
            update.docChanged ||
            update.selectionSet ||
            update.viewportChanged ||
            update.startState.facet(docDirFacet) !== update.state.facet(docDirFacet) ||
            update.transactions.some((tr) => tr.effects.some((e) => e.is(setRevealScope)))
          ) {
            this.decorations = buildDecorations(update.view)
          }
        }
      },
      { decorations: (v) => v.decorations },
    ),
    revealScopeField,
    tableField,
    EditorView.domEventHandlers({
      mousedown(e) {
        const wiki = (e.target as HTMLElement).closest('.cm-lp-wikilink') as HTMLElement | null
        if (wiki?.dataset.target) {
          window.dispatchEvent(new CustomEvent('doku:wikilink', { detail: wiki.dataset.target }))
        }
      },
    }),
  ]
}
