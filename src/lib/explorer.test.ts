import { describe, it, expect } from 'vitest'
import {
  isSupportedFile,
  sortEntries,
  visibleEntries,
  parentPath,
  joinPath,
  baseName,
  pathCrumbs,
  nameExists,
  normalizeNewName,
  flattenTree,
  reachableExpanded,
  validateExpandedPaths,
  MAX_TREE_DEPTH,
  type FsEntry,
} from './explorer'

const dir = (name: string): FsEntry => ({ name, isDir: true })
const file = (name: string, mtime?: number): FsEntry => ({ name, isDir: false, mtime })

describe('isSupportedFile', () => {
  it('accepte md/markdown/txt/html/htm/pdf', () => {
    expect(isSupportedFile('a.md')).toBe(true)
    expect(isSupportedFile('a.MARKDOWN')).toBe(true)
    expect(isSupportedFile('a.html')).toBe(true)
    expect(isSupportedFile('a.txt')).toBe(true)
    expect(isSupportedFile('a.pdf')).toBe(true) // 11.1 : PDF lecture seule
    expect(isSupportedFile('a.PDF')).toBe(true)
  })
  it('refuse les autres', () => {
    expect(isSupportedFile('a.png')).toBe(false)
    expect(isSupportedFile('sans-extension')).toBe(false)
  })
})

describe('sortEntries', () => {
  it('dossiers avant fichiers, puis alphabétique', () => {
    const out = sortEntries([file('zeta.md'), dir('beta'), file('alpha.md'), dir('Alpha')])
    expect(out.map((e) => e.name)).toEqual(['Alpha', 'beta', 'alpha.md', 'zeta.md'])
  })

  it('nom décroissant : Z→A, mais les dossiers restent en tête', () => {
    const out = sortEntries([file('a.md'), dir('beta'), file('z.md'), dir('alpha')], {
      key: 'name',
      order: 'desc',
    })
    expect(out.map((e) => e.name)).toEqual(['beta', 'alpha', 'z.md', 'a.md'])
  })

  it('« Modifié le » croissant = le plus récent d’abord', () => {
    const out = sortEntries([file('vieux.md', 100), file('recent.md', 900), file('moyen.md', 500)], {
      key: 'modified',
      order: 'asc',
    })
    expect(out.map((e) => e.name)).toEqual(['recent.md', 'moyen.md', 'vieux.md'])
  })

  it('« Modifié le » décroissant inverse l’ordre', () => {
    const out = sortEntries([file('vieux.md', 100), file('recent.md', 900)], {
      key: 'modified',
      order: 'desc',
    })
    expect(out.map((e) => e.name)).toEqual(['vieux.md', 'recent.md'])
  })

  it('une entrée sans date part en fin, jamais mélangée aux dates réelles', () => {
    const out = sortEntries([file('sans-date.md'), file('recent.md', 900), file('vieux.md', 100)], {
      key: 'modified',
      order: 'asc',
    })
    expect(out.map((e) => e.name)).toEqual(['recent.md', 'vieux.md', 'sans-date.md'])
  })

  it('« Type » groupe par extension, puis alphabétique dans le groupe', () => {
    const out = sortEntries([file('b.md'), file('a.txt'), file('a.md'), dir('zz')], { key: 'type', order: 'asc' })
    expect(out.map((e) => e.name)).toEqual(['zz', 'a.md', 'b.md', 'a.txt'])
  })
})

describe('visibleEntries', () => {
  it('masque les fichiers non supportés, garde les dossiers', () => {
    const out = visibleEntries([file('a.md'), file('b.png'), dir('sous')])
    expect(out.map((e) => e.name)).toEqual(['sous', 'a.md'])
  })
})

