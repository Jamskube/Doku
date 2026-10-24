// @vitest-environment jsdom
// Story 20.2 : saisir DANS une cellule, sans regenerer le bloc (ADR-0002).
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { DecorationSet } from '@codemirror/view'
import { baseExtensions } from './editor'
import { buildTableDecorations, tableField } from './live-preview'
import { rephrasePreviewField, setRephrasePreview } from './rephrase-preview'

// Empreinte comparable d'un jeu de décorations de tableau : bornes + source du widget.
function snap(set: DecorationSet): [number, number, string][] {
  const out: [number, number, string][] = []
  for (const it = set.iter(); it.value; it.next()) {
    out.push([it.from, it.to, (it.value.spec.widget as unknown as { md: string }).md])
  }
  return out
}
const firstWidget = (set: DecorationSet) => set.iter().value?.spec.widget

const DOC = [
  '# Verdicts',
  '',
  '| # | clip | verdict | note |',
  '|---|------|---------|------|',
  '| 1 | o01.wav |  |  |',
  '| 2 | o02.wav |  |  |',
  '',
].join('\n')

function mount(doc = DOC) {
  return new EditorView({
    state: EditorState.create({ doc, extensions: baseExtensions(false) }),
    parent: document.body,
  })
}

// La zone de saisie est le span .cm-lp-cellin (le texte seul est éditable ; les
// boutons ± de 20.3 vivent à côté, dans la cellule non éditable).
const cells = (view: EditorView) =>
  Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.cm-lp-cellin'))

const cellAt = (view: EditorView, line: number, col: number) =>
  cells(view).find((c) => c.dataset.line === String(line) && c.dataset.col === String(col))!

