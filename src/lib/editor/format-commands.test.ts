// @vitest-environment jsdom
// Story 20.4 : commandes de formatage sur un vrai EditorView (detection par l'arbre
// syntaxique). Les gestes clic/selection restent a verifier en navigateur (regle 20.2).
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView, runScopeHandlers } from '@codemirror/view'
import { baseExtensions } from './editor'
import {
  insertHr,
  insertTable,
  setHeading,
  toggleBold,
  toggleInlineCode,
  toggleItalic,
  toggleLink,
  toggleList,
  toggleQuote,
  wrapCodeBlock,
} from './format-commands'

function mount(doc: string, anchor: number, head?: number) {
  return new EditorView({
    state: EditorState.create({ doc, selection: { anchor, head }, extensions: baseExtensions(false) }),
    parent: document.body,
  })
}

const sel = (doc: string, needle: string) => {
  const from = doc.indexOf(needle)
  if (from < 0) throw new Error(`"${needle}" absent`)
  return { from, to: from + needle.length }
}

describe('toggles inline (arbre syntaxique)', () => {
  it('Ctrl+B enveloppe puis retire — jamais d empilement', () => {
    const doc = 'un mot simple'
    const s = sel(doc, 'mot')
    const view = mount(doc, s.from, s.to)
    toggleBold(view)
    expect(view.state.doc.toString()).toBe('un **mot** simple')
    // la selection couvre le coeur -> re-toggle immediat possible
    toggleBold(view)
    expect(view.state.doc.toString()).toBe('un mot simple')
    view.destroy()
  })

  it('italique sur du gras -> ***les deux***, puis retour', () => {
    const doc = 'du **gras** ici'
    const s = sel(doc, 'gras')
    const view = mount(doc, s.from, s.to)
    toggleItalic(view)
    expect(view.state.doc.toString()).toBe('du ***gras*** ici')
    toggleItalic(view)
    expect(view.state.doc.toString()).toBe('du **gras** ici')
    view.destroy()
  })

  it('selection PARTIELLE dans un gras -> le noeud entier est deformate (pas **b**ol**d**)', () => {
    const doc = 'x **bold** y'
    const s = sel(doc, 'ol')
    const view = mount(doc, s.from, s.to)
    toggleBold(view)
    expect(view.state.doc.toString()).toBe('x bold y')
    view.destroy()
  })

  it('au caret dans un gras -> retire (pas de **** invisible)', () => {
    const doc = 'x **bold** y'
    const view = mount(doc, doc.indexOf('ol'))
    toggleBold(view)
    expect(view.state.doc.toString()).toBe('x bold y')
    view.destroy()
  })

  it('dans une zone de code, l emphase n ecrit RIEN (octets du code intacts)', () => {
    const doc = 'du `code *x* la` fin'
    const s = sel(doc, 'x')
    const view = mount(doc, s.from, s.to)
    toggleBold(view)
    toggleItalic(view)
    expect(view.state.doc.toString()).toBe(doc)
    view.destroy()
  })

  it('selection a cheval sur un marqueur -> no-op (pas de chevauchement invalide)', () => {
    const doc = 'a **gras** suite'
    const view = mount(doc, doc.indexOf('ras'), doc.indexOf('suite') + 2)
    toggleBold(view)
    expect(view.state.doc.toString()).toBe(doc)
    view.destroy()
  })

  it('code inline : toggle aller-retour', () => {
    const doc = 'la valeur seuil ici'
    const s = sel(doc, 'seuil')
    const view = mount(doc, s.from, s.to)
    toggleInlineCode(view)
    expect(view.state.doc.toString()).toBe('la valeur `seuil` ici')
    toggleInlineCode(view)
    expect(view.state.doc.toString()).toBe('la valeur seuil ici')
    view.destroy()
  })
})

describe('lien (Ctrl+K)', () => {
  it('enveloppe en selectionnant le placeholder url', () => {
    const doc = 'voir spec ici'
    const s = sel(doc, 'spec')
    const view = mount(doc, s.from, s.to)
    toggleLink(view)
    expect(view.state.doc.toString()).toBe('voir [spec](url) ici')
    const m = view.state.selection.main
    expect(view.state.sliceDoc(m.from, m.to)).toBe('url')
    view.destroy()
  })

  it('RE-appuyer (selection sur le placeholder, DANS le lien) -> retire le lien entier', () => {
    const doc = 'voir spec ici'
    const s = sel(doc, 'spec')
    const view = mount(doc, s.from, s.to)
    toggleLink(view)
    toggleLink(view) // la selection est "url" : le noeud Link englobant fait foi
    expect(view.state.doc.toString()).toBe('voir spec ici')
    view.destroy()
  })

  it('un lien entierement selectionne se deballe', () => {
    const doc = 'x [mot](https://a) y'
    const s = sel(doc, '[mot](https://a)')
    const view = mount(doc, s.from, s.to)
    toggleLink(view)
    expect(view.state.doc.toString()).toBe('x mot y')
    view.destroy()
  })
})