describe('normalizeNewName', () => {
  it('ajoute .md si aucune extension supportée', () => {
    expect(normalizeNewName('Mes notes', 'file')).toEqual({ ok: true, name: 'Mes notes.md' })
    expect(normalizeNewName('  Notes  ', 'file')).toEqual({ ok: true, name: 'Notes.md' })
  })
  it('garde une extension supportée existante', () => {
    expect(normalizeNewName('a.txt', 'file')).toEqual({ ok: true, name: 'a.txt' })
    expect(normalizeNewName('page.HTML', 'file')).toEqual({ ok: true, name: 'page.HTML' })
  })
  it('n’ajoute jamais .md à un dossier', () => {
    expect(normalizeNewName('Archives', 'dir')).toEqual({ ok: true, name: 'Archives' })
  })
  it('refuse un nom vide', () => {
    expect(normalizeNewName('   ', 'file').ok).toBe(false)
  })
  it('refuse les caractères interdits par Windows', () => {
    for (const bad of ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b']) {
      expect(normalizeNewName(bad, 'file').ok).toBe(false)
    }
  })
  it('refuse les noms réservés Windows', () => {
    expect(normalizeNewName('CON', 'file').ok).toBe(false)
    expect(normalizeNewName('nul.md', 'file').ok).toBe(false)
    expect(normalizeNewName('COM1', 'dir').ok).toBe(false)
    // « console » n’est PAS réservé : seul le nom exact (ou suivi d’un point) l’est.
    expect(normalizeNewName('console', 'dir').ok).toBe(true)
  })
  it('refuse un nom finissant par un point ou un espace (inaccessible sous Windows)', () => {
    expect(normalizeNewName('dossier.', 'dir').ok).toBe(false)
    expect(normalizeNewName('a.md ', 'dir').ok).toBe(true) // trim d’abord, donc OK
  })
  it('refuse . et ..', () => {
    expect(normalizeNewName('.', 'dir').ok).toBe(false)
    expect(normalizeNewName('..', 'dir').ok).toBe(false)
  })
})

describe('nameExists', () => {
  it('détecte le conflit sans tenir compte de la casse (Windows écraserait)', () => {
    const list = [file('Notes.md'), dir('Archives')]
    expect(nameExists('notes.md', list)).toBe(true)
    expect(nameExists('ARCHIVES', list)).toBe(true)
    expect(nameExists('autre.md', list)).toBe(false)
  })
})

describe('parentPath', () => {
  it('Windows', () => expect(parentPath('G:\\Notes\\a.md')).toBe('G:\\Notes'))
  it('POSIX', () => expect(parentPath('/home/x/a.md')).toBe('/home/x'))
  it('gère un slash final', () => expect(parentPath('G:\\Notes\\sous\\')).toBe('G:\\Notes'))
  it('racine → null', () => expect(parentPath('a.md')).toBe(null))
  it('null → null', () => expect(parentPath(null)).toBe(null))
  it('racine de lecteur Windows : « C:\\a.md » → « C:\\ »', () =>
    expect(parentPath('C:\\a.md')).toBe('C:\\'))
})

describe('joinPath', () => {
  it('Windows', () => expect(joinPath('G:\\Notes', 'a.md')).toBe('G:\\Notes\\a.md'))
  it('POSIX', () => expect(joinPath('/home/x', 'a.md')).toBe('/home/x/a.md'))
  it('gère un séparateur final', () => expect(joinPath('G:\\Notes\\', 'a.md')).toBe('G:\\Notes\\a.md'))
})

describe('baseName', () => {
  it('Windows', () => expect(baseName('G:\\Notes\\a.md')).toBe('a.md'))
  it('POSIX', () => expect(baseName('/home/x/a.md')).toBe('a.md'))
})

describe('pathCrumbs', () => {
  it('conserve une racine Windows navigable', () => {
    expect(pathCrumbs('G:\\Notes\\Projets')).toEqual([
      { label: 'G:', path: 'G:\\' },
      { label: 'Notes', path: 'G:\\Notes' },
      { label: 'Projets', path: 'G:\\Notes\\Projets' },
    ])
  })

  it('conserve une racine POSIX navigable', () => {
    expect(pathCrumbs('/home/nicos/Notes')).toEqual([
      { label: '/', path: '/' },
      { label: 'home', path: '/home' },
      { label: 'nicos', path: '/home/nicos' },
      { label: 'Notes', path: '/home/nicos/Notes' },
    ])
  })

  it('gère un partage UNC', () => {
    expect(pathCrumbs('\\\\serveur\\partage\\Notes')).toEqual([
      { label: 'partage', path: '\\\\serveur\\partage' },
      { label: 'Notes', path: '\\\\serveur\\partage\\Notes' },
    ])
  })
})