describe('edition en place des cellules (20.2)', () => {
  it('rend les cellules editables', () => {
    const view = mount()
    const c = cellAt(view, 2, 2)
    expect(c).toBeTruthy()
    expect(c.contentEditable).toBe('true')
    view.destroy()
  })

  it('saisir dans une cellule vide ecrit dans la source', () => {
    const view = mount()
    const c = cellAt(view, 2, 2)
    c.textContent = 'pub'
    c.dispatchEvent(new FocusEvent('blur'))
    expect(view.state.doc.toString()).toContain('| 1 | o01.wav | pub |  |')
    view.destroy()
  })

  it('ne touche a AUCUNE autre ligne du document', () => {
    const view = mount()
    const c = cellAt(view, 2, 2)
    c.textContent = 'jingle'
    c.dispatchEvent(new FocusEvent('blur'))
    const lines = view.state.doc.toString().split('\n')
    expect(lines[0]).toBe('# Verdicts')
    expect(lines[2]).toBe('| # | clip | verdict | note |')
    expect(lines[3]).toBe('|---|------|---------|------|')
    expect(lines[5]).toBe('| 2 | o02.wav |  |  |')
    view.destroy()
  })

  it('remplace le contenu existant sans dupliquer', () => {
    const view = mount()
    const c = cellAt(view, 2, 1)
    c.textContent = 'autre.wav'
    c.dispatchEvent(new FocusEvent('blur'))
    const doc = view.state.doc.toString()
    expect(doc).toContain('| 1 | autre.wav |')
    expect(doc).not.toContain('o01.wav')
    view.destroy()
  })

  it('echappe un pipe saisi (pas de colonne fantome)', () => {
    const view = mount()
    const c = cellAt(view, 2, 2)
    c.textContent = 'pub | jingle'
    c.dispatchEvent(new FocusEvent('blur'))
    expect(view.state.doc.toString()).toContain('pub \\| jingle')
    const bodyLine = view.state.doc.toString().split('\n')[4]
    expect(bodyLine.split(/(?<!\\)\|/).length).toBe(6) // 4 colonnes + 2 bords
    view.destroy()
  })

  it('une saisie inchangee n ecrit rien (pas de dirty parasite)', () => {
    const view = mount()
    const before = view.state.doc.toString()
    const c = cellAt(view, 2, 1)
    c.dispatchEvent(new FocusEvent('blur'))
    expect(view.state.doc.toString()).toBe(before)
    view.destroy()
  })

  it('Echap restaure la valeur d origine', () => {
    const view = mount()
    const c = cellAt(view, 2, 1)
    c.textContent = 'jamais'
    c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(view.state.doc.toString()).toContain('o01.wav')
    expect(view.state.doc.toString()).not.toContain('jamais')
    view.destroy()
  })

  it('Echap restaure la valeur COMMITTEE, pas celle de la creation du widget (revue 20.3)', () => {
    const view = mount()
    const a = cellAt(view, 2, 1)
    a.dispatchEvent(new FocusEvent('focus'))
    a.textContent = 'commis.wav'
    a.dispatchEvent(new FocusEvent('blur'))
    expect(view.state.doc.toString()).toContain('commis.wav')
    // re-entree : la reference d'annulation doit etre la valeur committee
    const b = cellAt(view, 2, 1)
    b.dispatchEvent(new FocusEvent('focus'))
    b.textContent = 'poubelle'
    b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    const doc = view.state.doc.toString()
    expect(doc).toContain('commis.wav')
    expect(doc).not.toContain('poubelle')
    view.destroy()
  })

  it('un changement de GEOMETRIE reconstruit le widget (la ligne ajoutee apparait)', () => {
    const view = mount()
    const before = cells(view).length
    const doc = view.state.doc.toString()
    const at = doc.indexOf('| 2 | o02.wav |  |  |')
    view.dispatch({ changes: { from: at, to: at, insert: '| 9 | o09.wav |  |  |\n' } })
    expect(cells(view).length).toBe(before + 4) // une ligne de 4 colonnes en plus
    view.destroy()
  })

  it('Tab passe a la cellule suivante', () => {
    const view = mount()
    const c = cellAt(view, 2, 1)
    c.focus()
    c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.activeElement).toBe(cellAt(view, 2, 2))
    view.destroy()
  })

  it('Maj+Tab revient a la cellule precedente', () => {
    const view = mount()
    const c = cellAt(view, 2, 2)
    c.focus()
    c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))
    expect(document.activeElement).toBe(cellAt(view, 2, 1))
    view.destroy()
  })

  it('cliquer ± avec une saisie en cours VALIDE la saisie avant l action (revue 20.3)', () => {
    const view = mount()
    const c = cellAt(view, 2, 2)
    c.focus()
    c.textContent = 'pub'
    // bouton "+ ligne" de la ligne en cours d'edition
    const tool = view.contentDOM.querySelector<HTMLElement>('[title="Ajouter une ligne en dessous"]')!
    tool.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    const doc = view.state.doc.toString()
    expect(doc).toContain('| 1 | o01.wav | pub |  |') // la saisie n'est pas perdue
    expect(doc.split('\n').filter((l) => l.startsWith('|')).length).toBe(5) // + une ligne
    view.destroy()
  })

  it('une action de structure ne touche JAMAIS un bloc suivant contenant un pipe (revue 20.3)', () => {
    const view = mount(['| a | b |', '|---|---|', '| 1 | 2 |', '- item | note', ''].join('\n'))
    const tool = view.contentDOM.querySelector<HTMLElement>('[title="Ajouter une ligne en dessous"]')!
    tool.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    const doc = view.state.doc.toString()
    expect(doc).toContain('- item | note') // la liste est hors tableau, intacte
    expect(doc).toContain('|  |  |') // la ligne a bien ete ajoutee au tableau
    view.destroy()
  })

  it('un widget hors de la zone editee est CONSERVE (mise a jour incrementale, pas de reconstruction)', () => {
    const state = EditorState.create({ doc: DOC, extensions: baseExtensions(false) })
    const before = firstWidget(state.field(tableField))
    const next = state.update({ changes: { from: 2, insert: 'x' } }).state // dans le titre, loin du tableau
    expect(firstWidget(next.field(tableField))).toBe(before)
    expect(snap(next.field(tableField))).toEqual(snap(buildTableDecorations(next)))
  })

  it('le tableau ne tombe pas quand on saisit plusieurs cellules d affilee', () => {
    const view = mount()
    const a = cellAt(view, 2, 2)
    a.textContent = 'pub'
    a.dispatchEvent(new FocusEvent('blur'))
    const b = cellAt(view, 3, 2)
    b.textContent = 'promo'
    b.dispatchEvent(new FocusEvent('blur'))
    const doc = view.state.doc.toString()
    expect(doc).toContain('| 1 | o01.wav | pub |  |')
    expect(doc).toContain('| 2 | o02.wav | promo |  |')
    expect(cells(view).length).toBeGreaterThan(0) // widget toujours rendu
    view.destroy()
  })
})

