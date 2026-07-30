import { describe, expect, it } from 'vitest'
import { escapeCellText, parseTable, tableCellSpans } from './table'

describe('parseTable', () => {
  it('parse un tableau GFM simple', () => {
    const md = `| Format | Statut |
|---|---|
| Markdown | Prêt |
| HTML | Prêt |`
    const t = parseTable(md)
    expect(t).not.toBeNull()
    expect(t!.headers).toEqual(['Format', 'Statut'])
    expect(t!.rows).toEqual([
      ['Markdown', 'Prêt'],
      ['HTML', 'Prêt'],
    ])
  })

  it('lit les alignements de la ligne de délimiteurs', () => {
    const md = `| G | C | D |
|:--|:--:|--:|
| a | b | c |`
    expect(parseTable(md)!.aligns).toEqual(['left', 'center', 'right'])
  })

  it('rend null sans alignement par défaut', () => {
    const md = `| a | b |
|---|---|
| 1 | 2 |`
    expect(parseTable(md)!.aligns).toEqual([null, null])
  })

  it('tolère l’absence de pipes de bord', () => {
    const md = `a | b
--- | ---
1 | 2`
    const t = parseTable(md)
    expect(t!.headers).toEqual(['a', 'b'])
    expect(t!.rows).toEqual([['1', '2']])
  })

  it('renvoie null si la 2e ligne n’est pas des délimiteurs', () => {
    expect(parseTable('| a | b |\n| 1 | 2 |')).toBeNull()
    expect(parseTable('juste du texte')).toBeNull()
  })

  it('gère une ligne de corps plus courte (cellules manquantes)', () => {
    const md = `| a | b | c |
|---|---|---|
| 1 |`
    expect(parseTable(md)!.rows).toEqual([['1']])
  })

  it('découpe correctement un pipe échappé dans une cellule', () => {
    const md = `| a | b |
|---|---|
| x \\| y | z |`
    expect(parseTable(md)!.rows).toEqual([['x | y', 'z']])
  })
})

// Story 20.2 : localiser une cellule dans la SOURCE pour l'ecrire sans regenerer le bloc.
describe('tableCellSpans', () => {
  const md = ['| # | clip | verdict |', '|---|------|---------|', '| 1 | a01.wav |  |'].join('\n')
  const at = (line: number, col: number) => tableCellSpans(md).find((s) => s.line === line && s.col === col)!

  it('borne chaque cellule sur son CONTENU, sans le padding', () => {
    expect(md.slice(at(0, 0).from, at(0, 0).to)).toBe('#')
    expect(md.slice(at(0, 1).from, at(0, 1).to)).toBe('clip')
    expect(md.slice(at(2, 1).from, at(2, 1).to)).toBe('a01.wav')
  })

  it('donne un span vide (insertion) pour une cellule vide', () => {
    const s = at(2, 2)
    expect(s.from).toBe(s.to)
    const out = md.slice(0, s.from) + 'pub' + md.slice(s.to)
    expect(out).toContain('| 1 | a01.wav | pub |')
  })

  it('remplacer une cellule ne touche a AUCUN autre caractere (garde ADR-0002)', () => {
    const s = at(2, 1)
    const out = md.slice(0, s.from) + 'b02.wav' + md.slice(s.to)
    const lines = out.split('\n')
    expect(lines[0]).toBe('| # | clip | verdict |')
    expect(lines[1]).toBe('|---|------|---------|')
    expect(lines[2]).toBe('| 1 | b02.wav |  |')
  })

  it('reste correct sans pipes de bord', () => {
    const bare = ['a | b', '--- | ---', '1 | 2'].join('\n')
    const c = tableCellSpans(bare).find((s) => s.line === 2 && s.col === 1)!
    expect(bare.slice(c.from, c.to)).toBe('2')
  })

  it('ne coupe pas sur un pipe echappe', () => {
    const esc = ['| a | b |', '|---|---|', '| x \\| y | z |'].join('\n')
    const spans = tableCellSpans(esc).filter((s) => s.line === 2)
    expect(spans).toHaveLength(2)
    expect(esc.slice(spans[0].from, spans[0].to)).toBe('x \\| y')
  })
})

describe('escapeCellText', () => {
  it('echappe un pipe saisi (sinon il creerait une colonne fantome)', () => {
    expect(escapeCellText('pub | jingle')).toBe('pub \\| jingle')
  })
  it('ne double pas un echappement deja present', () => {
    expect(escapeCellText('x \\| y')).toBe('x \\| y')
  })
  it('aplatit les retours a la ligne (une cellule GFM tient sur une ligne)', () => {
    expect(escapeCellText('a\nb')).toBe('a b')
  })
})