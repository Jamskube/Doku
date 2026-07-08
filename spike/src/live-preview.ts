// Plugin « live preview » minimal pour le spike : le buffer reste du Markdown,
// des décorations masquent la syntaxe hors des lignes actives (celles portant
// une sélection) et remplacent les marqueurs de tâche par de vraies checkbox.
// Périmètre spike : titres, gras/italique/barré, code inline, fences, liens,
// citations, wikilinks. Hors périmètre (points durs connus, comptés dans
// l'estimation d'effort, pas dans le code) : tableaux, images, atomicRanges.
import { syntaxTree } from '@codemirror/language'
import type { Range } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'

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

function buildDecorations(view: EditorView): DecorationSet {
  const decos: Range<Decoration>[] = []
  const { state } = view

  const activeLines = new Set<number>()
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number
    const b = state.doc.lineAt(r.to).number
    for (let n = a; n <= b; n++) activeLines.add(n)
  }
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

        if (HIDDEN_MARKS.has(name) && !isActive(node.from, node.to)) {
          // un HeaderMark ou QuoteMark avale son espace suivant
          const eatSpace =
            (name === 'HeaderMark' || name === 'QuoteMark') &&
            state.sliceDoc(node.to, node.to + 1) === ' '
          decos.push(Decoration.replace({}).range(node.from, eatSpace ? node.to + 1 : node.to))
          return
        }

        if (name === 'TaskMarker' && !isActive(node.from, node.to)) {
          const checked = state.sliceDoc(node.from, node.to).toLowerCase().includes('x')
          decos.push(
            Decoration.replace({ widget: new CheckboxWidget(checked, node.from) }).range(node.from, node.to),
          )
          return
        }

        if (name === 'Link') {
          if (isActive(node.from, node.to)) return
          for (let child = node.node.firstChild; child; child = child.nextSibling) {
            if (child.name === 'LinkMark' || child.name === 'URL') {
              decos.push(Decoration.replace({}).range(child.from, child.to))
            }
          }
          return false
        }

        if (name === 'FencedCode') {
          const first = state.doc.lineAt(node.from).number
          const last = state.doc.lineAt(node.to).number
          for (let n = first; n <= last; n++) {
            decos.push(Decoration.line({ class: 'cm-lp-codeblock' }).range(state.doc.line(n).from))
          }
        }
      },
    })

    // wikilinks : hors de la grammaire lezer, détectés par regex sur le texte visible
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
    EditorView.domEventHandlers({
      mousedown(e) {
        const link = (e.target as HTMLElement).closest('.cm-lp-wikilink') as HTMLElement | null
        if (link) {
          window.dispatchEvent(new CustomEvent('spike:wikilink', { detail: link.dataset.target }))
        }
      },
    }),
  ]
}
