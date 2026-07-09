// Couche « live preview » de Doku (ADR-0002) : le buffer reste du Markdown,
// des décorations masquent la syntaxe hors des lignes actives (celles portant
// une sélection) et remplacent les marqueurs par des widgets.
// Origine : spike/src/live-preview.ts, validé par mesures le 2026-07-08.
import { syntaxTree } from '@codemirror/language'
import { Facet, type Range } from '@codemirror/state'
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
import { isExternalUrl, resolveLocalImagePath } from '../images'

// Dossier du document courant (fourni par état, dans DocumentView) — sert à
// résoudre les images relatives.
export const docDirFacet = Facet.define<string, string>({ combine: (v) => v[0] ?? '' })

// URL affichable d'une image : externe telle quelle ; locale résolue au dossier
// puis convertie en asset:// (natif). En navigateur : chemin brut → erreur → placeholder.
function imageSrc(url: string, dir: string): string {
  if (isExternalUrl(url)) return url
  const abs = resolveLocalImagePath(url, dir)
  return isTauri ? convertFileSrc(abs) : abs
}

class ImageWidget extends WidgetType {
  constructor(
    private url: string,
    private alt: string,
    private dir: string,
  ) {
    super()
  }

  eq(o: ImageWidget) {
    return o.url === this.url && o.alt === this.alt && o.dir === this.dir
  }

  toDOM() {
    // Conteneur stable géré par CM6 ; on mute son contenu à l'erreur (pas de
    // replaceWith, qui serait clobbered par la réconciliation DOM de CodeMirror).
    const wrap = document.createElement('span')
    wrap.className = 'cm-lp-image-wrap'
    const img = document.createElement('img')
    img.className = 'cm-lp-image'
    img.alt = this.alt
    img.src = imageSrc(this.url, this.dir)
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

function buildDecorations(view: EditorView): DecorationSet {
  const decos: Range<Decoration>[] = []
  const { state } = view
  const docDir = state.facet(docDirFacet)

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
              Decoration.replace({ widget: new ImageWidget(m[2], m[1], docDir) }).range(node.from, node.to),
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
        const wiki = (e.target as HTMLElement).closest('.cm-lp-wikilink') as HTMLElement | null
        if (wiki?.dataset.target) {
          window.dispatchEvent(new CustomEvent('doku:wikilink', { detail: wiki.dataset.target }))
        }
      },
    }),
  ]
}