describe('titres, liste, citation', () => {
  it('titre : pose, change de niveau, retire', () => {
    const view = mount('mon titre', 2)
    setHeading(view, 2)
    expect(view.state.doc.toString()).toBe('## mon titre')
    setHeading(view, 3)
    expect(view.state.doc.toString()).toBe('### mon titre')
    setHeading(view, 3)
    expect(view.state.doc.toString()).toBe('mon titre')
    view.destroy()
  })

  it('liste et citation : toggle multi-lignes', () => {
    const doc = 'a\nb'
    const view = mount(doc, 0, doc.length)
    toggleList(view)
    expect(view.state.doc.toString()).toBe('- a\n- b')
    toggleList(view)
    expect(view.state.doc.toString()).toBe('a\nb')
    toggleQuote(view)
    expect(view.state.doc.toString()).toBe('> a\n> b')
    view.destroy()
  })
})

describe('insertions de bloc', () => {
  it('--- sous un paragraphe : lignes vides garanties (JAMAIS de titre setext)', () => {
    const doc = 'un paragraphe'
    const view = mount(doc, doc.length)
    insertHr(view)
    expect(view.state.doc.toString()).toBe('un paragraphe\n\n---\n')
    view.destroy()
  })

  it('--- depuis une ligne vide sous un paragraphe : idem', () => {
    const doc = 'para\n'
    const view = mount(doc, doc.length) // caret sur la ligne vide finale
    insertHr(view)
    expect(view.state.doc.toString()).toBe('para\n\n---\n')
    view.destroy()
  })

  it('tableau insere APRES la selection — le texte selectionne est intact', () => {
    const doc = 'garder ce texte\nsuite'
    const view = mount(doc, 0, 6)
    insertTable(view)
    const out = view.state.doc.toString()
    expect(out).toContain('garder ce texte')
    expect(out).toContain('suite')
    expect(out).toContain('| Colonne 1 | Colonne 2 |')
    expect(out.split('\n')[1]).toBe('') // ligne vide avant le gabarit
    view.destroy()
  })

  it('bloc de code : les lignes selectionnees passent dans les fences', () => {
    const doc = 'a\nb\nc'
    const view = mount(doc, 2, 3) // selection sur la ligne b
    wrapCodeBlock(view)
    expect(view.state.doc.toString()).toBe('a\n```\nb\n```\nc')
    view.destroy()
  })
})

describe('regressions de revue (20.4)', () => {
  it('selection COLLEE a un marqueur (bord exterieur) : le wrap se fait, pas un faux no-op', () => {
    const doc = 'x **bold** y'
    const view = mount(doc, 0, 1) // "x", collee au ** qui suit l espace... borne a 1
    toggleBold(view)
    expect(view.state.doc.toString()).toBe('**x** **bold** y')
    view.destroy()
  })

  it('l URL d un lien est une zone morte pour le gras (le lien survit)', () => {
    const doc = 'voir [spec](https://a) fin'
    const s = sel(doc, 'https://a')
    const view = mount(doc, s.from, s.to)
    toggleBold(view)
    expect(view.state.doc.toString()).toBe(doc)
    view.destroy()
  })

  it('Ctrl+K dans une image : no-op (ne detruit pas l image)', () => {
    const doc = 'img ![alt](pic.png) fin'
    const s = sel(doc, 'pic.png')
    const view = mount(doc, s.from, s.to)
    toggleLink(view)
    expect(view.state.doc.toString()).toBe(doc)
    view.destroy()
  })

  it('une operation de ligne traversant un bloc de code ne touche RIEN', () => {
    const doc = 'p1\n\n```\ncode\n```\n\np2'
    const view = mount(doc, 0, doc.length)
    toggleList(view)
    expect(view.state.doc.toString()).toBe(doc)
    wrapCodeBlock(view)
    expect(view.state.doc.toString()).toBe(doc)
    view.destroy()
  })

  it('titre setext converti sans soulignement orphelin', () => {
    const doc = 'Titre\n=====\n\nsuite'
    const view = mount(doc, 2)
    setHeading(view, 2)
    expect(view.state.doc.toString()).toBe('## Titre\n\nsuite')
    view.destroy()
  })

  it('deballer un code span rembourre retire aussi le rembourrage CommonMark', () => {
    const doc = 'un `` a`b `` fin'
    const s = sel(doc, 'a`b')
    const view = mount(doc, s.from, s.to)
    toggleInlineCode(view)
    expect(view.state.doc.toString()).toBe('un a`b fin')
    view.destroy()
  })
})

describe('keymap', () => {
  it('Ctrl+I bat le selectParentSyntax du defaultKeymap (piege Mod-i)', () => {
    const doc = 'un mot simple'
    const s = sel(doc, 'mot')
    const view = mount(doc, s.from, s.to)
    const handled = runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'i', ctrlKey: true }), 'editor')
    expect(handled).toBe(true)
    expect(view.state.doc.toString()).toBe('un *mot* simple')
    view.destroy()
  })

  it('Ctrl+B et Ctrl+K sont cables', () => {
    const doc = 'un mot simple'
    const s = sel(doc, 'mot')
    const view = mount(doc, s.from, s.to)
    runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'b', ctrlKey: true }), 'editor')
    expect(view.state.doc.toString()).toBe('un **mot** simple')
    view.destroy()
  })
})
