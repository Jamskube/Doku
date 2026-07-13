import { describe, expect, it } from 'vitest'
import { parseTable } from './table'

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
