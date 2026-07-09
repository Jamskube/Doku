import { describe, it, expect } from 'vitest'
import { isExternalUrl, resolveLocalImagePath } from './images'

describe('isExternalUrl', () => {
  it('détecte http/https/data/blob/asset', () => {
    expect(isExternalUrl('https://x/a.png')).toBe(true)
    expect(isExternalUrl('http://x/a.png')).toBe(true)
    expect(isExternalUrl('data:image/png;base64,AAAA')).toBe(true)
    expect(isExternalUrl('asset://localhost/a.png')).toBe(true)
  })
  it('un chemin local n’est pas externe', () => {
    expect(isExternalUrl('a.png')).toBe(false)
    expect(isExternalUrl('assets/a.png')).toBe(false)
    expect(isExternalUrl('C:\\x\\a.png')).toBe(false)
  })
})

describe('resolveLocalImagePath', () => {
  it('résout un relatif au dossier (Windows)', () => {
    expect(resolveLocalImagePath('a.png', 'G:\\Notes')).toBe('G:\\Notes\\a.png')
    expect(resolveLocalImagePath('sous/a.png', 'G:\\Notes')).toBe('G:\\Notes\\sous\\a.png')
  })
  it('résout un relatif au dossier (POSIX)', () => {
    expect(resolveLocalImagePath('a.png', '/home/x')).toBe('/home/x/a.png')
  })
  it('laisse un chemin absolu tel quel', () => {
    expect(resolveLocalImagePath('C:\\img\\a.png', 'G:\\Notes')).toBe('C:\\img\\a.png')
    expect(resolveLocalImagePath('/abs/a.png', '/home/x')).toBe('/abs/a.png')
  })
  it('enlève query/fragment', () => {
    expect(resolveLocalImagePath('a.png?v=2', 'G:\\Notes')).toBe('G:\\Notes\\a.png')
  })
})
