// @vitest-environment jsdom
// Story 20.1 (ADR-0017) : la syntaxe ne se révèle QUE sur geste explicite.
// Test au niveau EditorState/EditorView réel — c'est le comportement de décoration
// qu'on protège, pas une fonction pure isolée.
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { baseExtensions, serializeDoc } from './editor'
import { revealScopeField, setRevealScope } from './reveal'

const DOC = ['# Titre', '', 'Du **gras** ici.', '', '- une puce', ''].join('\n')

// Le cas qui a motivé le sprint : un tableau de saisie (verdicts à remplir).
const TABLE_DOC = [
  '| # | clip | verdict |',
  '|---|------|---------|',
  '| 1 | a01.wav |  |',
  '| 2 | a02.wav |  |',
  '',
].join('\n')

function mount(doc = DOC) {
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: baseExtensions(false) }),
    parent: document.body,
  })
  return view
}

// Texte réellement affiché : les décorations `replace` retirent les marqueurs du DOM,
// donc lire le DOM est la seule façon honnête de vérifier ce que voit l'utilisateur.
function rendered(view: EditorView): string {
  return view.contentDOM.textContent ?? ''
}

describe('révélation à la demande (20.1)', () => {
  it('masque les marqueurs par défaut — poser le curseur ne révèle RIEN', () => {
    const view = mount()
    // Curseur au milieu du titre : avant l'ADR-0017 cela révélait « # ».
    view.dispatch({ selection: { anchor: 3 } })
    const out = rendered(view)
    expect(out).toContain('Titre')
    expect(out).not.toContain('# Titre')
    expect(out).not.toContain('**gras**')
    view.destroy()
  })

  it('révèle la syntaxe du bloc courant quand le geste est posé', () => {
    const view = mount()
    view.dispatch({ selection: { anchor: 3 } })
    view.dispatch({ effects: setRevealScope.of('block') })
    expect(rendered(view)).toContain('# Titre')
    view.destroy()
  })

  it('re-masque quand la révélation est annulée', () => {
    const view = mount()
    view.dispatch({ selection: { anchor: 3 } })
    view.dispatch({ effects: setRevealScope.of('block') })
    view.dispatch({ effects: setRevealScope.of('none') })
    expect(rendered(view)).not.toContain('# Titre')
    view.destroy()
  })

  it("l'état de révélation démarre à 'none' et survit à la frappe (pas de clignotement)", () => {
    const view = mount()
    expect(view.state.field(revealScopeField)).toBe('none')
    view.dispatch({ effects: setRevealScope.of('block') })
    view.dispatch({ changes: { from: 7, insert: ' bis' } })
    expect(view.state.field(revealScopeField)).toBe('block')
    view.destroy()
  })

  it('ne touche JAMAIS au document — round-trip octet pour octet (garde ADR-0002)', () => {
    const view = mount()
    view.dispatch({ selection: { anchor: 3 } })
    view.dispatch({ effects: setRevealScope.of('block') })
    view.dispatch({ effects: setRevealScope.of('none') })
    expect(serializeDoc(view.state.doc.toString(), '\n')).toBe(DOC)
    view.destroy()
  })
})

describe('tableau : le rendu tient quand on y place le curseur (20.1)', () => {
  it("placer le curseur dans une cellule ne fait plus tomber le tableau en markdown brut", () => {
    const view = mount(TABLE_DOC)
    // Curseur dans la cellule « verdict » de la 1re ligne de données.
    const pos = TABLE_DOC.indexOf('a01.wav') + 3
    view.dispatch({ selection: { anchor: pos } })
    const out = rendered(view)
    // Le widget-bloc tient : aucune ligne de délimiteurs à l'écran.
    expect(out).not.toContain('|---|')
    expect(out).toContain('a01.wav')
    view.destroy()
  })

  it('le document du tableau reste intact octet pour octet', () => {
    const view = mount(TABLE_DOC)
    const pos = TABLE_DOC.indexOf('a01.wav') + 3
    view.dispatch({ selection: { anchor: pos } })
    expect(serializeDoc(view.state.doc.toString(), '\n')).toBe(TABLE_DOC)
    view.destroy()
  })
})