// La mise a jour incrementale des widgets (frappe O(zone) au lieu de O(document)) doit
// rendre EXACTEMENT ce qu'une reconstruction complete rendrait, quel que soit le geste.
describe('decorations de tableau incrementales = reconstruction complete', () => {
  const apply = (doc: string, change: { from: number; to?: number; insert?: string }) => {
    const next = EditorState.create({ doc, extensions: baseExtensions(false) }).update({ changes: change }).state
    return { got: snap(next.field(tableField)), want: snap(buildTableDecorations(next)), next }
  }

  it('edition dans une cellule', () => {
    const at = DOC.indexOf('o01.wav')
    const { got, want } = apply(DOC, { from: at, insert: 'z' })
    expect(got).toEqual(want)
    expect(got[0][2]).toContain('zo01.wav')
  })

  it('creation d un tableau (ligne de delimiteurs tapee sous un en-tete)', () => {
    const doc = 'intro\n\n| a | b |\n\nfin\n'
    const at = doc.indexOf('\n\nfin') + 1
    const { got, want } = apply(doc, { from: at, insert: '|---|---|\n' })
    expect(got).toEqual(want)
    expect(got).toHaveLength(1)
  })

  it('suppression d un tableau (ligne de delimiteurs effacee)', () => {
    const from = DOC.indexOf('|---|')
    const { got, want } = apply(DOC, { from, to: DOC.indexOf('\n', from) + 1 })
    expect(got).toEqual(want)
    expect(got).toHaveLength(0)
  })

  it('effacer la ligne qui precede l en-tete fait naitre un tableau qui ne touche pas l edition', () => {
    const doc = 'titre\n\nfoo\n| a | b |\n|---|---|\n| 1 | 2 |\n'
    const from = doc.indexOf('foo')
    const { got, want } = apply(doc, { from, to: from + 3 })
    expect(got).toEqual(want)
    expect(got).toHaveLength(1)
  })

  it('« ``` » ouvert au-dessus d un tableau eloigne le fait disparaitre', () => {
    const doc = 'a\n\n' + 'para\n\n'.repeat(5) + DOC
    const { got, want } = apply(doc, { from: 0, insert: '```\n' })
    expect(got).toEqual(want)
    expect(got).toHaveLength(0)
  })

  // Un apercu de reformulation qui chevauche le tableau le garde en source ; une edition
  // AILLEURS vide l'apercu sans effet (rephrase-preview.ts) : le chemin incremental, qui ne
  // reparcourt que la zone editee, laissait alors le tableau eloigne en markdown brut.
  it('apercu de reformulation vide par une edition ailleurs : le tableau redevient un widget', () => {
    const extensions = [baseExtensions(false), rephrasePreviewField]
    const cell = DOC.indexOf('o01.wav')
    const posed = EditorState.create({ doc: DOC, extensions }).update({
      effects: setRephrasePreview.of({ from: cell, to: cell + 7 }),
    }).state
    expect(posed.field(tableField).size).toBe(0) // temoin : l'apercu bloque bien le widget
    const next = posed.update({ changes: { from: 2, insert: 'x' } }).state // dans le titre
    expect(next.field(rephrasePreviewField).size).toBe(0)
    expect(snap(next.field(tableField))).toEqual(snap(buildTableDecorations(next)))
    expect(next.field(tableField).size).toBe(1)
  })

  // Balayage : chaque caractere structurant insere, et chaque caractere efface, a chaque
  // position d'un document melant tableaux, liste, citation et bloc de code.
  it('balayage exhaustif : insertions et suppressions a toutes les positions', () => {
    const doc = [
      'p', '', '| h | i |', '|---|---|', '| 1 | 2 |', '', '- item', '  | x | y |', '  |---|---|',
      '', '> | q | r |', '> |---|---|', '', '```', '| no | t |', '```', 'z | w', '-|-', '',
    ].join('\n')
    // Témoin du parcours borné aux conteneurs : les tableaux nichés (liste, citation) sont
    // trouvés, celui du bloc de code non.
    expect(buildTableDecorations(EditorState.create({ doc, extensions: baseExtensions(false) })).size).toBe(4)
    for (let pos = 0; pos <= doc.length; pos++) {
      for (const insert of ['|', '\n', '`', '-', ' ', 'x', '\n\n', '```\n']) {
        const { got, want } = apply(doc, { from: pos, insert })
        expect(got, `insert ${JSON.stringify(insert)} @${pos}`).toEqual(want)
      }
      if (pos < doc.length) {
        const { got, want } = apply(doc, { from: pos, to: pos + 1 })
        expect(got, `delete @${pos}`).toEqual(want)
      }
    }
  })
})