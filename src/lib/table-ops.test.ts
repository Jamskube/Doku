// Story 20.3 : actions de structure. Invariant non negociable : la sortie est TOUJOURS
// un tableau GFM valide (colonnes coherentes, delimiteurs, alignements conserves).
import { describe, expect, it } from 'vitest'
import { applyTableOp, parseTable } from './table'

const MD = ['| # | clip | verdict |', '|---|------|---------|', '| 1 | o01.wav | pub |', '| 2 | o02.wav |  |'].join('\n')

// Garde generique : tout resultat doit rester parsable et rectangulaire.
function expectValid(out: string | null) {
  expect(out).not.toBeNull()
  const t = parseTable(out!)
  expect(t).not.toBeNull()
  const n = t!.headers.length
  expect(t!.aligns).toHaveLength(n)
  for (const r of t!.rows) expect(r.length).toBe(n)
  return t!
}

describe('applyTableOp — lignes', () => {
  it('ajoute une ligne en dessous', () => {
    const t = expectValid(applyTableOp(MD, { kind: 'addRowBelow', row: 2 }))
    expect(t.rows).toHaveLength(3)
    expect(t.rows[1]).toEqual(['', '', ''])
    expect(t.rows[0]).toEqual(['1', 'o01.wav', 'pub'])
  })

  it('ajoute une ligne au dessus', () => {
    const t = expectValid(applyTableOp(MD, { kind: 'addRowAbove', row: 3 }))
    expect(t.rows).toHaveLength(3)
    expect(t.rows[1]).toEqual(['', '', ''])
  })

  it('supprime une ligne de corps', () => {
    const t = expectValid(applyTableOp(MD, { kind: 'deleteRow', row: 2 }))
    expect(t.rows).toHaveLength(1)
    expect(t.rows[0]).toEqual(['2', 'o02.wav', ''])
  })

  it('REFUSE de supprimer l en-tete (detruirait le tableau)', () => {
    expect(applyTableOp(MD, { kind: 'deleteRow', row: 0 })).toBeNull()
  })

  it('REFUSE de supprimer la derniere ligne de corps', () => {
    const one = ['| a | b |', '|---|---|', '| 1 | 2 |'].join('\n')
    expect(applyTableOp(one, { kind: 'deleteRow', row: 2 })).toBeNull()
  })
})

describe('applyTableOp — colonnes', () => {
  it('ajoute une colonne a droite', () => {
    const t = expectValid(applyTableOp(MD, { kind: 'addColRight', col: 2 }))
    expect(t.headers).toHaveLength(4)
    expect(t.headers[3]).toBe('')
    expect(t.rows[0]).toEqual(['1', 'o01.wav', 'pub', ''])
  })

  it('ajoute une colonne a gauche', () => {
    const t = expectValid(applyTableOp(MD, { kind: 'addColLeft', col: 0 }))
    expect(t.headers).toHaveLength(4)
    expect(t.headers[1]).toBe('#')
  })

  it('supprime une colonne', () => {
    const t = expectValid(applyTableOp(MD, { kind: 'deleteCol', col: 1 }))
    expect(t.headers).toEqual(['#', 'verdict'])
    expect(t.rows[0]).toEqual(['1', 'pub'])
  })

  it('REFUSE de supprimer la derniere colonne', () => {
    const one = ['| a |', '|---|', '| 1 |'].join('\n')
    expect(applyTableOp(one, { kind: 'deleteCol', col: 0 })).toBeNull()
  })
})

describe('applyTableOp — invariants', () => {
  it('CONSERVE les alignements sur toutes les operations', () => {
    const al = ['| G | C | D |', '|:--|:-:|--:|', '| 1 | 2 | 3 |', '| 4 | 5 | 6 |'].join('\n')
    expect(expectValid(applyTableOp(al, { kind: 'addRowBelow', row: 2 })).aligns).toEqual(['left', 'center', 'right'])
    expect(expectValid(applyTableOp(al, { kind: 'deleteRow', row: 2 })).aligns).toEqual(['left', 'center', 'right'])
    // Supprimer la colonne du milieu retire SON alignement, pas les autres.
    expect(expectValid(applyTableOp(al, { kind: 'deleteCol', col: 1 })).aligns).toEqual(['left', 'right'])
    // Une colonne neuve n a pas d alignement impose.
    expect(expectValid(applyTableOp(al, { kind: 'addColRight', col: 2 })).aligns).toEqual(['left', 'center', 'right', null])
  })

  it('preserve le contenu des cellules existantes', () => {
    const t = expectValid(applyTableOp(MD, { kind: 'addRowBelow', row: 3 }))
    expect(t.rows[0]).toEqual(['1', 'o01.wav', 'pub'])
    expect(t.rows[1]).toEqual(['2', 'o02.wav', ''])
  })

  it('preserve un pipe echappe dans une cellule', () => {
    const esc = ['| a | b |', '|---|---|', '| x \\| y | z |'].join('\n')
    const out = applyTableOp(esc, { kind: 'addRowBelow', row: 2 })
    expect(out).toContain('x \\| y')
    expect(expectValid(out).rows[0]).toEqual(['x | y', 'z'])
  })

  it('normalise une ligne de corps trop courte (tableau rectangulaire)', () => {
    const ragged = ['| a | b | c |', '|---|---|---|', '| 1 |'].join('\n')
    const t = expectValid(applyTableOp(ragged, { kind: 'addRowBelow', row: 2 }))
    expect(t.rows[0]).toEqual(['1', '', ''])
  })

  it('rend null sur un bloc qui n est pas un tableau', () => {
    expect(applyTableOp('juste du texte', { kind: 'addRowBelow', row: 0 })).toBeNull()
  })

  it('conserve l indentation du bloc', () => {
    const ind = ['  | a | b |', '  |---|---|', '  | 1 | 2 |'].join('\n')
    const out = applyTableOp(ind, { kind: 'addRowBelow', row: 2 })
    for (const l of out!.split('\n')) expect(l.startsWith('  |')).toBe(true)
  })
})