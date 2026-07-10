import { describe, expect, it } from 'vitest'
import { classifyExternalChange } from './reload'

describe('classifyExternalChange', () => {
  it('inchangé quand le disque correspond à la version enregistrée', () => {
    expect(classifyExternalChange('a', { content: 'a', savedContent: 'a' })).toBe('unchanged')
  })

  it('inchangé même avec modifs locales si le disque n’a pas bougé', () => {
    // Édition locale en cours, disque = dernière version sauvée → pas de changement externe.
    expect(classifyExternalChange('a', { content: 'a-local', savedContent: 'a' })).toBe('unchanged')
  })

  it('reload silencieux quand pas de modif locale et disque différent', () => {
    expect(classifyExternalChange('b', { content: 'a', savedContent: 'a' })).toBe('reload')
  })

  it('conflit quand modifs locales ET disque différent des deux', () => {
    expect(classifyExternalChange('b', { content: 'a-local', savedContent: 'a' })).toBe('conflict')
  })

  it('reload (adoption) quand le disque correspond déjà au buffer édité', () => {
    // Un autre outil a écrit exactement ce que l'utilisateur avait tapé → adopter, redevient propre.
    expect(classifyExternalChange('a-local', { content: 'a-local', savedContent: 'a' })).toBe('reload')
  })
})
