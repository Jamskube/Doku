// Story 20.4 : mecanique pure du formatage. La detection "deja formate" vit dans la
// glue (arbre syntaxique) et se teste dans editor/format-commands.test.ts.
import { describe, expect, it } from 'vitest'
import {
  HR_TEMPLATE,
  TABLE_TEMPLATE,
  linkText,
  makeLink,
  toggleHeadingLines,
  toggleLinePrefix,
  wrapSelection,
} from './format'
import { parseTable } from './table'

describe('wrapSelection', () => {
  it('enveloppe et selectionne le coeur', () => {
    expect(wrapSelection('mot', '**')).toEqual({ insert: '**mot**', selFrom: 2, selTo: 5 })
  })

  it('laisse les espaces de bord HORS marqueurs (emphase GFM valide)', () => {
    expect(wrapSelection(' mot ', '*')).toEqual({ insert: ' *mot* ', selFrom: 2, selTo: 5 })
  })

  it('refuse une selection traversant une ligne vide (jamais de md invalide)', () => {
    expect(wrapSelection('a\n\nb', '**')).toBeNull()
    expect(wrapSelection('a\n  \nb', '**')).toBeNull()
    expect(wrapSelection('a\nb', '**')).not.toBeNull() // meme paragraphe : ok
  })

  it('refuse un backtick dans une selection mise en code inline', () => {
    expect(wrapSelection('a`b', '`')).toBeNull()
  })

  it('selection vide : paire vide, caret centre', () => {
    expect(wrapSelection('', '**')).toEqual({ insert: '****', selFrom: 2, selTo: 2 })
  })
})

describe('makeLink', () => {
  it('enveloppe et selectionne le placeholder url', () => {
    const e = makeLink('mot')!
    expect(e.insert).toBe('[mot](url)')
    expect(e.insert.slice(e.selFrom, e.selTo)).toBe('url')
  })

  it('selection vide : placeholder texte', () => {
    expect(makeLink('')!.insert).toBe('[texte](url)')
  })

  it('multiligne : refuse (un lien tient sur une ligne)', () => {
    expect(makeLink('a\nb')).toBeNull()
  })

  it('linkText extrait le texte affiche', () => {
    expect(linkText('[mot](https://x)')).toBe('mot')
    expect(linkText('pas un lien')).toBeNull()
  })
})

describe('toggleHeadingLines', () => {
  it('pose le niveau demande', () => {
    expect(toggleHeadingLines(['texte'], 2)).toEqual(['## texte'])
  })

  it('remplace un autre niveau (pas d empilement)', () => {
    expect(toggleHeadingLines(['# texte'], 3)).toEqual(['### texte'])
  })

  it('meme niveau -> retire', () => {
    expect(toggleHeadingLines(['## texte'], 2)).toEqual(['texte'])
  })

  it('lignes mixtes -> tout au niveau demande ; lignes vides intactes', () => {
    expect(toggleHeadingLines(['# a', '', 'b'], 2)).toEqual(['## a', '', '## b'])
  })
})

describe('toggleLinePrefix', () => {
  it('prefixe toutes les lignes non vides', () => {
    expect(toggleLinePrefix(['a', '', 'b'], '- ')).toEqual(['- a', '', '- b'])
  })

  it('toutes deja prefixees -> retire (toggle)', () => {
    expect(toggleLinePrefix(['- a', '- b'], '- ')).toEqual(['a', 'b'])
    expect(toggleLinePrefix(['> a', '> b'], '> ')).toEqual(['a', 'b'])
  })

  it('mixte -> complete sans doubler', () => {
    expect(toggleLinePrefix(['- a', 'b'], '- ')).toEqual(['- a', '- b'])
  })

  it('conserve l indentation', () => {
    expect(toggleLinePrefix(['  a'], '- ')).toEqual(['  - a'])
  })

  it('remplace un autre marqueur de liste au lieu d empiler (revue)', () => {
    expect(toggleLinePrefix(['* a', '+ b', '1. c', '2) d'], '- ')).toEqual(['- a', '- b', '- c', '- d'])
  })
})

describe('gabarits', () => {
  it('le tableau vierge est un tableau GFM valide', () => {
    const t = parseTable(TABLE_TEMPLATE)
    expect(t).not.toBeNull()
    expect(t!.headers).toHaveLength(2)
  })

  it('le separateur est un filet thematique', () => {
    expect(HR_TEMPLATE).toBe('---')
  })
})