describe('flattenTree', () => {
  const kids = new Map<string, FsEntry[]>([
    ['C:\\notes', [dir('projets'), file('a.md'), file('z.md')]],
    ['C:\\notes\\projets', [dir('doku'), file('plan.md')]],
    ['C:\\notes\\projets\\doku', [file('adr.md')]],
  ])

  it('racine seule quand rien n est deplie', () => {
    const rows = flattenTree('C:\\notes', kids, new Set())
    expect(rows.map((r) => r.entry.name)).toEqual(['projets', 'a.md', 'z.md'])
    expect(rows.every((r) => r.depth === 0)).toBe(true)
  })

  it('insere les enfants d un dossier deplie juste apres lui, indentes', () => {
    const rows = flattenTree('C:\\notes', kids, new Set(['C:\\notes\\projets']))
    expect(rows.map((r) => r.entry.name)).toEqual(['projets', 'doku', 'plan.md', 'a.md', 'z.md'])
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1, 0, 0])
    expect(rows[1].path).toBe('C:\\notes\\projets\\doku')
  })

  it('descend recursivement dans les dossiers deplies imbriques', () => {
    const expanded = new Set(['C:\\notes\\projets', 'C:\\notes\\projets\\doku'])
    const rows = flattenTree('C:\\notes', kids, expanded)
    expect(rows.map((r) => r.entry.name)).toEqual(['projets', 'doku', 'adr.md', 'plan.md', 'a.md', 'z.md'])
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 1, 0, 0])
  })

  it('un dossier deplie mais aux enfants NON charges ne montre rien (lazy)', () => {
    const partial = new Map<string, FsEntry[]>([['C:\\notes', [dir('projets')]]])
    const rows = flattenTree('C:\\notes', partial, new Set(['C:\\notes\\projets']))
    expect(rows.map((r) => r.entry.name)).toEqual(['projets'])
  })

  it('dossiers en tete a chaque niveau, tri applique par niveau', () => {
    const m = new Map<string, FsEntry[]>([
      ['C:\\n', [file('b.md'), dir('zz'), file('a.md')]],
      ['C:\\n\\zz', [file('y.md'), dir('aa')]],
    ])
    const rows = flattenTree('C:\\n', m, new Set(['C:\\n\\zz']))
    expect(rows.map((r) => r.entry.name)).toEqual(['zz', 'aa', 'y.md', 'a.md', 'b.md'])
  })

  it('borne la profondeur (boucle de jonctions)', () => {
    // Chaine artificielle a\a\a\... qui se re-deplie sans fin.
    const m = new Map<string, FsEntry[]>()
    const expanded = new Set<string>()
    let p = 'C:\\loop'
    for (let i = 0; i < 40; i++) {
      m.set(p, [dir('a')])
      p = p + '\\a'
      expanded.add(p)
    }
    const rows = flattenTree('C:\\loop', m, expanded)
    expect(rows.length).toBeLessThanOrEqual(MAX_TREE_DEPTH + 1)
  })
})

describe('reachableExpanded', () => {
  it('ne garde que les chemins sous la racine, tries du plus court au plus long', () => {
    const expanded = new Set(['C:\\notes\\projets\\doku', 'C:\\notes\\projets', 'D:\\autre\\dossier'])
    expect(reachableExpanded('C:\\notes', expanded)).toEqual(['C:\\notes\\projets', 'C:\\notes\\projets\\doku'])
  })
  it('ne confond pas prefixe de nom et sous-dossier', () => {
    const expanded = new Set(['C:\\notes-bis\\x'])
    expect(reachableExpanded('C:\\notes', expanded)).toEqual([])
  })
  it('accepte une racine deja terminee par un separateur', () => {
    expect(reachableExpanded('C:\\', new Set(['C:\\a']))).toEqual(['C:\\a'])
  })
})

describe('validateExpandedPaths', () => {
  it('accepte un tableau de chaines', () => {
    expect(validateExpandedPaths(['C:\\a', 'C:\\b'])).toEqual(['C:\\a', 'C:\\b'])
  })
  it('jette tout ce qui n est pas une chaine non vide', () => {
    expect(validateExpandedPaths(['ok', '', 42, null, {}])).toEqual(['ok'])
  })
  it('rejette un non-tableau sans jeter', () => {
    expect(validateExpandedPaths('C:\\a')).toEqual([])
    expect(validateExpandedPaths(undefined)).toEqual([])
  })
  it('borne la taille a 300', () => {
    expect(validateExpandedPaths(Array(500).fill('x')).length).toBe(300)
  })
})