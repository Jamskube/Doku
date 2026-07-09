import { describe, it, expect } from 'vitest'
import { parentFolder, tabDiscriminator } from './tabs'
import type { DocTab } from './stores.svelte'

function tab(id: number, name: string, path: string | null): DocTab {
  return { id, name, path, kind: 'md', content: '', savedContent: '', eol: '\n' }
}

describe('parentFolder', () => {
  it('chemin Windows', () => expect(parentFolder('G:\\Notes\\a.md')).toBe('Notes'))
  it('chemin POSIX', () => expect(parentFolder('/home/x/a.md')).toBe('x'))
  it('fichier sans dossier', () => expect(parentFolder('a.md')).toBe(''))
  it('null', () => expect(parentFolder(null)).toBe(''))
})

describe('tabDiscriminator', () => {
  it('nom unique → pas de différenciateur', () => {
    const tabs = [tab(1, 'a.md', 'G:\\X\\a.md'), tab(2, 'b.md', 'G:\\Y\\b.md')]
    expect(tabDiscriminator(tabs[0], tabs)).toBe('')
  })

  it('homonymes → dossier parent de chacun', () => {
    const tabs = [tab(1, 'notes.md', 'G:\\Perso\\notes.md'), tab(2, 'notes.md', 'G:\\Boulot\\notes.md')]
    expect(tabDiscriminator(tabs[0], tabs)).toBe('Perso')
    expect(tabDiscriminator(tabs[1], tabs)).toBe('Boulot')
  })

  it('homonyme sans chemin → pas de différenciateur', () => {
    const tabs = [tab(1, 'sans-titre', null), tab(2, 'sans-titre', null)]
    expect(tabDiscriminator(tabs[0], tabs)).toBe('')
  })
})
