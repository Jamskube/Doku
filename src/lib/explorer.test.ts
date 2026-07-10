import { describe, it, expect } from 'vitest'
import {
  isSupportedFile,
  sortEntries,
  visibleEntries,
  parentPath,
  joinPath,
  baseName,
  type FsEntry,
} from './explorer'

const dir = (name: string): FsEntry => ({ name, isDir: true })
const file = (name: string): FsEntry => ({ name, isDir: false })

describe('isSupportedFile', () => {
  it('accepte md/markdown/txt/html/htm', () => {
    expect(isSupportedFile('a.md')).toBe(true)
    expect(isSupportedFile('a.MARKDOWN')).toBe(true)
    expect(isSupportedFile('a.html')).toBe(true)
    expect(isSupportedFile('a.txt')).toBe(true)
  })
  it('refuse les autres', () => {
    expect(isSupportedFile('a.png')).toBe(false)
    expect(isSupportedFile('a.pdf')).toBe(false)
    expect(isSupportedFile('sans-extension')).toBe(false)
  })
})

describe('sortEntries', () => {
  it('dossiers avant fichiers, puis alphabétique', () => {
    const out = sortEntries([file('zeta.md'), dir('beta'), file('alpha.md'), dir('Alpha')])
    expect(out.map((e) => e.name)).toEqual(['Alpha', 'beta', 'alpha.md', 'zeta.md'])
  })
})

describe('visibleEntries', () => {
  it('masque les fichiers non supportés, garde les dossiers', () => {
    const out = visibleEntries([file('a.md'), file('b.png'), dir('sous')])
    expect(out.map((e) => e.name)).toEqual(['sous', 'a.md'])
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
