import { describe, it, expect } from 'vitest'
import { isBlockedImageUrl, resolveLocalImagePath } from './images'

describe('isBlockedImageUrl', () => {
  it('bloque les schémas réseau et non-fichier', () => {
    expect(isBlockedImageUrl('https://x/a.png')).toBe(true)
    expect(isBlockedImageUrl('http://x/a.png')).toBe(true)
    expect(isBlockedImageUrl('blob:abc')).toBe(true)
    expect(isBlockedImageUrl('asset://localhost/a.png')).toBe(true)
    expect(isBlockedImageUrl('file:///etc/passwd')).toBe(true)
  })
  it('bloque UNC et protocole-relatif (fuite SMB/NTLM, phone-home)', () => {
    expect(isBlockedImageUrl('\\\\attacker.tld\\s\\p.png')).toBe(true)
    expect(isBlockedImageUrl('//attacker.tld/p.png')).toBe(true)
  })
  it('autorise data: inline et les fichiers locaux', () => {
    expect(isBlockedImageUrl('data:image/png;base64,AAAA')).toBe(false)
    expect(isBlockedImageUrl('a.png')).toBe(false)
    expect(isBlockedImageUrl('assets/a.png')).toBe(false)
    expect(isBlockedImageUrl('C:\\x\\a.png')).toBe(false)
    expect(isBlockedImageUrl('/home/x/a.png')).toBe(false)
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
