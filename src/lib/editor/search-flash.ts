// Saut vers une occurrence de recherche + surlignage transitoire (story 9.4).
// Un StateField porte une décoration « flash » (cadre) sur le terme trouvé ; on la
// pose au saut puis on la retire après un court délai. Sélectionner le terme le met
// aussi en évidence (fond de sélection CM), le cadre le rend franchement visible.

import { EditorView, Decoration, type DecorationSet } from '@codemirror/view'
import { StateEffect, StateField } from '@codemirror/state'

// Pose (ou efface, avec null) le cadre sur une plage.
const setSearchFlash = StateEffect.define<{ from: number; to: number } | null>()

const flashMark = Decoration.mark({ class: 'cm-search-flash' })

export const searchFlashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes) // suit les éditions
    for (const e of tr.effects) {
      if (e.is(setSearchFlash)) {
        deco = e.value ? Decoration.set([flashMark.range(e.value.from, e.value.to)]) : Decoration.none
      }
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

const FLASH_MS = 1600

// Sélectionne et centre l'occurrence (line 1-based, col 0-based, longueur), pose le
// cadre puis le retire après FLASH_MS. Positions bornées à la ligne (robuste si l'index
// de recherche a légèrement dérivé du disque).
export function revealMatch(view: EditorView, line: number, col: number, length: number) {
  const doc = view.state.doc
  const l = doc.line(Math.min(Math.max(line, 1), doc.lines))
  const from = Math.min(l.from + col, l.to)
  const to = Math.min(from + length, l.to)
  view.dispatch({
    selection: { anchor: from, head: to },
    effects: [
      ...(to > from ? [setSearchFlash.of({ from, to })] : []),
      EditorView.scrollIntoView(from, { y: 'center' }),
    ],
  })
  view.focus()
  if (to > from) {
    setTimeout(() => {
      try {
        view.dispatch({ effects: setSearchFlash.of(null) })
      } catch {
        // vue détruite entre-temps (onglet fermé) : rien à faire
      }
    }, FLASH_MS)
  }
}
