import { describe, expect, it } from 'vitest'
import { detectUnsupported } from './encoding'

describe('detectUnsupported', () => {
  it('accepte du texte UTF-8 propre', () => {
    expect(detectUnsupported('# Titre\ndu texte éàü ✓', 'notes.md')).toBeNull()
  })

  it('accepte un fichier vide', () => {
    expect(detectUnsupported('', 'vide.txt')).toBeNull()
  })

  it('rejette un contenu binaire (octet NUL) et nomme le fichier', () => {
    const reason = detectUnsupported('PK\u0000\u0000abc', 'archive.zip')
    expect(reason).toContain('archive.zip')
    expect(reason).toContain('binaire')
  })

  it('rejette un encodage non-UTF-8 (ratio élevé de U+FFFD)', () => {
    // 4 caractères de remplacement sur 8 → 50 % : décodage manifestement raté
    const reason = detectUnsupported('a\uFFFD\uFFFD\uFFFD\uFFFDbcd', 'latin1.txt')
    expect(reason).toContain('encodage')
  })

  it('tolère un U+FFFD isolé dans un long texte (sous le seuil)', () => {
    const longText = 'x'.repeat(500) + '\uFFFD' + 'y'.repeat(500)
    expect(detectUnsupported(longText, 'doc.md')).toBeNull()
  })

  it('utilise un libellé générique sans nom de fichier', () => {
    expect(detectUnsupported('a\u0000b')).toContain('Ce fichier')
  })
})
