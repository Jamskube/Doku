// @vitest-environment jsdom
// Blocs de code en carte, filet horizontal et compteur de recherche.
import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { search, SearchQuery, setSearchQuery } from '@codemirror/search'
import { baseExtensions } from './editor'
import { codeBlockBody } from './live-preview'
import { searchCountText } from './search-count'

function mdState(doc: string) {
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage }), search()] })
  ensureSyntaxTree(state, state.doc.length)
  return state
}

function mount(doc: string, anchor = 0) {
  return new EditorView({
    state: EditorState.create({ doc, selection: { anchor }, extensions: baseExtensions(false) }),
    parent: document.body,
  })
}

describe('codeBlockBody', () => {
  it('rend le corps sans les clôtures', () => {
    const s = mdState('avant\n\n```ts\nconst a = 1\nconst b = 2\n```\n\naprès')
    expect(codeBlockBody(s, s.doc.line(3).to)).toBe('const a = 1\nconst b = 2')
  })
  it("garde la dernière ligne d'un bloc non refermé", () => {
    const s = mdState('```\nx\ny')
    expect(codeBlockBody(s, 3)).toBe('x\ny')
  })
  it('rend une chaîne vide pour un bloc vide, null hors bloc', () => {
    const s = mdState('```\n```\n\ntexte')
    expect(codeBlockBody(s, 3)).toBe('')
    expect(codeBlockBody(s, s.doc.length)).toBeNull()
  })
})

describe('bloc de code en carte', () => {
  it('marque la première et la dernière ligne et pose langage + Copier', () => {
    const view = mount('intro\n\n```python\nprint(1)\n```\n')
    const lines = [...view.contentDOM.querySelectorAll('.cm-lp-codeblock')]
    expect(lines).toHaveLength(3)
    expect(lines[0].classList.contains('cm-lp-codeblock-first')).toBe(true)
    expect(lines[2].classList.contains('cm-lp-codeblock-last')).toBe(true)
    expect(lines[1].className).not.toMatch(/first|last/)
    expect(lines[0].querySelector('.cm-lp-code-lang')?.textContent).toBe('python')
    expect(lines[0].querySelector('.cm-lp-code-copy')).not.toBeNull()
    view.destroy()
  })
  it("un bloc d'une ligne porte les deux bords", () => {
    const view = mount('texte\n\n```')
    const line = view.contentDOM.querySelector('.cm-lp-codeblock')!
    expect(line.classList.contains('cm-lp-codeblock-first')).toBe(true)
    expect(line.classList.contains('cm-lp-codeblock-last')).toBe(true)
    view.destroy()
  })
})

describe('filet horizontal', () => {
  const doc = 'haut\n\n---\n\nbas'
  it('devient un filet quand le curseur est ailleurs', () => {
    const view = mount(doc, 0)
    const hr = view.contentDOM.querySelector('.cm-lp-hr')
    expect(hr).not.toBeNull()
    expect(hr!.textContent).toBe('')
    view.destroy()
  })
  it('reste en source sous le curseur', () => {
    const view = mount(doc, 7)
    expect(view.contentDOM.querySelector('.cm-lp-hr')).toBeNull()
    expect(view.contentDOM.textContent).toContain('---')
    view.destroy()
  })
})

describe('searchCountText', () => {
  const withQuery = (doc: string, search: string, sel?: [number, number]) => {
    const s = mdState(doc)
    return s.update({
      effects: setSearchQuery.of(new SearchQuery({ search })),
      selection: sel ? EditorSelection.single(sel[0], sel[1]) : undefined,
    }).state
  }
  it('compte et situe l’occurrence sélectionnée', () => {
    expect(searchCountText(withQuery('a b a c a', 'a', [4, 5]))).toBe('2 sur 3')
  })
  it('donne le total sans occurrence courante', () => {
    expect(searchCountText(withQuery('a b a', 'a'))).toBe('2 résultats')
    expect(searchCountText(withQuery('a b', 'a'))).toBe('1 résultat')
  })
  it('dit « Aucun résultat » et se tait sans requête', () => {
    expect(searchCountText(withQuery('a b', 'z'))).toBe('Aucun résultat')
    expect(searchCountText(withQuery('a b', ''))).toBe('')
  })
})

describe('compteur dans le panneau', () => {
  it('s’insère après le champ et suit suivant/précédent', async () => {
    const { openSearchPanel, findNext } = await import('@codemirror/search')
    // jsdom n'a pas de géométrie de Range : la mesure de CodeMirror en a besoin.
    Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList
    Range.prototype.getBoundingClientRect ??= () => new DOMRect()
    const view = mount('un deux un trois un')
    openSearchPanel(view)
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: 'un' })) })
    findNext(view)
    ;(view as unknown as { measure(): void }).measure()
    const field = view.dom.querySelector('.cm-search input[name=search]')!
    expect(field.nextElementSibling?.textContent).toBe('1 sur 3')
    findNext(view)
    ;(view as unknown as { measure(): void }).measure()
    expect(view.dom.querySelector('.cm-search-count')?.textContent).toBe('2 sur 3')
    view.destroy()
  })
})
