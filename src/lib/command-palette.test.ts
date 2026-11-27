import { describe, expect, it } from 'vitest'
import { filterCommands, groupCommands, matchScore, type PaletteCommand } from './command-palette'

const cmd = (id: string, label: string, group = 'G', keywords?: string): PaletteCommand => ({ id, label, group, icon: 'x', keywords, run: () => {} })

describe('matchScore', () => {
  it('ignore accents et casse', () => {
    expect(matchScore('theme', 'Thème : Sombre')).toBeGreaterThan(0)
    expect(matchScore('ÉCHAP', 'echap')).toBeGreaterThan(0)
  })

  it('classe début > début de mot > milieu > sous-séquence', () => {
    const start = matchScore('mode', 'Mode source')
    const word = matchScore('source', 'Mode source')
    const inside = matchScore('ode', 'Mode source')
    const subsequence = matchScore('msrc', 'Mode source')
    expect(start).toBeGreaterThan(word)
    expect(word).toBeGreaterThan(inside)
    expect(inside).toBeGreaterThan(subsequence)
    expect(subsequence).toBeGreaterThan(0)
  })

  it('rejette une sous-séquence dans le mauvais ordre', () => {
    expect(matchScore('crsm', 'Mode source')).toBe(0)
    expect(matchScore('zzz', 'Mode source')).toBe(0)
  })

  it('préfère les lettres consécutives aux lettres dispersées', () => {
    expect(matchScore('mosrc', 'Mode source')).toBeGreaterThan(matchScore('mdsrc', 'Mode source'))
  })

  it('ignore les espaces dans une sous-séquence multi-mots', () => {
    expect(matchScore('mo so', 'Mode source')).toBeGreaterThan(0)
  })
})

describe('filterCommands', () => {
  const commands = [
    cmd('print', 'Imprimer ou exporter en PDF'),
    cmd('save', 'Enregistrer'),
    cmd('dark', 'Thème : Sombre', 'G', 'dark nuit'),
    cmd('source', 'Mode source'),
  ]

  it('rend tout, dans l’ordre, pour une requête vide', () => {
    expect(filterCommands(commands, '  ')).toEqual(commands)
  })

  it('trie par score puis par ordre d’origine', () => {
    expect(filterCommands(commands, 'e').map((c) => c.id)).toEqual(['save', 'print', 'dark', 'source'])
  })

  it('trouve par mot-clé caché', () => {
    expect(filterCommands(commands, 'nuit').map((c) => c.id)).toEqual(['dark'])
  })

  it('exclut ce qui ne correspond pas', () => {
    expect(filterCommands(commands, 'xyz')).toEqual([])
  })
})

describe('groupCommands', () => {
  it('ordonne les groupes selon leur meilleure commande', () => {
    const groups = groupCommands([cmd('a', 'A', 'Vue'), cmd('b', 'B', 'Fichier'), cmd('c', 'C', 'Vue')])
    expect(groups.map((g) => [g.group, g.items.map((i) => i.id)])).toEqual([['Vue', ['a', 'c']], ['Fichier', ['b']]])
  })
})
