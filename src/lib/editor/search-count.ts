// Compteur d'occurrences du panneau Rechercher (« 2 sur 9 ») : un span glissé après le
// champ du panneau @codemirror/search, recalculé à chaque changement de requête, de
// sélection (suivant/précédent) ou de texte, tant que le panneau est ouvert.
import type { EditorState } from '@codemirror/state'
import { type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { getSearchQuery, searchPanelOpen } from '@codemirror/search'

// ponytail: balayage complet borné à MAX occurrences par mise à jour ; un index incrémental
// si un document de la taille limite du live preview se met à ramer panneau ouvert.
const MAX = 1000

export function searchCountText(state: EditorState): string {
  const query = getSearchQuery(state)
  if (!query.search || !query.valid) return ''
  const sel = state.selection.main
  let total = 0
  let current = 0
  const cursor = query.getCursor(state)
  for (let m = cursor.next(); !m.done && total < MAX; m = cursor.next()) {
    total++
    if (m.value.from === sel.from && m.value.to === sel.to) current = total
  }
  if (total === 0) return 'Aucun résultat'
  const shown = total >= MAX ? `${MAX - 1}+` : String(total)
  if (current) return `${current} sur ${shown}`
  return total === 1 ? '1 résultat' : `${shown} résultats`
}

export const searchCount = ViewPlugin.fromClass(
  class {
    update(u: ViewUpdate) {
      const open = searchPanelOpen(u.state)
      if (!open) return
      if (
        searchPanelOpen(u.startState) &&
        !u.docChanged &&
        !u.selectionSet &&
        getSearchQuery(u.state).eq(getSearchQuery(u.startState))
      ) return
      // Le DOM du panneau naît dans la même mise à jour, peut-être après ce plugin.
      u.view.requestMeasure({ key: this, read: () => {}, write: (_, view) => render(view) })
    }
  },
)

function render(view: EditorView) {
  const field = view.dom.querySelector<HTMLInputElement>('.cm-search input[name=search]')
  if (!field) return
  let out = field.nextElementSibling
  if (!out?.classList.contains('cm-search-count')) {
    out = document.createElement('span')
    out.className = 'cm-search-count'
    field.after(out)
  }
  const text = searchCountText(view.state)
  if (out.textContent !== text) out.textContent = text
}
