import { describe, it, expect } from 'vitest'
import { isBlockedImageUrl, markdownTextLength, omitEmbeddedImageData, resolveLocalImagePath } from './images'

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

describe('omitEmbeddedImageData', () => {
  it('retire aussi les <img> HTML en data: (export autonome rouvert)', () => {
    expect(omitEmbeddedImageData('<p>x</p><img alt="a" src="data:image/png;base64,AAAA" width="10"><p>y</p>')).toBe('<p>x</p>[Image intégrée]<p>y</p>')
  })

  it('retire les octets inline du contexte tout en conservant le sens', () => {
    const markdown = '# Note\n![Schéma](data:image/png;base64,AAAA)\n![Photo](photo.png)'
    expect(omitEmbeddedImageData(markdown)).toBe('# Note\n[Image intégrée : Schéma]\n![Photo](photo.png)')
    expect(markdownTextLength(markdown)).toBeLessThan(markdown.length)
  })
})
