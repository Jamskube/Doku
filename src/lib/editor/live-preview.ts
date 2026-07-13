// Couche « live preview » de Doku (ADR-0002) : le buffer reste du Markdown,
// des décorations masquent la syntaxe hors des lignes actives (celles portant
// une sélection) et remplacent les marqueurs par des widgets.
// Origine : spike/src/live-preview.ts, validé par mesures le 2026-07-08.
import { syntaxTree } from '@codemirror/language'
import { EditorState, Facet, type Range, StateField } from '@codemirror/state'
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
import { parseTable } from '../table'

// Dossier du document courant (fourni par état, dans DocumentView) — sert à
// résoudre les images relatives.
export const docDirFacet = Facet.define<string, string>({ combine: (v) => v[0] ?? '' })

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

// Lignes portant une sélection : c'est là que la syntaxe se révèle (édition en place).
function activeLineSet(state: EditorState): Set<number> {
  const set = new Set<number>()
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
  const isActive = (from: number, to: number) => {
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

  toDOM(view: EditorView) {
    const parsed = parseTable(this.md)
    if (!parsed) {
      const span = document.createElement('span')
      span.textContent = this.md
      return span
    }
    const table = document.createElement('table')
    table.className = 'cm-lp-table'
    // Clic-pour-éditer (3.7) : place le curseur sur la source → la ligne devient
    // active → le markdown du tableau se révèle (motif CheckboxWidget).
    table.addEventListener('mousedown', (e) => {
      e.preventDefault()
      view.dispatch({ selection: { anchor: this.from } })
      view.focus()
    })

    const thead = document.createElement('thead')
    const htr = document.createElement('tr')
    parsed.headers.forEach((h, i) => {
      const th = document.createElement('th')
      th.textContent = h
      if (parsed.aligns[i]) th.style.textAlign = parsed.aligns[i]!
      htr.appendChild(th)
    })
    thead.appendChild(htr)
    table.appendChild(thead)

    const tbody = document.createElement('tbody')
    for (const row of parsed.rows) {
      const tr = document.createElement('tr')
      parsed.headers.forEach((_, i) => {
        const td = document.createElement('td')
        td.textContent = row[i] ?? ''
        if (parsed.aligns[i]) td.style.textAlign = parsed.aligns[i]!
        tr.appendChild(td)
      })
      tbody.appendChild(tr)
    }
    table.appendChild(tbody)
    return table
  }

  ignoreEvent() {
    return true // le clic est géré par le listener mousedown attaché dans toDOM
  }
}

// Un tableau traverse plusieurs lignes → sa décoration `replace` est block-level, ce
// qu'un `ViewPlugin` ne peut pas fournir. On passe donc par un `StateField` dédié.
// Le widget n'est posé que hors ligne active (curseur absent) : sinon la source
// markdown reste éditable en place.
// Itère l'arbre complet (non borné au viewport, contrairement au ViewPlugin) : borné
// en pratique par la coupure live-preview des gros fichiers (≥ 1,5 Mo → mode source).
function buildTableDecorations(state: EditorState): DecorationSet {
  const decos: Range<Decoration>[] = []
  const activeLines = activeLineSet(state)
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'Table') return
      // Un block-replace DOIT couvrir des lignes entières : ancrer sur les frontières
      // de ligne (un tableau indenté a un node.from en milieu de ligne).
      const from = state.doc.lineAt(node.from).from
      const to = state.doc.lineAt(node.to).to
      const first = state.doc.lineAt(from).number
      const last = state.doc.lineAt(to).number
      let active = false
      for (let n = first; n <= last; n++) if (activeLines.has(n)) { active = true; break }
      if (!active) {
        decos.push(
          Decoration.replace({ widget: new TableWidget(state.sliceDoc(from, to), from), block: true }).range(from, to),
        )
      }
      return false // ne pas descendre dans les cellules
    },
  })
  return Decoration.set(decos, true)
}

const tableField = StateField.define<DecorationSet>({
  create: (state) => buildTableDecorations(state),
  update(deco, tr) {
    // Recalcul sur édition, changement de curseur, ou avancée du parseur (le tableau
    // peut être sous la frontière d'analyse au chargement).
    if (tr.docChanged || tr.selection || syntaxTree(tr.state) !== syntaxTree(tr.startState)) {
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
          if (update.docChanged || update.selectionSet || update.viewportChanged) {
            this.decorations = buildDecorations(update.view)
          }
        }
      },
      { decorations: (v) => v.decorations },
    ),
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
