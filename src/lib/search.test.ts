import { describe, expect, it } from 'vitest'
import { makeSearchDoc, searchDocs } from './search'

function docs() {
  return [
    makeSearchDoc('a.md', 'a.md', '# Budget 2026\nRéunion client mardi.\nBudget revu à la baisse.'),
    makeSearchDoc('b.md', 'b.md', 'Notes diverses.\nRien de spécial ici.'),
    makeSearchDoc('c.md', 'c.md', 'Idées : mode focus, coller intelligent.'),
  ]
}

describe('searchDocs', () => {
  it('trouve les fichiers correspondants avec le nombre d’occurrences', () => {
    const r = searchDocs(docs(), 'budget')
    expect(r.map((x) => x.path)).toEqual(['a.md'])
    expect(r[0].count).toBe(2)
  })

  it('est casse-insensible', () => {
    expect(searchDocs(docs(), 'BUDGET')).toHaveLength(1)
    expect(searchDocs(docs(), 'RéUnIoN')).toHaveLength(1)
  })

  it('l’extrait est la ligne du match, avec les bornes de surlignage exactes', () => {
    const [res] = searchDocs(docs(), 'réunion')
    const hit = res.hits[0]
    expect(hit.line).toBe(2)
    expect(hit.snippet).toBe('Réunion client mardi.')
    expect(hit.snippet.slice(hit.start, hit.end).toLowerCase()).toBe('réunion')
  })

  it('déduplique les hits par ligne mais compte toutes les occurrences', () => {
    const d = [makeSearchDoc('x.md', 'x.md', 'ba ba ba\nba encore')]
    const [res] = searchDocs(d, 'ba')
    expect(res.count).toBe(4) // 3 sur la 1re ligne + 1 sur la 2e
    expect(res.hits.map((h) => h.line)).toEqual([1, 2]) // une entrée par ligne
  })

  it('borne le nombre d’extraits par fichier (maxHitsPerFile)', () => {
    const d = [makeSearchDoc('x.md', 'x.md', 'z\nz\nz\nz\nz')]
    const [res] = searchDocs(d, 'z', { maxHitsPerFile: 2 })
    expect(res.count).toBe(5)
    expect(res.hits).toHaveLength(2)
  })

  it('renvoie [] sur requête vide ou blanche', () => {
    expect(searchDocs(docs(), '')).toEqual([])
    expect(searchDocs(docs(), '   ')).toEqual([])
  })

  it('renvoie [] quand rien ne correspond', () => {
    expect(searchDocs(docs(), 'zzz-absent')).toEqual([])
  })

  it('expose la position document (col + length) du match pour le saut éditeur', () => {
    const content = 'ligne un\nvoici le TERME ici\nligne trois'
    const [res] = searchDocs([makeSearchDoc('d.md', 'd.md', content)], 'terme')
    const hit = res.hits[0]
    expect(hit.line).toBe(2)
    const lineText = content.split('\n')[hit.line - 1]
    expect(lineText.slice(hit.col, hit.col + hit.length).toLowerCase()).toBe('terme')
  })

  it('fenêtre une ligne très longue autour du match, bornes toujours exactes', () => {
    const long = 'x'.repeat(300) + ' CIBLE ' + 'y'.repeat(300)
    const [res] = searchDocs([makeSearchDoc('l.md', 'l.md', long)], 'cible')
    const hit = res.hits[0]
    expect(hit.snippet.startsWith('…')).toBe(true)
    expect(hit.snippet.endsWith('…')).toBe(true)
    expect(hit.snippet.length).toBeLessThanOrEqual(162) // SNIPPET_MAX + 2 ellipses
    expect(hit.snippet.slice(hit.start, hit.end)).toBe('CIBLE')
    // col/length restent la position brute dans la ligne (≠ start fenêtré).
    expect(long.slice(hit.col, hit.col + hit.length)).toBe('CIBLE')
  })

  it('fenêtre aussi une ligne courte pour que le terme ouvre l’extrait', () => {
    const line = 'Une phrase assez longue avant d’arriver enfin au mot CIBLE puis la suite'
    const [res] = searchDocs([makeSearchDoc('c.md', 'c.md', line)], 'cible')
    const hit = res.hits[0]
    expect(hit.snippet.startsWith('…')).toBe(true)
    expect(hit.start).toBe(13) // « … » + 12 caractères de contexte
    expect(hit.snippet.slice(hit.start, hit.end)).toBe('CIBLE')
    expect(line.slice(hit.col, hit.col + hit.length)).toBe('CIBLE')
  })

  it('garde la ligne entière quand le terme est déjà près du début', () => {
    const [res] = searchDocs([makeSearchDoc('d.md', 'd.md', 'Le mot CIBLE puis une très longue suite de texte')], 'cible')
    expect(res.hits[0].snippet).toBe('Le mot CIBLE puis une très longue suite de texte')
    expect(res.hits[0].start).toBe(7)
  })

  it('ne coupe pas un emoji en ouvrant la fenêtre', () => {
    // L'emoji occupe deux unités UTF-16 : la fenêtre tomberait sur sa seconde moitié.
    const line = 'abcdefghijklmnopqrstuvwxyz0123456789😀' + 'x'.repeat(11) + 'CIBLE'
    const [res] = searchDocs([makeSearchDoc('e.md', 'e.md', line)], 'cible')
    const hit = res.hits[0]
    expect(hit.snippet.startsWith('…😀')).toBe(true)
    expect(hit.snippet.slice(hit.start, hit.end)).toBe('CIBLE')
  })

  it('borne le nombre de fichiers résultats (maxResults)', () => {
    const many = Array.from({ length: 10 }, (_, i) => makeSearchDoc(`f${i}.md`, `f${i}.md`, 'terme commun'))
    expect(searchDocs(many, 'terme', { maxResults: 3 })).toHaveLength(3)
  })
})
